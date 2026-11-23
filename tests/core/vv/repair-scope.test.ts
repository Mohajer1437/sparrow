import { FailureContract } from '../../../src/domain/failure-contract';
import { ExecutionContract } from '../../../src/domain/pre-execution/contract';
import { ExecutionPlan, PlanStep } from '../../../src/domain/execution-plan';
import {
  collectEffectiveRepairScope,
  applyRepairScopeToPlan,
  expandContractFilesInScope,
  isRepairContext,
  buildCompactRepairObjective,
} from '../../../src/core/vv/repair-scope';

function contract(partial: Partial<FailureContract> = {}): FailureContract {
  return {
    id: 'fail-1',
    createdAt: new Date().toISOString(),
    qualityProfile: 'PRODUCTION',
    summary: '1 verification check(s) failed',
    failedChecks: [],
    acceptanceCriteria: ['Page must not throw'],
    repairInstructions: 'Do not patch around verification.\nImplicated files (must be in the repair plan): app/CrashBeacon.tsx',
    attempt: 1,
    location: { file: 'app/CrashBeacon.tsx', route: '/' },
    implicatedFiles: ['app/CrashBeacon.tsx'],
    ...partial,
  };
}

function plan(expectedFiles: string[] = ['app/page.tsx']): ExecutionPlan {
  return Object.freeze({
    id: 'plan-1',
    objective: 'Fix footer',
    complexity: 'simple',
    reasoning: 'test',
    steps: Object.freeze([
      Object.freeze({
        id: 'step-1',
        description: 'Update app/page.tsx footer',
        type: 'modify' as const,
        requiredTools: Object.freeze(['write_file']),
        expectedOutcome: 'footer updated',
        expectedFiles: Object.freeze(expectedFiles),
      }),
    ]),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
    createdAt: new Date().toISOString(),
    status: 'CREATED' as const,
  });
}

describe('collectEffectiveRepairScope', () => {
  it('preserves original task files and adds implicated files', () => {
    const scope = collectEffectiveRepairScope({
      originalTask: 'In app/page.tsx set the home-page footer exact visible text to Sandbox VnV repair marker',
      failureContract: contract(),
    });
    expect(scope).toEqual(['app/CrashBeacon.tsx', 'app/page.tsx']);
  });

  it('includes planner additional files without adding unrelated files', () => {
    const scope = collectEffectiveRepairScope({
      originalTask: 'In app/page.tsx set a footer',
      failureContract: contract(),
      plannerFiles: ['app/page.tsx', 'app/helpers.ts'],
    });
    expect(scope).toEqual(['app/CrashBeacon.tsx', 'app/helpers.ts', 'app/page.tsx']);
    expect(scope).not.toContain('app/unrelated.ts');
  });

  it('does not automatically include unrelated previously touched files', () => {
    const scope = collectEffectiveRepairScope({
      originalTask: 'POST /api/save in app/api/save/route.ts',
      failureContract: contract({
        implicatedFiles: ['app/api/save/route.ts'],
        location: { file: 'app/api/save/route.ts', route: '/api/save' },
      }),
      previousAttemptFiles: ['app/page.tsx', 'app/api/save/route.ts'],
    });
    expect(scope).toEqual(['app/api/save/route.ts']);
    expect(scope).not.toContain('app/page.tsx');
  });

  it('is deterministic', () => {
    const a = collectEffectiveRepairScope({
      originalTask: 'edit app/page.tsx',
      failureContract: contract(),
      plannerFiles: ['app/z.tsx', 'app/a.tsx'],
    });
    const b = collectEffectiveRepairScope({
      originalTask: 'edit app/page.tsx',
      failureContract: contract(),
      plannerFiles: ['app/a.tsx', 'app/z.tsx'],
    });
    expect(a).toEqual(b);
  });
});

describe('applyRepairScopeToPlan', () => {
  it('merges implicated files into expectedFiles', () => {
    const updated = applyRepairScopeToPlan(plan(['app/page.tsx']), ['app/page.tsx', 'app/CrashBeacon.tsx']);
    expect(updated.steps[0].expectedFiles).toEqual(['app/CrashBeacon.tsx', 'app/page.tsx']);
  });

  it('adds a modify step when the plan has no modify work', () => {
    const inspectOnly: ExecutionPlan = Object.freeze({
      ...plan(),
      steps: Object.freeze([
        Object.freeze({
          id: 'step-1',
          description: 'Inspect the issue',
          type: 'analysis' as const,
          requiredTools: Object.freeze(['read_file']),
          expectedOutcome: 'understood',
        }),
      ]),
    });
    const updated = applyRepairScopeToPlan(inspectOnly, ['app/CrashBeacon.tsx']);
    expect(updated.steps.some((step: PlanStep) => step.type === 'modify')).toBe(true);
    expect(updated.steps.some((step: PlanStep) => step.expectedFiles?.includes('app/CrashBeacon.tsx'))).toBe(true);
  });
});

describe('expandContractFilesInScope', () => {
  it('honors evidence-driven expansion and keeps unrelated files out', () => {
    const executionContract = {
      id: 'c1',
      filesInScope: ['app/page.tsx'],
    } as unknown as ExecutionContract;
    const expanded = expandContractFilesInScope(executionContract, ['app/page.tsx', 'app/CrashBeacon.tsx']);
    expect(expanded.filesInScope).toEqual(['app/CrashBeacon.tsx', 'app/page.tsx']);
    expect(expanded.filesInScope).not.toContain('lib/secret.ts');
  });
});

describe('isRepairContext', () => {
  it('detects failed verification repair state', () => {
    expect(isRepairContext({ metadata: { repair: 'true' } })).toBe(true);
    expect(isRepairContext({ metadata: {} })).toBe(false);
    expect(isRepairContext({})).toBe(false);
  });
});

describe('buildCompactRepairObjective', () => {
  it('names implicated files and required outcome without dumping the full contract', () => {
    const text = buildCompactRepairObjective({
      originalTask: 'In app/page.tsx set the home-page footer exact visible text to Sandbox VnV repair marker.',
      failureContract: contract({
        expectation: { expectedBehavior: 'The page must load without uncaught runtime exceptions' },
        repairContract: { requiredOutcome: 'The page must load without uncaught runtime exceptions' },
        location: { file: 'app/CrashBeacon.tsx', testId: 'sandbox-vv-footer' },
      }),
    });
    expect(text).toContain('VERIFICATION REPAIR');
    expect(text).toContain('app/CrashBeacon.tsx');
    expect(text).toContain('app/page.tsx');
    expect(text).toContain('sandbox-vv-footer');
    expect(text).toContain(' | ');
    expect(text.split(/[.;]/).length).toBeLessThan(12);
    expect(text).toContain('Do not remove previously satisfied acceptance markers');
    expect(text).not.toContain('FAILED CHECKS');
  });

  it('does not put unrelated previous-attempt files into the compact objective', () => {
    const text = buildCompactRepairObjective({
      originalTask: 'POST /api/save in app/api/save/route.ts',
      failureContract: contract({ implicatedFiles: ['app/api/save/route.ts'], location: { file: 'app/api/save/route.ts' } }),
      previousAttemptFiles: ['app/helpers.ts', 'app/page.tsx'],
    });
    expect(text).toContain('app/api/save/route.ts');
    expect(text).not.toContain('app/helpers.ts');
    expect(text).not.toContain('app/page.tsx');
  });
});
