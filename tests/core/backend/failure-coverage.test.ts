import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { backendReportToChecks } from '../../../src/core/backend/report-to-checks';
import { summarizeCoverage } from '../../../src/domain/endpoint-verification';
import { EndpointVerificationResult } from '../../../src/domain/endpoint-verification';
import { requiredBackendChecks } from '../../../src/core/backend/case-generator';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { validateTodoItem } from '../../../src/domain/todo-plan';

function result(overrides: Partial<EndpointVerificationResult>): EndpointVerificationResult {
  return {
    endpointId: 'POST /api/users',
    method: 'POST',
    path: '/api/users',
    status: 'FAIL',
    requestSummary: 'positive',
    responseSummary: '500',
    expected: 'positive:201',
    actual: 'positive:500',
    authResult: 'PASS',
    unhandledError: true,
    evidenceRefs: ['POST /api/users:positive'],
    failureType: 'UNHANDLED_EXCEPTION',
    failedTodoId: 'todo-3',
    persistenceResult: {
      status: 'FAIL',
      queried: true,
      reason: 'expected record not found',
      evidence: 'persistence: FAIL',
    },
    cases: [{
      kind: 'positive',
      status: 'FAIL',
      expectedStatuses: [201],
      actualStatus: 500,
      failureType: 'UNHANDLED_EXCEPTION',
      evidence: [
        'endpointId: POST /api/users',
        'method: POST',
        'path: /api/users',
        'expectedStatus: 201',
        'actualStatus: 500',
        'failureType: UNHANDLED_EXCEPTION',
        'failedTodoId: todo-3',
        'databaseVerificationStatus: FAIL',
      ].join('; '),
    }],
    authRequirement: 'AUTHENTICATED',
    adminRequired: false,
    timestamp: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('failure contract from endpoint verification', () => {
  it('records method, path, statuses, endpoint id, failure type, todo and db status', () => {
    const checks = backendReportToChecks({
      endpoints: [],
      results: [result({})],
      coverage: summarizeCoverage([result({})]),
    });
    const endpointCheck = checks.find(item => item.id.startsWith('endpoint-'));
    expect(endpointCheck).toBeDefined();
    const contract = buildFailureContract({
      profile: 'STANDARD',
      checks: [endpointCheck!],
      attempt: 1,
    });
    expect(contract).toBeDefined();
    expect(contract?.endpointId).toBe('POST /api/users');
    expect(contract?.location?.method).toBe('POST');
    expect(contract?.location?.route).toBe('/api/users');
    expect(contract?.expectedStatus).toBe('201');
    expect(contract?.actualStatus).toBe(500);
    expect(contract?.failureType).toBe('UNHANDLED_EXCEPTION');
    expect(contract?.failedTodoId).toBe('todo-3');
    expect(contract?.databaseVerificationStatus).toBe('FAIL');
    expect(contract?.evidenceRefs?.length).toBeGreaterThan(0);
  });

  it('keeps failedTodoId unknown when mapping is absent', () => {
    const checks = backendReportToChecks({
      endpoints: [],
      results: [result({
        failedTodoId: undefined,
        cases: [{
          kind: 'positive',
          status: 'FAIL',
          expectedStatuses: [201],
          actualStatus: 500,
          failureType: 'UNHANDLED_EXCEPTION',
          evidence: 'endpointId: POST /api/users; failedTodoId: UNKNOWN; actualStatus: 500; expectedStatus: 201; failureType: UNHANDLED_EXCEPTION',
        }],
      })],
      coverage: summarizeCoverage([result({ failedTodoId: undefined })]),
    });
    const contract = buildFailureContract({ profile: 'STANDARD', checks, attempt: 1 });
    expect(contract?.failedTodoId).toBeUndefined();
  });
});

describe('endpoint coverage summary', () => {
  it('counts discovered, tested, passed, failed, blocked and skipped with reasons', () => {
    const results: EndpointVerificationResult[] = [
      result({ status: 'PASS', endpointId: 'GET /a' }),
      result({ status: 'FAIL', endpointId: 'POST /b' }),
      result({ status: 'BLOCKED', endpointId: 'GET /c', skipReason: 'REQUIRES_TEST_CREDENTIAL' }),
      result({ status: 'SKIPPED_WITH_REASON', endpointId: 'GET /d', skipReason: 'out of task/file scope' }),
      result({ status: 'NOT_TESTED', endpointId: 'GET /e', skipReason: 'not discovered' }),
    ];
    const coverage = summarizeCoverage(results);
    expect(coverage).toMatchObject({
      discovered: 5,
      tested: 2,
      passed: 1,
      failed: 1,
      blocked: 1,
      skipped: 1,
      notTested: 1,
    });
    expect(coverage.skippedReasons).toEqual(expect.arrayContaining([
      { endpointId: 'GET /d', reason: 'out of task/file scope' },
      { endpointId: 'GET /e', reason: 'not discovered' },
    ]));
    const checks = backendReportToChecks({ endpoints: [], results, coverage });
    const coverageCheck = checks.find(item => item.id === 'api-endpoint-coverage');
    expect(coverageCheck?.passed).toBe(false);
    expect(coverageCheck?.evidence).toContain('Discovered: 5');
    expect(coverageCheck?.evidence).toContain('Skipped: 1');
  });
});

describe('skill verification requirements', () => {
  it('unions skill-mandated checks so a todo cannot drop them', () => {
    const skills = createDefaultSkillRegistry().list().filter(skill => skill.id === 'backend.api' || skill.id === 'backend.database-verification');
    const todo = validateTodoItem({
      id: 'todo-1',
      title: 'Add users',
      description: 'create endpoint',
      reason: 'task',
      files: ['src/users.controller.ts'],
      dependencies: [],
      skillIds: ['backend.api'],
      verificationRequirements: ['api'],
      risk: 'LOW',
    });
    const checks = requiredBackendChecks(skills, [todo]);
    expect(checks.has('endpoint')).toBe(true);
    expect(checks.has('auth')).toBe(true);
    expect(checks.has('validation')).toBe(true);
    expect(checks.has('error-handling')).toBe(true);
    expect(checks.has('database-read-check')).toBe(true);
    expect(checks.has('api')).toBe(true);
  });
});
