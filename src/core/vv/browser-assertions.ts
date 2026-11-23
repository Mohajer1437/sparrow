import { extractExactTexts, extractTestIds, stripWrappingQuotes } from './product-intent-extract';

export type BrowserAssertionKind =
  | 'text'
  | 'contains-text'
  | 'testid'
  | 'role'
  | 'selector'
  | 'absent-text'
  | 'visible'
  | 'not-visible'
  | 'page-state';

export interface BrowserAssertion {
  readonly kind: BrowserAssertionKind;
  readonly value: string;
}

export interface DomSnapshot {
  readonly found: number;
  readonly visible: boolean;
  readonly textContent: string;
}

export type NetworkVerdict = 'fail' | 'evidence' | 'ignore';

const ROLE_RE = /\brole\s*[:=]\s*['"]?([A-Za-z0-9_-]+)/i;
const SELECTOR_RE = /\bselector\s*[:=]\s*['"]([^'"]+)['"]/i;
const CONTAINS_TEXT_RE = /contains(?:\s+visible)?\s+text(?:\s+to)?\s+(.+?)(?:\s+and\b|,|\.|$)/i;
const ABSENT_RE = /must not (?:contain|show|display)\s+(.+?)(?:\.|$)/i;
const NOT_VISIBLE_TESTID_RE = /(?:data-testid|test[\s-]?id)\s*[:=]\s*['"]?([A-Za-z0-9:_-]+)['"]?[^\n.]{0,60}must not be visible/i;
const NOT_VISIBLE_SELECTOR_RE = /selector\s*[:=]\s*['"]([^'"]+)['"][^\n.]{0,60}must not be visible/i;
const VISIBLE_SELECTOR_RE = /(?:^|\b)visible\s+selector\s*[:=]\s*['"]([^'"]+)['"]/i;
const PAGE_STATE_RE = /\b(loading|error|success)\s+state(?:.{0,80}?)(?:data-testid|test[\s-]?id)\s*[:=]\s*['"]?([A-Za-z0-9:_-]+)/i;

export function parseBrowserAssertions(
  task?: string,
  criteria?: ReadonlyArray<string>,
): ReadonlyArray<BrowserAssertion> {
  const blobs = [task, ...(criteria ?? [])].filter(Boolean) as string[];
  const out: BrowserAssertion[] = [];
  const seen = new Set<string>();

  const push = (kind: BrowserAssertionKind, value: string) => {
    const trimmed = (kind === 'text' || kind === 'contains-text' || kind === 'absent-text')
      ? stripWrappingQuotes(value.trim())
      : value.trim();
    if (!trimmed) return;
    const key = kind + ':' + trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: trimmed });
  };

  for (const blob of blobs) {
    const notVisibleTestId = blob.match(NOT_VISIBLE_TESTID_RE);
    if (notVisibleTestId) push('not-visible', '[data-testid="' + notVisibleTestId[1] + '"]');
    const notVisibleSelector = blob.match(NOT_VISIBLE_SELECTOR_RE);
    if (notVisibleSelector) push('not-visible', notVisibleSelector[1]);
    const visibleSelector = blob.match(VISIBLE_SELECTOR_RE);
    if (visibleSelector) push('visible', visibleSelector[1]);

    const pageState = blob.match(PAGE_STATE_RE);
    if (pageState) push('page-state', pageState[1].toLowerCase() + ':' + pageState[2]);

    for (const id of extractTestIds(blob)) {
      if (!(notVisibleTestId && notVisibleTestId[1] === id)) {
        push('testid', id);
      }
    }
    const role = blob.match(ROLE_RE);
    if (role) push('role', role[1]);
    const selector = blob.match(SELECTOR_RE);
    if (selector && !(notVisibleSelector && notVisibleSelector[1] === selector[1])) {
      push('selector', selector[1]);
    }
    for (const text of extractExactTexts(blob)) {
      push('text', text);
    }
    const contains = blob.match(CONTAINS_TEXT_RE);
    if (contains) push('contains-text', contains[1]);
    const absent = blob.match(ABSENT_RE);
    if (absent) push('absent-text', absent[1]);
  }

  return Object.freeze(out);
}

export function isCriticalResourceType(resourceType: string): boolean {
  return resourceType === 'document' || resourceType === 'xhr' || resourceType === 'fetch' || resourceType === 'script';
}

export function isMainDocumentFailure(status: number): boolean {
  return status === 0 || status >= 400;
}

export function isCriticalHttpFailure(status: number): boolean {
  return status >= 500;
}

export function isIgnorableConsoleError(text: string): boolean {
  if (/the server responded with a status of 5\d\d/i.test(text)) return false;
  if (/the server responded with a status of 4\d\d/i.test(text)) return true;
  return /net::ERR_/i.test(text);
}

export function expectedClientErrorStatuses(
  task?: string,
  criteria?: ReadonlyArray<string>,
): ReadonlySet<number> {
  const text = [task, ...(criteria ?? [])].filter(Boolean).join(' ');
  const statuses = new Set<number>();
  for (const code of [401, 403, 404, 422, 429]) {
    if (new RegExp('\\b' + code + '\\b').test(text)) statuses.add(code);
  }
  if (/unauthori[sz]ed/i.test(text)) statuses.add(401);
  if (/\bforbidden\b/i.test(text)) statuses.add(403);
  if (/not found|missing resource/i.test(text)) statuses.add(404);
  if (/unprocessable|validation error/i.test(text)) statuses.add(422);
  if (/rate.?limit/i.test(text)) statuses.add(429);
  return statuses;
}

export function requiresSuccessfulNetwork(
  task?: string,
  criteria?: ReadonlyArray<string>,
): boolean {
  const text = [task, ...(criteria ?? [])].filter(Boolean).join(' ');
  return /(?:fetch|xhr|api|request) must succeed|must not fail(?:ed)? (?:fetch|xhr|request)|network must succeed/i.test(text);
}

export function classifyNetworkEvent(
  event: {
    readonly kind: 'requestfailed' | 'http';
    readonly status?: number;
    readonly resourceType: string;
    readonly url: string;
  },
  context?: { readonly task?: string; readonly criteria?: ReadonlyArray<string> },
): NetworkVerdict {
  if (!isCriticalResourceType(event.resourceType)) return 'ignore';
  if (event.kind === 'requestfailed') return 'fail';
  const status = event.status ?? 0;
  if (status >= 500) return 'fail';
  if (status >= 400) {
    const expected = expectedClientErrorStatuses(context?.task, context?.criteria);
    if (expected.has(status)) return 'evidence';
    if (event.resourceType === 'document') return 'fail';
    if ((event.resourceType === 'xhr' || event.resourceType === 'fetch') && requiresSuccessfulNetwork(context?.task, context?.criteria)) {
      return 'fail';
    }
    return 'evidence';
  }
  return 'ignore';
}

export function describeAssertion(assertion: BrowserAssertion): string {
  switch (assertion.kind) {
    case 'text':
      return 'exact visible text "' + stripWrappingQuotes(assertion.value) + '"';
    case 'contains-text':
      return 'contains text "' + stripWrappingQuotes(assertion.value) + '"';
    case 'testid':
      return '[data-testid="' + assertion.value + '"]';
    case 'role':
      return 'role="' + assertion.value + '"';
    case 'selector':
      return assertion.value;
    case 'absent-text':
      return 'must not contain text "' + stripWrappingQuotes(assertion.value) + '"';
    case 'visible':
      return assertion.value + ' visible';
    case 'not-visible':
      return assertion.value + ' not visible';
    case 'page-state': {
      const [state, id] = assertion.value.split(':');
      return state + ' state via [data-testid="' + id + '"]';
    }
    default:
      return assertion.value;
  }
}

export function evaluateDomAssertion(
  assertion: BrowserAssertion,
  snap: DomSnapshot,
): { passed: boolean; expected: string; actual: string } {
  const expected = describeAssertion(assertion);
  if (assertion.kind === 'absent-text') {
    const present = (snap.found > 0 && snap.visible) || snap.textContent.includes(assertion.value);
    return {
      passed: !present,
      expected,
      actual: present ? 'forbidden text is visible' : 'text is absent',
    };
  }
  if (assertion.kind === 'not-visible') {
    const shown = snap.found > 0 && snap.visible;
    return {
      passed: !shown,
      expected,
      actual: shown ? 'element is visible' : 'element is not visible',
    };
  }
  if (assertion.kind === 'page-state') {
    const state = assertion.value.split(':')[0];
    if (state === 'loading' || state === 'error') {
      const shown = snap.found > 0 && snap.visible;
      return {
        passed: !shown,
        expected: expected + ' must not be visible',
        actual: shown ? 'state is visible' : 'state is not visible',
      };
    }
  }
  if (snap.found === 0) {
    return { passed: false, expected, actual: 'element not found' };
  }
  if (!snap.visible) {
    return { passed: false, expected, actual: 'element not visible' };
  }
  return { passed: true, expected, actual: 'matched' };
}

export function formatBrowserEvidence(input: {
  readonly url?: string;
  readonly route?: string;
  readonly status?: number;
  readonly timestamp?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly selector?: string;
  readonly testId?: string;
  readonly extra?: ReadonlyArray<string>;
}): string {
  const parts: string[] = [];
  if (input.url) parts.push('URL: ' + input.url);
  if (input.route) parts.push('route: ' + input.route);
  if (input.status !== undefined) parts.push('HTTP status: ' + input.status);
  if (input.timestamp) parts.push('timestamp: ' + input.timestamp);
  if (input.testId) parts.push('test id: ' + input.testId);
  if (input.selector) parts.push('selector: ' + input.selector);
  if (input.expected) parts.push('Expected: ' + input.expected);
  if (input.actual) parts.push('Actual: ' + input.actual);
  if (input.extra) {
    for (const line of input.extra) {
      if (line) parts.push(line);
    }
  }
  return parts.join('; ');
}

export function assertionSelector(assertion: BrowserAssertion): string | undefined {
  if (assertion.kind === 'selector' || assertion.kind === 'visible' || assertion.kind === 'not-visible') {
    return assertion.value;
  }
  if (assertion.kind === 'testid') return '[data-testid="' + assertion.value + '"]';
  if (assertion.kind === 'page-state') {
    const id = assertion.value.split(':')[1];
    return id ? '[data-testid="' + id + '"]' : undefined;
  }
  if (assertion.kind === 'role') return '[role="' + assertion.value + '"]';
  return undefined;
}

export function assertionTestId(assertion: BrowserAssertion): string | undefined {
  if (assertion.kind === 'testid') return assertion.value;
  if (assertion.kind === 'page-state') return assertion.value.split(':')[1];
  const fromSelector = assertion.value.match(/\[data-testid=["']([^"']+)["']\]/);
  return fromSelector ? fromSelector[1] : undefined;
}
