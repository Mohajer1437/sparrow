import {
  parseBrowserAssertions,
  describeAssertion,
  isCriticalResourceType,
  isMainDocumentFailure,
  isCriticalHttpFailure,
  isIgnorableConsoleError,
  classifyNetworkEvent,
  evaluateDomAssertion,
  formatBrowserEvidence,
  expectedClientErrorStatuses,
} from '../../../src/core/vv/browser-assertions';

describe('browser assertions', () => {
  it('parses exact text, test id, role, selector, and forbidden text', () => {
    const assertions = parseBrowserAssertions(
      'Set exact visible text Sandbox VnV repair marker. Use data-testid=sandbox-vv-footer. Must not contain CrashBeacon.',
      ['role=banner', 'selector=".footer"'],
    );
    expect(assertions).toEqual(expect.arrayContaining([
      { kind: 'text', value: 'Sandbox VnV repair marker' },
      { kind: 'testid', value: 'sandbox-vv-footer' },
      { kind: 'absent-text', value: 'CrashBeacon' },
      { kind: 'role', value: 'banner' },
      { kind: 'selector', value: '.footer' },
    ]));
  });

  it('parses contains text, visibility, and explicit page state', () => {
    const assertions = parseBrowserAssertions(
      'contains text Ready. visible selector=".ok". selector=".busy" must not be visible. success state indicated by data-testid=sandbox-vv-status.',
    );
    expect(assertions).toEqual(expect.arrayContaining([
      { kind: 'contains-text', value: 'Ready' },
      { kind: 'visible', value: '.ok' },
      { kind: 'not-visible', value: '.busy' },
      { kind: 'page-state', value: 'success:sandbox-vv-status' },
    ]));
  });

  it('treats document 404 as a main-document failure but not a 5xx network rule', () => {
    expect(isMainDocumentFailure(404)).toBe(true);
    expect(isCriticalHttpFailure(404)).toBe(false);
    expect(isCriticalHttpFailure(500)).toBe(true);
    expect(isCriticalResourceType('fetch')).toBe(true);
    expect(isCriticalResourceType('image')).toBe(false);
  });

  it('stops exact text at "and" so test-id clauses are not swallowed', () => {
    const assertions = parseBrowserAssertions(
      'set the home-page footer exact visible text to Sandbox VnV repair marker and add data-testid=sandbox-vv-footer.',
    );
    expect(assertions.find(a => a.kind === 'text')?.value).toBe('Sandbox VnV repair marker');
    expect(assertions.find(a => a.kind === 'testid')?.value).toBe('sandbox-vv-footer');
  });

  it('extracts every named test id and exact text from a keep-and-add task', () => {
    const assertions = parseBrowserAssertions(
      'In app/page.tsx keep data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker, keep data-testid=sandbox-p21-status with exact visible text Product QA ready, and add data-testid=sandbox-p21-assumed with exact visible text Assumed ready.',
    );
    expect(assertions.filter(a => a.kind === 'testid').map(a => a.value)).toEqual(expect.arrayContaining([
      'sandbox-vv-footer',
      'sandbox-p21-status',
      'sandbox-p21-assumed',
    ]));
    expect(assertions.filter(a => a.kind === 'text').map(a => a.value)).toEqual(expect.arrayContaining([
      'Sandbox VnV repair marker',
      'Product QA ready',
      'Assumed ready',
    ]));
  });

  it('does not treat 4xx resource logs as application console.error, but keeps 5xx', () => {
    expect(isIgnorableConsoleError('Failed to load resource: the server responded with a status of 404')).toBe(true);
    expect(isIgnorableConsoleError('Failed to load resource: the server responded with a status of 500')).toBe(false);
    expect(isIgnorableConsoleError('controlled console failure')).toBe(false);
  });

  it('fails 5xx and requestfailed, but not every 4xx', () => {
    expect(classifyNetworkEvent({ kind: 'http', status: 500, resourceType: 'fetch', url: '/api' })).toBe('fail');
    expect(classifyNetworkEvent({ kind: 'requestfailed', resourceType: 'xhr', url: '/api' })).toBe('fail');
    expect(classifyNetworkEvent({ kind: 'http', status: 404, resourceType: 'fetch', url: '/optional.json' })).toBe('evidence');
    expect(classifyNetworkEvent({ kind: 'http', status: 404, resourceType: 'image', url: '/logo.png' })).toBe('ignore');
    expect(classifyNetworkEvent({ kind: 'http', status: 404, resourceType: 'document', url: '/missing' })).toBe('fail');
    expect(classifyNetworkEvent(
      { kind: 'http', status: 401, resourceType: 'fetch', url: '/api' },
      { task: 'unauthorized users receive 401' },
    )).toBe('evidence');
    expect(expectedClientErrorStatuses('expect 404 for missing resource').has(404)).toBe(true);
  });

  it('emits structured expected/actual for a missing test id', () => {
    const result = evaluateDomAssertion(
      { kind: 'testid', value: 'sandbox-vv-footer' },
      { found: 0, visible: false, textContent: '' },
    );
    expect(result.passed).toBe(false);
    expect(result.expected).toBe('[data-testid="sandbox-vv-footer"]');
    expect(result.actual).toBe('element not found');
    expect(formatBrowserEvidence({
      url: 'http://127.0.0.1:3010/',
      route: '/',
      status: 200,
      expected: result.expected,
      actual: result.actual,
      testId: 'sandbox-vv-footer',
    })).toContain('Expected: [data-testid="sandbox-vv-footer"]');
  });

  it('distinguishes success vs error page state from explicit test ids', () => {
    const hiddenError = evaluateDomAssertion(
      { kind: 'page-state', value: 'error:error-banner' },
      { found: 0, visible: false, textContent: '' },
    );
    const visibleError = evaluateDomAssertion(
      { kind: 'page-state', value: 'error:error-banner' },
      { found: 1, visible: true, textContent: 'failed' },
    );
    const missingSuccess = evaluateDomAssertion(
      { kind: 'page-state', value: 'success:ok-badge' },
      { found: 0, visible: false, textContent: '' },
    );
    expect(hiddenError.passed).toBe(true);
    expect(visibleError.passed).toBe(false);
    expect(missingSuccess.passed).toBe(false);
    expect(missingSuccess.actual).toBe('element not found');
  });

  it('normalizes quoted exact visible text to the semantic value', () => {
    const assertions = parseBrowserAssertions('exact visible text "Foo"');
    expect(assertions.find(a => a.kind === 'text')?.value).toBe('Foo');
    expect(assertions.find(a => a.kind === 'text')?.value).not.toBe('"Foo"');
    const described = describeAssertion({ kind: 'text', value: 'Foo' });
    expect(described).toBe('exact visible text "Foo"');
    expect(described).not.toContain('""Foo""');
    expect(describeAssertion({ kind: 'text', value: '"Foo"' })).toBe('exact visible text "Foo"');
  });
});
