import { promises as fs } from 'fs';
import * as path from 'path';
import { BrowserVerifier } from '../../contracts/browser-verifier';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';
import {
  parseBrowserAssertions,
  isCriticalResourceType,
  isMainDocumentFailure,
  isIgnorableConsoleError,
  classifyNetworkEvent,
  evaluateDomAssertion,
  formatBrowserEvidence,
  assertionSelector,
  assertionTestId,
  BrowserAssertion,
  DomSnapshot,
} from './browser-assertions';
import { pageSlug } from './infer-source-files';
import { selectBrowserPages, isLoginRedirect } from './browser-page-scope';
import { TodoPlan } from '../../domain/todo-plan';
import { mapRouteToTodo } from './todo-route-mapping';

const WINDOWS_BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

interface PageProbe {
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
  failedRequests: string[];
  serverErrors: string[];
  unexpectedClientErrors: string[];
  clientErrorEvidence: string[];
}

export class PlaywrightBrowserVerifier implements BrowserVerifier {
  async verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly task?: string;
    readonly acceptanceCriteria?: ReadonlyArray<string>;
    readonly todoPlan?: TodoPlan;
  }): Promise<ReadonlyArray<VerificationCheck>> {
    if (input.profile === 'MVP') {
      return Object.freeze([]);
    }

    const pages = this.focusPages(
      await this.discoverPages(input.workspacePath),
      input.changedFiles,
      input.task,
      input.acceptanceCriteria,
    );
    if (pages.length === 0) {
      return Object.freeze([{
        id: 'browser-no-pages',
        category: 'browser' as const,
        name: 'Browser page discovery',
        passed: true,
        severity: 'LOW' as const,
        evidence: 'No Next.js/app pages discovered',
      }]);
    }

    let chromium: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      chromium = require('playwright').chromium;
    } catch {
      const passed = !this.shouldFailIfMissing(input.profile);
      return Object.freeze([{
        id: 'browser-playwright-missing',
        category: 'browser' as const,
        name: 'Playwright availability',
        passed,
        severity: (passed ? 'MEDIUM' : 'HIGH') as 'MEDIUM' | 'HIGH',
        evidence: passed
          ? 'Playwright is not installed; STANDARD records a gap instead of failing'
          : 'PRODUCTION browser verification requires Playwright to be installed',
        acceptanceCriterion: 'Playwright chromium can launch and open the changed UI',
      }]);
    }

    const launched = await this.launchBrowser(chromium);
    if (!launched.browser) {
      const passed = input.profile !== 'PRODUCTION';
      return Object.freeze([{
        id: 'browser-chromium-launch',
        category: 'browser' as const,
        name: 'Chromium launch',
        passed,
        severity: (passed ? 'MEDIUM' : 'HIGH') as 'MEDIUM' | 'HIGH',
        evidence: 'browser launch failed: ' + launched.error,
        acceptanceCriterion: 'Playwright can launch Chromium, Chrome, or Edge for browser verification',
      }]);
    }

    const browser = launched.browser;
    const baseUrl = process.env.AGENT_VV_BASE_URL || 'http://127.0.0.1:3000';
    const assertions = parseBrowserAssertions(input.task, input.acceptanceCriteria);
    const networkContext = { task: input.task, criteria: input.acceptanceCriteria };

    try {
      const reachable = await this.isReachable(baseUrl);
      if (!reachable) {
        const passed = input.profile !== 'PRODUCTION';
        return Object.freeze([{
          id: 'browser-runtime',
          category: 'browser' as const,
          name: 'App runtime availability',
          passed,
          severity: (passed ? 'MEDIUM' : 'HIGH') as 'MEDIUM' | 'HIGH',
          evidence: passed
            ? 'Launched ' + launched.channel + ' but ' + baseUrl + ' is not reachable; STANDARD records a gap'
            : 'PRODUCTION requires a live UI at ' + baseUrl,
          acceptanceCriterion: 'Application is reachable in a real browser',
        }]);
      }

      const checks: VerificationCheck[] = [];
      const warningLines: string[] = [];
      for (const pagePath of pages.slice(0, 5)) {
        const url = baseUrl.replace(/\/$/, '') + pagePath;
        const page = await browser.newPage();
        const probe: PageProbe = {
          pageErrors: [],
          consoleErrors: [],
          consoleWarnings: [],
          failedRequests: [],
          serverErrors: [],
          unexpectedClientErrors: [],
          clientErrorEvidence: [],
        };
        page.on('pageerror', (err: Error) => probe.pageErrors.push(err.message));
        page.on('console', (msg: { type: () => string; text: () => string }) => {
          if (msg.type() === 'error' && !isIgnorableConsoleError(msg.text())) {
            probe.consoleErrors.push(msg.text());
          }
          if (msg.type() === 'warning') probe.consoleWarnings.push(msg.text());
        });
        page.on('requestfailed', (req: { resourceType: () => string; url: () => string; failure: () => { errorText?: string } | null }) => {
          const resourceType = req.resourceType();
          const verdict = classifyNetworkEvent(
            { kind: 'requestfailed', resourceType, url: req.url() },
            networkContext,
          );
          const line = resourceType + ' ' + req.url() + ' ' + (req.failure()?.errorText || 'failed');
          if (verdict === 'fail') probe.failedRequests.push(line);
          else if (verdict === 'evidence') probe.clientErrorEvidence.push(line);
        });
        page.on('response', (res: { status: () => number; request: () => { resourceType: () => string; url: () => string } }) => {
          const status = res.status();
          const type = res.request().resourceType();
          const verdict = classifyNetworkEvent(
            { kind: 'http', status, resourceType: type, url: res.request().url() },
            networkContext,
          );
          const line = type + ' ' + status + ' ' + res.request().url();
          if (verdict === 'fail' && status >= 500) probe.serverErrors.push(line);
          else if (verdict === 'fail') probe.unexpectedClientErrors.push(line);
          else if (verdict === 'evidence') probe.clientErrorEvidence.push(line);
        });
        try {
          let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (isLoginRedirect(page.url(), pagePath)) {
            await page.context().addCookies([{
              name: 'auth',
              value: 'true',
              url: baseUrl.replace(/\/$/, '') + '/',
            }]);
            response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          }
          await page.waitForLoadState('load').catch(() => undefined);
          await new Promise(r => setTimeout(r, 1500));
          const status = response ? response.status() : 0;
          const navFailed = isMainDocumentFailure(status);
          if (pagePath === '/' || pages.length === 1) {
            await this.waitForAssertions(page, assertions);
          }
          const assertionFailures = pagePath === '/' || pages.length === 1
            ? await this.runAssertions(page, assertions, url, pagePath, status)
            : [];
          warningLines.push(...probe.consoleWarnings.map(w => pagePath + ': ' + w));
          // R1.8: attribute route checks to a Todo only when exactly one Todo
          // owns this route's page file.
          const routeTodoId = mapRouteToTodo(pagePath, input.todoPlan);
          checks.push(...this.collectPageChecks(
            pagePath,
            url,
            launched.channel,
            status,
            navFailed,
            probe,
            assertionFailures,
          ).map(check => routeTodoId
            ? { ...check, todoId: routeTodoId, scope: 'TODO_SPECIFIC' as const, source: 'browser-verification' }
            : check));
        } catch (error: any) {
          const passed = input.profile !== 'PRODUCTION';
          checks.push(Object.freeze({
            id: 'browser-nav-' + pageSlug(pagePath),
            category: 'browser' as const,
            name: 'Navigate ' + pagePath,
            passed,
            severity: (passed ? 'MEDIUM' : 'HIGH') as 'MEDIUM' | 'HIGH',
            evidence: formatBrowserEvidence({
              url,
              route: pagePath,
              timestamp: new Date().toISOString(),
              extra: ['Failed to open ' + url + ': ' + (error?.message || String(error))],
            }),
            acceptanceCriterion: 'Page ' + pagePath + ' is reachable in a real browser',
          }));
        } finally {
          await page.close();
        }
      }
      if (warningLines.length > 0) {
        checks.push(Object.freeze({
          id: 'browser-console-warnings',
          category: 'browser' as const,
          name: 'Console warnings',
          passed: true,
          severity: 'MEDIUM' as const,
          evidence: warningLines.slice(0, 10).join(' | '),
          acceptanceCriterion: 'Console warnings are recorded as evidence, not automatic failures',
        }));
      }
      return Object.freeze(checks);
    } finally {
      await browser.close();
    }
  }

  private collectPageChecks(
    pagePath: string,
    url: string,
    channel: string,
    status: number,
    navFailed: boolean,
    probe: PageProbe,
    assertionFailures: string[],
  ): VerificationCheck[] {
    const slug = pageSlug(pagePath);
    const timestamp = new Date().toISOString();
    const loc = formatBrowserEvidence({
      url,
      route: pagePath,
      status,
      timestamp,
      extra: ['via ' + channel],
    });
    const checks: VerificationCheck[] = [];

    const hasPageError = probe.pageErrors.length > 0;
    checks.push(Object.freeze({
      id: 'browser-pageerror-' + slug,
      category: 'browser' as const,
      name: 'Uncaught page error on ' + pagePath,
      passed: !hasPageError,
      severity: (hasPageError ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      evidence: hasPageError
        ? loc + '; pageerror: ' + probe.pageErrors.join(' | ')
        : loc,
      acceptanceCriterion: 'Page ' + pagePath + ' must not throw uncaught runtime exceptions',
    }));

    const hasConsoleError = probe.consoleErrors.length > 0;
    checks.push(Object.freeze({
      id: 'browser-console-error-' + slug,
      category: 'browser' as const,
      name: 'Console errors on ' + pagePath,
      passed: !hasConsoleError,
      severity: (hasConsoleError ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      evidence: hasConsoleError
        ? loc + '; console.error: ' + probe.consoleErrors.join(' | ')
        : loc,
      acceptanceCriterion: 'Page ' + pagePath + ' must not emit console.error',
    }));

    const hasNetworkFailure = probe.failedRequests.length > 0
      || probe.serverErrors.length > 0
      || probe.unexpectedClientErrors.length > 0;
    const networkParts = [
      loc,
      probe.failedRequests.length ? 'requestfailed: ' + probe.failedRequests.join(' | ') : '',
      probe.serverErrors.length ? 'http5xx: ' + probe.serverErrors.join(' | ') : '',
      probe.unexpectedClientErrors.length ? 'unexpected network failure: ' + probe.unexpectedClientErrors.join(' | ') : '',
      probe.clientErrorEvidence.length ? 'expected product response: ' + probe.clientErrorEvidence.join(' | ') : '',
    ].filter(Boolean);
    checks.push(Object.freeze({
      id: 'browser-network-' + slug,
      category: 'browser' as const,
      name: 'Critical network on ' + pagePath,
      passed: !hasNetworkFailure,
      severity: (hasNetworkFailure ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      evidence: networkParts.join('; '),
      acceptanceCriterion: 'Critical document, script, XHR, and fetch requests on ' + pagePath + ' must succeed unless the response is an expected product status',
    }));

    checks.push(Object.freeze({
      id: 'browser-nav-' + slug,
      category: 'browser' as const,
      name: 'Navigate ' + pagePath,
      passed: !navFailed,
      severity: (navFailed ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      evidence: loc,
      acceptanceCriterion: 'Document ' + pagePath + ' loads with HTTP < 400',
    }));

    if (assertionFailures.length > 0) {
      for (const failure of assertionFailures) {
        const kind = failure.includes('test id') || failure.includes('data-testid') ? 'testid'
          : /exact visible text|contains text/.test(failure) ? 'text'
          : failure.includes('role') ? 'role'
          : failure.includes('state') ? 'state'
          : failure.includes('selector') || failure.includes('[') ? 'selector'
          : 'dom';
        checks.push(Object.freeze({
          id: 'browser-dom-' + kind + '-' + slug,
          category: 'browser' as const,
          name: 'DOM assertion on ' + pagePath,
          passed: false,
          severity: 'HIGH' as const,
          evidence: failure,
          acceptanceCriterion: this.domAcceptanceCriterion(failure),
        }));
      }
    } else if (pagePath === '/') {
      checks.push(Object.freeze({
        id: 'browser-dom-home',
        category: 'browser' as const,
        name: 'DOM assertions on ' + pagePath,
        passed: true,
        severity: 'LOW' as const,
        evidence: loc,
        acceptanceCriterion: 'Home page matches requested visible text, test id, role, selector, absence, visibility, and state rules',
      }));
    }

    return checks;
  }

  private domAcceptanceCriterion(failure: string): string {
    const expected = failure.match(/Expected:\s*([^;]+)/i);
    if (expected) return expected[1].trim();
    const testId = failure.match(/test id:\s*([A-Za-z0-9:_-]+)/i);
    if (testId) return 'Element with test id "' + testId[1].trim() + '" must be visible';
    const text = failure.match(/visible text:\s*(.+)$/i);
    if (text) return 'Visible text must include "' + text[1].trim() + '"';
    const role = failure.match(/role:\s*(.+)$/i);
    if (role) return 'Element with role "' + role[1].trim() + '" must be visible';
    const selector = failure.match(/selector:\s*([^;]+)/i);
    if (selector) return 'Selector "' + selector[1].trim() + '" must be visible';
    if (/forbidden text is visible:/i.test(failure)) {
      return 'Forbidden text must not be visible';
    }
    return 'Requested DOM assertion must hold';
  }

  private async snapshotFor(page: any, assertion: BrowserAssertion): Promise<DomSnapshot> {
    const locatorFor = (sel: string) => page.locator(sel);
    if (assertion.kind === 'text') {
      const loc = page.getByText(assertion.value, { exact: true });
      const found = await loc.count();
      const visible = found > 0 && await loc.first().isVisible().catch(() => false);
      const textContent = found > 0 ? (await loc.first().innerText().catch(() => '')) || '' : '';
      return { found, visible, textContent };
    }
    if (assertion.kind === 'contains-text') {
      const loc = page.getByText(assertion.value, { exact: false });
      const found = await loc.count();
      const visible = found > 0 && await loc.first().isVisible().catch(() => false);
      const textContent = found > 0 ? (await loc.first().innerText().catch(() => '')) || '' : '';
      return { found, visible, textContent };
    }
    if (assertion.kind === 'absent-text') {
      const loc = page.getByText(assertion.value, { exact: false });
      const found = await loc.count();
      const visible = found > 0 && await loc.first().isVisible().catch(() => false);
      const textContent = ((await page.locator('body').innerText().catch(() => '')) || '');
      return { found, visible, textContent };
    }
    if (assertion.kind === 'testid' || assertion.kind === 'page-state') {
      const id = assertion.kind === 'page-state' ? assertion.value.split(':')[1] : assertion.value;
      const loc = page.getByTestId(id);
      const alt = page.locator('[data-testid="' + id + '"]');
      const found = (await loc.count()) + (await alt.count());
      const handle = (await loc.count()) > 0 ? loc : alt;
      const visible = found > 0 && await handle.first().isVisible().catch(() => false);
      const textContent = found > 0 ? (await handle.first().innerText().catch(() => '')) || '' : '';
      return { found, visible, textContent };
    }
    if (assertion.kind === 'role') {
      const loc = page.getByRole(assertion.value);
      const found = await loc.count();
      const visible = found > 0 && await loc.first().isVisible().catch(() => false);
      const textContent = found > 0 ? (await loc.first().innerText().catch(() => '')) || '' : '';
      return { found, visible, textContent };
    }
    const loc = locatorFor(assertion.value);
    const found = await loc.count();
    const visible = found > 0 && await loc.first().isVisible().catch(() => false);
    const textContent = found > 0 ? (await loc.first().innerText().catch(() => '')) || '' : '';
    return { found, visible, textContent };
  }

  private async runAssertions(
    page: any,
    assertions: ReadonlyArray<BrowserAssertion>,
    url: string,
    route: string,
    status: number,
  ): Promise<string[]> {
    const failures: string[] = [];
    const timestamp = new Date().toISOString();
    for (const assertion of assertions) {
      try {
        const snap = await this.snapshotFor(page, assertion);
        const result = evaluateDomAssertion(assertion, snap);
        if (!result.passed) {
          failures.push(formatBrowserEvidence({
            url,
            route,
            status,
            timestamp,
            expected: result.expected,
            actual: result.actual,
            selector: assertionSelector(assertion),
            testId: assertionTestId(assertion),
          }));
        }
      } catch (error: any) {
        failures.push(formatBrowserEvidence({
          url,
          route,
          status,
          timestamp,
          expected: assertionSelector(assertion) || assertion.value,
          actual: 'assertion error (' + assertion.kind + '): ' + (error?.message || String(error)),
          selector: assertionSelector(assertion),
          testId: assertionTestId(assertion),
        }));
      }
    }
    return failures;
  }

  private async waitForAssertions(page: any, assertions: ReadonlyArray<BrowserAssertion>): Promise<void> {
    for (const assertion of assertions) {
      try {
        if (assertion.kind === 'testid') {
          const loc = page.getByTestId(assertion.value);
          const alt = page.locator('[data-testid="' + assertion.value + '"]');
          await loc.first().waitFor({ state: 'visible', timeout: 12000 }).catch(() =>
            alt.first().waitFor({ state: 'visible', timeout: 4000 }),
          );
        } else if (assertion.kind === 'text' || assertion.kind === 'contains-text') {
          await page.getByText(assertion.value, { exact: assertion.kind === 'text' })
            .first()
            .waitFor({ state: 'visible', timeout: 12000 })
            .catch(() => undefined);
        } else if (assertion.kind === 'selector' || assertion.kind === 'visible') {
          await page.locator(assertion.value).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => undefined);
        } else if (assertion.kind === 'page-state' && assertion.value.startsWith('success:')) {
          const id = assertion.value.split(':')[1];
          await page.getByTestId(id).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => undefined);
        }
      } catch {
        // assertion failures are recorded later
      }
    }
  }

  private shouldFailIfMissing(profile: QualityProfile): boolean {
    return profile === 'PRODUCTION';
  }

  private focusPages(
    pages: string[],
    changedFiles?: ReadonlyArray<string>,
    task?: string,
    criteria?: ReadonlyArray<string>,
  ): string[] {
    return selectBrowserPages(pages, changedFiles, task, criteria);
  }

  private fileMatchesPage(file: string, pagePath: string): boolean {
    const normalized = file.replace(/^\/+/, '');
    if (pagePath === '/') {
      return /(?:^|\/)app\/page\.(tsx|jsx|ts|js)$/i.test(normalized) || /(?:^|\/)pages\/index\.(tsx|jsx|ts|js)$/i.test(normalized);
    }
    const rel = pagePath.replace(/^\//, '');
    return normalized.includes('/app/' + rel + '/') || normalized.includes('/pages/' + rel);
  }

  private async launchBrowser(chromium: any): Promise<{ browser: any; channel: string; error: string }> {
    const attempts: Array<{ channel: string; options: Record<string, unknown> }> = [
      { channel: 'chromium', options: { headless: true } },
      { channel: 'msedge', options: { headless: true, channel: 'msedge' } },
      { channel: 'chrome', options: { headless: true, channel: 'chrome' } },
    ];
    for (const exe of WINDOWS_BROWSER_PATHS) {
      attempts.push({ channel: exe, options: { headless: true, executablePath: exe } });
    }

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const browser = await chromium.launch(attempt.options);
        return { browser, channel: attempt.channel, error: '' };
      } catch (error: any) {
        errors.push(attempt.channel + ': ' + (error?.message || String(error)));
      }
    }
    return { browser: null, channel: '', error: errors.join(' | ') };
  }

  private async isReachable(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return res.status > 0;
    } catch {
      return false;
    }
  }

  private async discoverPages(workspacePath: string): Promise<string[]> {
    const roots = [
      path.join(workspacePath, 'src', 'app'),
      path.join(workspacePath, 'app'),
      path.join(workspacePath, 'src', 'pages'),
      path.join(workspacePath, 'pages'),
    ];
    const files: string[] = [];
    for (const rootDir of roots) {
      await this.walk(rootDir, files);
    }
    const pages = new Set<string>();
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      if (!/page\.(tsx|jsx|ts|js)$/i.test(normalized) && !/pages\/.+\.(tsx|jsx|ts|js)$/i.test(normalized)) {
        continue;
      }
      if (normalized.includes('/api/')) continue;
      const appIdx = normalized.lastIndexOf('/app/');
      const pagesIdx = normalized.lastIndexOf('/pages/');
      if (appIdx >= 0) {
        let rel = normalized.slice(appIdx + 4);
        rel = rel.replace(/\/page\.(tsx|jsx|ts|js)$/i, '');
        pages.add(rel === '' || rel === '/' ? '/' : rel);
      } else if (pagesIdx >= 0) {
        let rel = normalized.slice(pagesIdx + 6);
        rel = rel.replace(/\.(tsx|jsx|ts|js)$/i, '');
        rel = rel.replace(/\/index$/i, '');
        pages.add(rel === '' ? '/' : '/' + rel.replace(/^\/+/, ''));
      }
    }
    return Array.from(pages);
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await this.walk(full, out);
        else if (/\.(ts|js|tsx|jsx)$/i.test(entry.name)) out.push(full);
      }
    } catch {
      // missing
    }
  }
}
