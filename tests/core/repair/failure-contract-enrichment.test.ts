import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { enrichFailureContract } from '../../../src/core/repair/failure-contract-enrichment';
import { todoPlanToExecutionPlan } from '../../../src/core/planning/todo-plan-to-execution-plan';
import { validateTodoPlan } from '../../../src/domain/todo-plan';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('Failure Contract enrichment', () => {
  it('preserves repair-relevant provenance', () => {
    const checks: VerificationCheck[] = [{
      id: 'intent-authz-post--api-save',
      category: 'api',
      name: 'Intent POST /api/save',
      passed: false,
      severity: 'HIGH',
      evidence: 'method: POST; route: /api/save; Expected: 401|403; Actual: 500; source: app/api/save/route.ts; todo-2',
      acceptanceCriterion: 'Unauthenticated POST /api/save must return 401 or 403.',
    }];
    const todoPlan = validateTodoPlan({
      goal: 'Fix authz',
      contextSummary: 'save route',
      affectedFiles: ['app/api/save/route.ts'],
      constraints: [],
      todos: [{
        id: 'todo-1',
        title: 'Inspect',
        description: 'Read route',
        reason: 'context',
        files: ['app/api/save/route.ts'],
        dependencies: [],
        skillIds: ['backend.core'],
        verificationRequirements: ['api'],
        risk: 'LOW',
        action: 'inspect',
      }, {
        id: 'todo-2',
        title: 'Fix save route',
        description: 'Return 401',
        reason: 'authz',
        files: ['app/api/save/route.ts'],
        dependencies: ['todo-1'],
        skillIds: ['backend.core'],
        verificationRequirements: ['api'],
        risk: 'HIGH',
        action: 'modify',
      }],
    });
    const plan = todoPlanToExecutionPlan(todoPlan, ['read_file', 'write_file', 'apply_patch']);
    const built = buildFailureContract({
      profile: 'STANDARD',
      checks,
      attempt: 1,
      acceptanceCriteria: ['Unauthenticated POST /api/save must return 401 or 403.'],
    });
    expect(built).toBeDefined();
    const enriched = enrichFailureContract({
      contract: built!,
      plan,
      stepResults: [{ stepId: 'todo-2', success: false }],
      attemptId: 'attempt-1',
    });
    expect(enriched.failedTodoId).toBe('todo-2');
    expect(enriched.failedStepId).toBe('todo-2');
    expect(enriched.attemptId).toBe('attempt-1');
    expect(enriched.expectation?.expectedBehavior).toMatch(/401/);
    expect(enriched.actual?.actualBehavior).toMatch(/500/);
    expect(enriched.evidenceRefs).toContain('intent-authz-post--api-save');
    expect(enriched.implicatedFiles).toContain('app/api/save/route.ts');
    expect(enriched.classification).toBe('PRIMARY');
    expect(enriched.failureType).toBe('api');
  });
});
