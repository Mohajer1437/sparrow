import { formatFailureContract } from '../../../src/domain/failure-contract';
import { PLANNER_SYSTEM_PROMPT, PLANNER_USER_TEMPLATE } from '../../../src/core/planning/planner-prompt';

describe('failure contract handoff', () => {
  it('preserves implicated files, expected/actual behavior, evidence, and repair requirements', () => {
    const formatted = formatFailureContract({
      id: 'fail-1',
      createdAt: '2026-08-24T00:00:00.000Z',
      qualityProfile: 'PRODUCTION',
      summary: '1 verification check(s) failed',
      category: 'browser',
      severity: 'HIGH',
      failedChecks: [{
        id: 'browser-pageerror-home',
        category: 'browser',
        name: 'Uncaught page error on /',
        passed: false,
        severity: 'HIGH',
        evidence: 'pageerror: Error: controlled VnV crash beacon',
        acceptanceCriterion: 'Page / must not throw uncaught runtime exceptions',
      }],
      acceptanceCriteria: ['The page must load without uncaught runtime exceptions'],
      repairInstructions: 'Fix the throwing module.\nImplicated files (must be in the repair plan): app/CrashBeacon.tsx',
      attempt: 1,
      expectation: { expectedBehavior: 'The page must load without uncaught runtime exceptions' },
      actual: { actualBehavior: 'pageerror: Error: controlled VnV crash beacon' },
      location: { file: 'app/CrashBeacon.tsx', url: 'http://127.0.0.1:3010/', route: '/', testId: 'sandbox-vv-footer' },
      implicatedFiles: ['app/CrashBeacon.tsx'],
      repairContract: {
        requiredOutcome: 'The page must load without uncaught runtime exceptions',
        constraints: ['Do not patch around verification'],
        mustNotChange: ['authentication'],
      },
    });

    expect(formatted).toContain('Implicated files: app/CrashBeacon.tsx');
    expect(formatted).toContain('File: app/CrashBeacon.tsx');
    expect(formatted).toContain('Expected: The page must load without uncaught runtime exceptions');
    expect(formatted).toContain('Actual: pageerror: Error: controlled VnV crash beacon');
    expect(formatted).toContain('pageerror: Error: controlled VnV crash beacon');
    expect(formatted).toContain('Required outcome: The page must load without uncaught runtime exceptions');
    expect(formatted).toContain('Do not patch around verification');
    expect(formatted).toContain('Test id: sandbox-vv-footer');
  });
});

describe('planner repair prompt', () => {
  it('distinguishes verification repair from the original task', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/VERIFICATION REPAIR/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/not a continuation/i);
    expect(PLANNER_USER_TEMPLATE).toMatch(/not a continuation/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/expectedFiles MUST include every implicated file/i);
  });
});
