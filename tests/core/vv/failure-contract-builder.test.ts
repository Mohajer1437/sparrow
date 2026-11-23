import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { formatFailureContract } from '../../../src/domain/failure-contract';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('buildFailureContract', () => {
  it('returns undefined when all checks pass', () => {
    const checks: VerificationCheck[] = [{
      id: 'ok', category: 'deterministic', name: 'Typecheck', passed: true, severity: 'LOW', evidence: 'ok',
    }];
    expect(buildFailureContract({ profile: 'STANDARD', checks })).toBeUndefined();
  });

  it('builds planner-facing repair instructions from failed checks', () => {
    const checks: VerificationCheck[] = [{
      id: 'deterministic-build',
      category: 'deterministic',
      name: 'Production build',
      passed: false,
      severity: 'CRITICAL',
      evidence: 'tsc failed',
      acceptanceCriterion: 'Build script exits 0',
    }];
    const contract = buildFailureContract({ profile: 'PRODUCTION', checks, attempt: 1 });
    expect(contract).toBeDefined();
    expect(contract!.failedChecks).toHaveLength(1);
    expect(contract!.repairInstructions).toContain('Production build');
    expect(contract!.acceptanceCriteria).toContain('Build script exits 0');
    expect(contract!.repairContract?.requiredOutcome).toContain('Build script exits 0');
    expect(contract!.expectation?.expectedBehavior).toContain('Build script exits 0');
    expect(contract!.verification?.originalCheck).toBe('deterministic-build');
    expect(contract!.actual?.actualBehavior).toContain('tsc failed');
    expect(contract!.attempt).toBe(1);
    expect(contract!.attemptId).toBe('attempt-1');
  });

  it('normalizes attempt 0 to stable attempt-1', () => {
    const checks: VerificationCheck[] = [{
      id: 'deterministic-build',
      category: 'deterministic',
      name: 'Production build',
      passed: false,
      severity: 'CRITICAL',
      evidence: 'tsc failed',
    }];
    const contract = buildFailureContract({ profile: 'STANDARD', checks, attempt: 0 });
    expect(contract!.attempt).toBe(1);
    expect(contract!.attemptId).toBe('attempt-1');
  });

  it('captures API method, route, scenario, expected/actual, and source in the contract', () => {
    const checks: VerificationCheck[] = [{
      id: 'api-missing-input-post-api-save',
      category: 'api',
      name: 'POST /api/save missing-input',
      passed: false,
      severity: 'HIGH',
      evidence: 'method: POST; URL: http://127.0.0.1:3010/api/save; route: /api/save; scenario: missing-input; Expected: 400|422; Actual: 500; response: Failed to save; source: app/api/save/route.ts',
      acceptanceCriterion: 'JSON body missing required fields; expected HTTP 400|422 and never 5xx',
    }];
    const contract = buildFailureContract({ profile: 'PRODUCTION', checks, attempt: 1 });
    expect(contract!.location?.method).toBe('POST');
    expect(contract!.location?.route).toBe('/api/save');
    expect(contract!.location?.url).toContain('/api/save');
    expect(contract!.location?.file).toBe('app/api/save/route.ts');
    expect(contract!.reproduction?.environment).toMatch(/scenario=missing-input/);
    expect(contract!.expectation?.expectedBehavior).toMatch(/400\|422/);
  });

  it('captures structured browser expected/actual and selector', () => {
    const checks: VerificationCheck[] = [{
      id: 'browser-dom-testid-home',
      category: 'browser',
      name: 'DOM assertion on /',
      passed: false,
      severity: 'HIGH',
      evidence: 'URL: http://127.0.0.1:3010/; route: /; HTTP status: 200; test id: sandbox-vv-footer; selector: [data-testid="sandbox-vv-footer"]; Expected: [data-testid="sandbox-vv-footer"]; Actual: element not found',
      acceptanceCriterion: 'Element with test id "sandbox-vv-footer" must be visible',
    }];
    const contract = buildFailureContract({ profile: 'PRODUCTION', checks, attempt: 1 });
    expect(contract!.location?.testId).toBe('sandbox-vv-footer');
    expect(contract!.location?.selector).toBe('[data-testid="sandbox-vv-footer"]');
    expect(contract!.location?.route).toBe('/');
    expect(contract!.expectation?.expectedBehavior).toContain('[data-testid="sandbox-vv-footer"]');
  });

  it('implicates source files and missing test ids from local acceptance-contract checks', () => {
    const checks: VerificationCheck[] = [{
      id: 'acceptance-missing-testid-sandbox-p21-assumed',
      category: 'deterministic',
      name: 'acceptance-missing-testid-sandbox-p21-assumed',
      passed: false,
      severity: 'HIGH',
      evidence: 'Required data-testid="sandbox-p21-assumed" is missing from implementation files; source: app/page.tsx',
      acceptanceCriterion: 'Element with data-testid="sandbox-p21-assumed" must be present',
    }];
    const contract = buildFailureContract({ profile: 'PRODUCTION', checks, attempt: 1 });
    expect(contract!.location?.testId).toBe('sandbox-p21-assumed');
    expect(contract!.location?.file).toBe('app/page.tsx');
    expect(contract!.repairContract?.constraints).toEqual(expect.arrayContaining([
      expect.stringMatching(/previously satisfied acceptance markers/),
    ]));
  });

  it('ranks intent-authz as PRIMARY over api-runtime and browser-dom-text-home', () => {
    const authzCriterion = 'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.';
    const checks: VerificationCheck[] = [
      {
        id: 'api-runtime',
        category: 'api',
        name: 'API runtime availability',
        passed: false,
        severity: 'HIGH',
        evidence: 'PRODUCTION requires live API verification but http://127.0.0.1:3010 is not reachable',
        acceptanceCriterion: 'HTTP API server is reachable for discovered routes',
      },
      {
        id: 'browser-dom-text-home',
        category: 'browser',
        name: 'DOM assertion on /',
        passed: false,
        severity: 'HIGH',
        evidence: 'missing visible text: Sandbox VnV repair marker',
        acceptanceCriterion: 'exact visible text Sandbox VnV repair marker',
      },
      {
        id: 'intent-authz-post--api-save',
        category: 'api',
        name: 'Intent POST /api/save unauthenticated',
        passed: false,
        severity: 'HIGH',
        evidence: 'method: POST; URL: http://127.0.0.1:3010/api/save; route: /api/save; scenario: intent-unauthorized; Expected: 401|403; Actual: 200; source: app/api/save/route.ts',
        acceptanceCriterion: authzCriterion,
      },
    ];
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks,
      attempt: 1,
      acceptanceCriteria: [authzCriterion],
    });
    expect(contract!.primaryFailure?.check.id).toBe('intent-authz-post--api-save');
    expect(contract!.primaryFailure?.role).toBe('PRIMARY');
    expect(contract!.verification?.originalCheck).toBe('intent-authz-post--api-save');
    expect(contract!.secondaryFailures?.map(item => item.check.id)).toEqual(
      expect.arrayContaining(['api-runtime']),
    );
    expect(contract!.incidentalFailures?.map(item => item.check.id)).toEqual(
      expect.arrayContaining(['browser-dom-text-home']),
    );
    expect(contract!.incidentalFailures?.every(item => item.role === 'INCIDENTAL')).toBe(true);
  });

  it('takes requiredOutcome from the failed Product QA acceptance criterion', () => {
    const authzCriterion = 'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.';
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks: [
        {
          id: 'api-happy-path-get--api-save',
          category: 'api',
          name: 'GET /api/save happy-path',
          passed: false,
          severity: 'HIGH',
          evidence: 'method: GET; route: /api/save; scenario: happy-path; Expected: 200|201; Actual: 401',
        },
        {
          id: 'intent-authz-post--api-save',
          category: 'api',
          name: 'Intent POST /api/save unauthenticated',
          passed: false,
          severity: 'HIGH',
          evidence: 'method: POST; route: /api/save; Expected: 401|403; Actual: 200; source: app/api/save/route.ts',
          acceptanceCriterion: authzCriterion,
        },
      ],
      acceptanceCriteria: [authzCriterion],
      attempt: 1,
    });
    expect(contract!.repairContract?.requiredOutcome).toBe(authzCriterion);
    expect(contract!.primaryFailure?.requiredOutcome).toBe(authzCriterion);
    expect(contract!.primaryFailure?.acceptanceCriterion).toBe(authzCriterion);
  });

  it('makes PRIMARY vs INCIDENTAL explicit in the formatted contract', () => {
    const authzCriterion = 'Unauthenticated POST /api/save must return 401 or 403.';
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks: [
        {
          id: 'browser-dom-text-home',
          category: 'browser',
          name: 'DOM assertion on /',
          passed: false,
          severity: 'MEDIUM',
          evidence: 'missing visible text: Foo',
        },
        {
          id: 'intent-authz-post--api-save',
          category: 'api',
          name: 'Intent POST /api/save unauthenticated',
          passed: false,
          severity: 'HIGH',
          evidence: 'method: POST; route: /api/save; Expected: 401|403; Actual: 200; source: app/api/save/route.ts',
          acceptanceCriterion: authzCriterion,
        },
      ],
      acceptanceCriteria: [authzCriterion],
    });
    const formatted = formatFailureContract(contract!);
    expect(formatted).toMatch(/PRIMARY FAILURE/);
    expect(formatted).toMatch(/INCIDENTAL FAILURES/);
    expect(formatted).toContain('intent-authz-post--api-save');
    expect(contract!.repairInstructions).toMatch(/PRIMARY FAILURE \(this is why the result was rejected\)/);
    expect(contract!.repairInstructions).toMatch(/do not override the primary product objective/i);
  });

  it('does not add mustNotChange authentication for an authorization acceptance failure', () => {
    const authzCriterion = 'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.';
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks: [{
        id: 'intent-authz-post--api-save',
        category: 'api',
        name: 'Intent POST /api/save unauthenticated',
        passed: false,
        severity: 'HIGH',
        evidence: 'method: POST; route: /api/save; Expected: 401|403; Actual: 200; source: app/api/save/route.ts',
        acceptanceCriterion: authzCriterion,
      }],
      acceptanceCriteria: [authzCriterion],
    });
    expect(contract!.repairContract?.mustNotChange).not.toEqual(expect.arrayContaining(['authentication']));
  });

  it('does not implicate a phantom app/api/save/route/route.ts file', () => {
    const contract = buildFailureContract({
      profile: 'PRODUCTION',
      checks: [{
        id: 'intent-authz-post--api-save',
        category: 'api',
        name: 'Intent POST /api/save unauthenticated',
        passed: false,
        severity: 'HIGH',
        evidence: 'method: POST; route: /api/save; Expected: 401|403; Actual: 200; source: app/api/save/route/route.ts',
        acceptanceCriterion: 'Unauthenticated POST /api/save must return 401 or 403.',
      }],
      acceptanceCriteria: ['Unauthenticated POST /api/save must return 401 or 403.'],
    });
    expect(contract!.implicatedFiles).toEqual(['app/api/save/route.ts']);
    expect(contract!.location?.file).toBe('app/api/save/route.ts');
    expect(contract!.implicatedFiles?.join(',')).not.toContain('route/route.ts');
  });
});
