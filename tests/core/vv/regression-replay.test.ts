import { regressionCaseFromFailure } from '../../../src/core/vv/regression-case';
import { replayApiCases, replayBrowserCasesFromChecks } from '../../../src/core/vv/regression-replay';
import { FailureContract } from '../../../src/domain/failure-contract';
import { RegressionCase } from '../../../src/domain/regression-case';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('regression case + replay', () => {
  it('stores enough deterministic information to replay an API defect', () => {
    const contract: FailureContract = {
      id: 'fail-api',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      summary: '1 verification check(s) failed',
      severity: 'HIGH',
      category: 'api',
      failedChecks: [{
        id: 'api-missing-input-post-api-save',
        category: 'api',
        name: 'POST /api/save missing-input',
        passed: false,
        severity: 'HIGH',
        evidence: 'method: POST; URL: http://127.0.0.1:3010/api/save; route: /api/save; scenario: missing-input; Expected: 400|422; Actual: 500; request: ; source: app/api/save/route.ts',
        acceptanceCriterion: 'expected HTTP 400|422 and never 5xx',
      }],
      acceptanceCriteria: ['POST /api/save must return 400'],
      repairInstructions: 'fix save',
      attempt: 1,
      expectation: { expectedBehavior: 'POST /api/save must satisfy 400|422' },
      location: { method: 'POST', route: '/api/save', url: 'http://127.0.0.1:3010/api/save', file: 'app/api/save/route.ts' },
      implicatedFiles: ['app/api/save/route.ts'],
    };
    const stored = regressionCaseFromFailure(contract, {
      task: 'POST /api/save must reject missing JSON with 400',
      qualityProfile: 'PRODUCTION',
      workspacePath: '/tmp',
    });
    expect(stored).toBeDefined();
    expect(stored!.method).toBe('POST');
    expect(stored!.route).toBe('/api/save');
    expect(stored!.scenario).toBe('missing-input');
    expect(stored!.relevantFiles).toContain('app/api/save/route.ts');
    expect(stored!.expectedStatuses).toEqual(expect.arrayContaining([400, 422]));
  });

  it('replays a stored API case against the live verifier and fails on 5xx', async () => {
    const regressionCase: RegressionCase = {
      id: 'reg-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'api',
      checkId: 'api-missing-input-post-api-save',
      name: 'POST /api/save missing-input',
      expectedBehavior: '400|422',
      method: 'POST',
      route: '/api/save',
      scenario: 'missing-input',
      expectedStatuses: [400, 422],
      evidence: 'Actual: 500',
    };
    const checks = await replayApiCases({
      cases: [regressionCase],
      baseUrl: 'http://127.0.0.1:9',
      apiVerifier: {
        verify: async () => [],
        runStoredScenario: async () => ({
          id: 'api-replay',
          category: 'api',
          name: 'replay',
          passed: false,
          severity: 'HIGH',
          evidence: 'method: POST; Actual: 500',
        }),
      },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].id).toContain('regression-replay-');
    expect(checks[0].passed).toBe(false);
  });

  it('maps a stored browser case onto current browser checks', () => {
    const regressionCase: RegressionCase = {
      id: 'reg-br',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'browser',
      checkId: 'browser-console-error-home',
      name: 'Console errors on /',
      expectedBehavior: 'The page must not emit console.error',
      browserRoute: '/',
      evidence: 'console.error: controlled VnV console beacon',
    };
    const browserChecks: VerificationCheck[] = [{
      id: 'browser-console-error-home',
      category: 'browser',
      name: 'Console errors on /',
      passed: false,
      severity: 'HIGH',
      evidence: 'console.error: controlled VnV console beacon',
    }];
    const replayed = replayBrowserCasesFromChecks([regressionCase], browserChecks);
    expect(replayed[0].passed).toBe(false);
    expect(replayed[0].id).toContain('regression-replay-');
    const passing = replayBrowserCasesFromChecks([regressionCase], [{
      ...browserChecks[0],
      passed: true,
      evidence: 'ok',
    }]);
    expect(passing[0].passed).toBe(true);
  });

  it('does not inject footer DOM assertions into an API-only replay scope', () => {
    const footerCase: RegressionCase = {
      id: 'reg-footer',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'browser',
      checkId: 'browser-dom-text-home',
      name: 'DOM assertion on /',
      expectedBehavior: 'exact visible text Sandbox VnV repair marker',
      browserRoute: '/',
      browserAssertions: [{ kind: 'text', value: 'Sandbox VnV repair marker' }],
      evidence: 'missing visible text: Sandbox VnV repair marker',
    };
    const footerFail: VerificationCheck = {
      id: 'browser-dom-text-home',
      category: 'browser',
      name: 'DOM assertion on /',
      passed: false,
      severity: 'HIGH',
      evidence: 'missing visible text: Sandbox VnV repair marker',
      acceptanceCriterion: 'exact visible text Sandbox VnV repair marker',
    };
    const replayed = replayBrowserCasesFromChecks([footerCase], [footerFail], {
      task: 'Unauthenticated POST /api/save must return 401 or 403. In app/api/save/route.ts.',
      acceptanceCriteria: [
        'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.',
      ],
      changedFiles: ['app/api/save/route.ts'],
    });
    expect(replayed).toHaveLength(0);
  });

  it('does not clone one DOM failure across unrelated stored cases', () => {
    const pageerrorCase: RegressionCase = {
      id: 'reg-pageerror',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'browser',
      checkId: 'browser-pageerror-home',
      name: 'Uncaught page error on /',
      expectedBehavior: 'The page must load without uncaught runtime exceptions',
      browserRoute: '/',
      browserAssertions: [{ kind: 'text', value: 'Sandbox VnV repair marker' }],
      evidence: 'pageerror: Error: controlled VnV crash beacon',
    };
    const consoleCase: RegressionCase = {
      id: 'reg-console',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'browser',
      checkId: 'browser-console-error-home',
      name: 'Console errors on /',
      expectedBehavior: 'The page must not emit console.error',
      browserRoute: '/',
      browserAssertions: [{ kind: 'text', value: 'Sandbox VnV repair marker' }],
      evidence: 'console.error: controlled VnV console beacon',
    };
    const footerFail: VerificationCheck = {
      id: 'browser-dom-text-home',
      category: 'browser',
      name: 'DOM assertion on /',
      passed: false,
      severity: 'HIGH',
      evidence: 'missing visible text: Sandbox VnV repair marker',
      acceptanceCriterion: 'exact visible text Sandbox VnV repair marker',
    };
    const replayed = replayBrowserCasesFromChecks([pageerrorCase, consoleCase], [footerFail]);
    expect(replayed.every(check => check.passed)).toBe(true);
  });

  it('preserves a historical API case instead of copying current UI assertions', () => {
    const prior: FailureContract = {
      id: 'fail-api-old',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      summary: '1 verification check(s) failed',
      severity: 'HIGH',
      category: 'api',
      failedChecks: [{
        id: 'api-missing-input-post-api-save',
        category: 'api',
        name: 'POST /api/save missing-input',
        passed: false,
        severity: 'HIGH',
        evidence: 'method: POST; URL: http://127.0.0.1:3010/api/save; route: /api/save; scenario: missing-input; Expected: 400|422; Actual: 500; request: {"title":"x"}; source: app/api/save/route.ts',
        acceptanceCriterion: 'expected HTTP 400|422 and never 5xx',
      }],
      acceptanceCriteria: ['POST /api/save must return 400'],
      repairInstructions: 'fix save',
      attempt: 1,
      expectation: { expectedBehavior: 'POST /api/save must satisfy 400|422' },
      location: { method: 'POST', route: '/api/save', url: 'http://127.0.0.1:3010/api/save', file: 'app/api/save/route.ts' },
      implicatedFiles: ['app/api/save/route.ts'],
      reproduction: { requestData: '{"title":"x"}' },
    };
    const stored = regressionCaseFromFailure(prior, {
      task: 'In app/page.tsx set the home-page footer exact visible text "Sandbox VnV repair marker" and data-testid=sandbox-vv-footer',
      qualityProfile: 'PRODUCTION',
      workspacePath: '/tmp',
      acceptanceCriteria: ['exact visible text Sandbox VnV repair marker'],
    });
    expect(stored).toBeDefined();
    expect(stored!.method).toBe('POST');
    expect(stored!.route).toBe('/api/save');
    expect(stored!.requestData).toBe('{"title":"x"}');
    expect(stored!.acceptanceCriterion).toBe('expected HTTP 400|422 and never 5xx');
    expect(stored!.browserAssertions).toBeUndefined();
    expect(JSON.stringify(stored)).not.toMatch(/sandbox-vv-footer/);
    expect(JSON.stringify(stored)).not.toMatch(/Sandbox VnV repair marker/);
  });
});
