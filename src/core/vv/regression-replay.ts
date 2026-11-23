import { RegressionCase } from '../../domain/regression-case';
import { VerificationCheck } from '../../domain/verification-check';
import { ApiVerifier } from '../../contracts/api-verifier';
import { formatApiEvidence, scenarioPassed } from './api-scenarios';
import { toReplayCheck } from './regression-case';
import { extractApiRouteFromText, extractHttpMethod, normalizeApiRoute } from './api-route';
import { parseBrowserAssertions } from './browser-assertions';
import { allowsHttpMethod } from '../../domain/execution-mode';
import { VerificationSideEffectPolicy } from '../../domain/verification-side-effect';

export interface RegressionReplayScope {
  readonly task?: string;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly changedFiles?: ReadonlyArray<string>;
}

export function filterRegressionCases(
  cases: ReadonlyArray<RegressionCase>,
  scope?: RegressionReplayScope,
): RegressionCase[] {
  if (!scope) return [...cases];
  return cases.filter(item => isRegressionCaseInScope(item, scope));
}

export function isRegressionCaseInScope(
  regressionCase: RegressionCase,
  scope: RegressionReplayScope,
): boolean {
  const blob = [scope.task, ...(scope.acceptanceCriteria || [])].filter(Boolean).join('\n');
  const files = (scope.changedFiles || []).map(file => file.replace(/\\/g, '/'));
  const currentRoute = extractApiRouteFromText(blob);
  const currentMethod = extractHttpMethod(blob);
  const currentAssertions = parseBrowserAssertions(scope.task, scope.acceptanceCriteria);
  const hasApi = !!currentRoute
    || /\b(GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(blob)
    || files.some(file => /(?:^|\/)(?:app|pages)\/api\//.test(file));
  const hasUi = currentAssertions.length > 0
    || /\b(data-testid|exact visible text|footer)\b/i.test(blob)
    || files.some(file => /(^|\/)(page|layout)\.(tsx|jsx)$/i.test(file) || /\/components\//.test(file));

  if (hasApi && !hasUi && regressionCase.category === 'browser') return false;
  if (hasUi && !hasApi && regressionCase.category === 'api') return false;

  if (regressionCase.category === 'api') {
    if (regressionCase.route && currentRoute
      && normalizeApiRoute(regressionCase.route) === normalizeApiRoute(currentRoute)) {
      return true;
    }
    if (regressionCase.relevantFiles?.some(file =>
      files.includes(file.replace(/\\/g, '/')) || blob.toLowerCase().includes(file.toLowerCase()),
    )) {
      return true;
    }
    if (regressionCase.method && currentMethod
      && regressionCase.method.toUpperCase() === currentMethod
      && currentRoute) {
      return normalizeApiRoute(regressionCase.route || currentRoute) === normalizeApiRoute(currentRoute);
    }
    return false;
  }

  if (regressionCase.category === 'browser') {
    if ((regressionCase.browserAssertions || []).some(assertion =>
      currentAssertions.some(current => current.kind === assertion.kind && current.value === assertion.value),
    )) {
      return true;
    }
    if (regressionCase.relevantFiles?.some(file =>
      files.includes(file.replace(/\\/g, '/')) || blob.toLowerCase().includes(file.toLowerCase()),
    )) {
      return true;
    }
    if (regressionCase.checkId && blob.toLowerCase().includes(regressionCase.checkId.toLowerCase())) {
      return true;
    }
    return false;
  }

  return false;
}

export async function replayApiCases(input: {
  readonly cases: ReadonlyArray<RegressionCase>;
  readonly baseUrl: string;
  readonly apiVerifier: ApiVerifier;
  readonly scope?: RegressionReplayScope;
  /** R1.26: READ_ONLY replay skips stored cases whose HTTP method mutates. */
  readonly sideEffectPolicy?: VerificationSideEffectPolicy;
}): Promise<ReadonlyArray<VerificationCheck>> {
  const checks: VerificationCheck[] = [];
  const scoped = filterRegressionCases(input.cases, input.scope);
  const policy: VerificationSideEffectPolicy = input.sideEffectPolicy ?? 'CONTROLLED_MUTATION';
  for (const regressionCase of scoped.filter(item => item.category === 'api').slice(-10)) {
    if (!regressionCase.method || !(regressionCase.url || regressionCase.route)) continue;
    if (policy === 'READ_ONLY' && !allowsHttpMethod('READ_ONLY', regressionCase.method)) continue;
    checks.push(await replayApiCase(regressionCase, input.baseUrl, input.apiVerifier));
  }
  return Object.freeze(checks);
}

export function replayBrowserCasesFromChecks(
  cases: ReadonlyArray<RegressionCase>,
  browserChecks: ReadonlyArray<VerificationCheck>,
  scope?: RegressionReplayScope,
): ReadonlyArray<VerificationCheck> {
  const scoped = filterRegressionCases(cases, scope);
  return Object.freeze(
    scoped.filter(item => item.category === 'browser').slice(-10).map(regressionCase => {
      const failed = browserChecks.find(check => !check.passed && matchesBrowserCase(regressionCase, check));
      if (failed) return toReplayCheck(regressionCase, failed);
      return toReplayCheck(regressionCase, {
        id: 'browser-replay',
        category: 'browser',
        name: regressionCase.name,
        passed: true,
        severity: 'LOW',
        evidence: 'Stored browser regression still holds for ' + (regressionCase.browserRoute || regressionCase.route || '/'),
        acceptanceCriterion: regressionCase.expectedBehavior,
      });
    }),
  );
}

async function replayApiCase(
  regressionCase: RegressionCase,
  baseUrl: string,
  apiVerifier: ApiVerifier,
): Promise<VerificationCheck> {
  if (typeof apiVerifier.runStoredScenario === 'function') {
    const check = await apiVerifier.runStoredScenario({
      baseUrl,
      method: regressionCase.method || 'GET',
      path: pathFromCase(regressionCase, baseUrl),
      body: regressionCase.requestData,
      headers: regressionCase.requestHeaders,
      expectedStatuses: regressionCase.expectedStatuses,
      scenario: regressionCase.scenario,
      route: regressionCase.route,
      file: regressionCase.relevantFiles?.[0],
    });
    return toReplayCheck(regressionCase, check);
  }
  const path = pathFromCase(regressionCase, baseUrl);
  const url = baseUrl.replace(/\/$/, '') + path;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: regressionCase.method,
      headers: regressionCase.requestHeaders || (regressionCase.requestData ? { 'content-type': 'application/json' } : {}),
      body: regressionCase.method === 'GET' ? undefined : regressionCase.requestData,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    const passed = res.status > 0 && scenarioPassed({
      kind: (regressionCase.scenario as any) || 'happy-path',
      expectedStatuses: regressionCase.expectedStatuses || [],
    } as any, res.status);
    return toReplayCheck(regressionCase, {
      id: 'api-replay',
      category: 'api',
      name: regressionCase.name,
      passed,
      severity: passed ? 'LOW' : 'HIGH',
      evidence: formatApiEvidence({
        method: regressionCase.method || 'GET',
        url,
        route: regressionCase.route || path,
        scenario: regressionCase.scenario || 'replay',
        expected: (regressionCase.expectedStatuses || []).join('|') || regressionCase.expectedBehavior,
        actual: res.status,
        response: body.slice(0, 300),
        timestamp: new Date().toISOString(),
      }),
      acceptanceCriterion: regressionCase.expectedBehavior,
    });
  } catch (error: any) {
    return toReplayCheck(regressionCase, {
      id: 'api-replay',
      category: 'api',
      name: regressionCase.name,
      passed: false,
      severity: 'HIGH',
      evidence: 'replay request failed: ' + (error?.message || String(error)),
      acceptanceCriterion: regressionCase.expectedBehavior,
    });
  }
}

export function matchesBrowserCase(regressionCase: RegressionCase, check: VerificationCheck): boolean {
  if (check.id === regressionCase.checkId) return true;

  const caseKind = browserCheckKind(regressionCase.checkId);
  const checkKind = browserCheckKind(check.id);
  if (!caseKind || !checkKind || caseKind !== checkKind) return false;

  if (caseKind === 'dom') {
    return assertionsAlign(regressionCase, check);
  }
  return true;
}

function browserCheckKind(id: string): string | undefined {
  if (id.includes('pageerror')) return 'pageerror';
  if (id.includes('console-error')) return 'console-error';
  if (id.includes('network')) return 'network';
  if (id.includes('nav')) return 'nav';
  if (id.includes('dom')) return 'dom';
  return undefined;
}

function assertionsAlign(regressionCase: RegressionCase, check: VerificationCheck): boolean {
  const assertions = regressionCase.browserAssertions || [];
  if (assertions.length === 0) return check.id === regressionCase.checkId;
  const haystack = [check.acceptanceCriterion, check.name, check.id].join(' ');
  return assertions.some(assertion =>
    haystack.includes(assertion.value),
  );
}

function pathFromCase(regressionCase: RegressionCase, baseUrl: string): string {
  if (regressionCase.route) {
    const route = regressionCase.route.startsWith('/') ? regressionCase.route : '/' + regressionCase.route;
    return route.startsWith('/api') ? normalizeApiRoute(route) : route;
  }
  if (regressionCase.url) {
    try {
      const parsed = new URL(regressionCase.url);
      return parsed.pathname + parsed.search;
    } catch {
      return regressionCase.url.replace(baseUrl.replace(/\/$/, ''), '') || '/';
    }
  }
  return '/';
}
