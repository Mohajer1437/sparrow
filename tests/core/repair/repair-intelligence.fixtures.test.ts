import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { enrichFailureContract } from '../../../src/core/repair/failure-contract-enrichment';
import { appendRepairAttempt } from '../../../src/core/repair/repair-attempt-history';
import { buildRepairContext, expandRepairFiles } from '../../../src/core/repair/repair-context';
import { applyRepairTodoPlanPolicy } from '../../../src/core/repair/repair-todo-plan-policy';
import { isDuplicateRepairPlan } from '../../../src/core/repair/duplicate-repair-plan';
import { evaluateRepairLimits } from '../../../src/core/repair/repair-limits';
import { mapVerificationToTodos } from '../../../src/core/repair/todo-verification-trace';
import { todoPlanToExecutionPlan } from '../../../src/core/planning/todo-plan-to-execution-plan';
import {
  DEFAULT_REPAIR_LIMITS,
  emptyRepairHistory,
  fingerprintRepairPlan,
} from '../../../src/domain/repair-intelligence';
import { validateTodoPlan } from '../../../src/domain/todo-plan';
import { VerificationCheck } from '../../../src/domain/verification-check';

/**
 * Controlled Failure Contract fixtures for repair intelligence (E2E B-F).
 * Does not mutate a live application.
 */
describe('repair intelligence controlled fixtures', () => {
  const check: VerificationCheck = {
    id: 'intent-authz-post--api-save',
    category: 'api',
    name: 'Intent POST /api/save',
    passed: false,
    severity: 'HIGH',
    evidence: 'method: POST; route: /api/save; Expected: 401; Actual: 500; source: app/api/save/route.ts; todo-2',
    acceptanceCriterion: 'Unauthenticated POST /api/save must return 401.',
  };

  const originalPlan = todoPlanToExecutionPlan(validateTodoPlan({
    goal: 'Fix POST /api/save authorization',
    contextSummary: 'authz',
    affectedFiles: ['app/api/save/route.ts'],
    constraints: [],
    todos: [{
      id: 'todo-1',
      title: 'Inspect save route',
      description: 'Read the handler',
      reason: 'context',
      files: ['app/api/save/route.ts'],
      dependencies: [],
      skillIds: ['backend.core'],
      verificationRequirements: ['api'],
      risk: 'LOW',
      action: 'inspect',
    }, {
      id: 'todo-2',
      title: 'Fix save authorization',
      description: 'Return 401 for unauthenticated POST /api/save',
      reason: 'product QA',
      files: ['app/api/save/route.ts'],
      dependencies: ['todo-1'],
      skillIds: ['backend.core'],
      verificationRequirements: ['api'],
      risk: 'HIGH',
      action: 'modify',
    }],
  }), ['read_file', 'write_file', 'apply_patch']);

  it('B: Failure Contract identifies failedTodoId from known Todo evidence', () => {
    const contract = enrichFailureContract({
      contract: buildFailureContract({ profile: 'STANDARD', checks: [check], attempt: 1 })!,
      plan: originalPlan,
      stepResults: [{ stepId: 'todo-2', success: true }],
      attemptId: 'attempt-1',
    });
    expect(contract.failedTodoId).toBe('todo-2');
    expect(contract.classification).toBe('PRIMARY');
  });

  it('C: Failure Contract + history + context produce a bounded Repair TodoPlan', () => {
    const contract = enrichFailureContract({
      contract: buildFailureContract({ profile: 'STANDARD', checks: [check], attempt: 1 })!,
      plan: originalPlan,
      attemptId: 'attempt-1',
    });
    const history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'ORIGINAL',
      failedTodoId: 'todo-2',
      todoIds: ['todo-2'],
      planFingerprint: fingerprintRepairPlan(originalPlan),
      filesTouched: ['middleware.ts'],
      expected: '401',
      actual: '500',
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: [check.id],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    const context = buildRepairContext({
      originalTask: 'Fix POST /api/save authorization',
      failureContract: contract,
      failedTodoId: 'todo-2',
      failedTodoFiles: ['app/api/save/route.ts'],
      history,
      expansionLevel: 0,
      limits: DEFAULT_REPAIR_LIMITS,
    });
    const repairPlan = applyRepairTodoPlanPolicy({
      todoPlan: validateTodoPlan({
        goal: 'Repair POST /api/save 500',
        contextSummary: 'Observed 500 after middleware change; hypothesis unconfirmed',
        affectedFiles: ['app/api/save/route.ts', 'src/unrelated.ts'],
        constraints: ['do not repeat middleware-only change'],
        failedTodoId: 'todo-2',
        todos: [{
          id: 'todo-1',
          title: 'Repair save route',
          description: 'Fix the failing POST /api/save path, not a full auth refactor',
          reason: 'Primary failure is POST /api/save 500; previous middleware change is evidence',
          files: ['app/api/save/route.ts'],
          dependencies: [],
          skillIds: ['backend.core'],
          verificationRequirements: ['api', 'intent-contract'],
          risk: 'HIGH',
          action: 'modify',
        }],
      }),
      failedTodoId: contract.failedTodoId,
      allowedFiles: context.candidateFiles,
      maxRepairFiles: DEFAULT_REPAIR_LIMITS.maxRepairFiles,
    });
    expect(repairPlan.failedTodoId).toBe('todo-2');
    expect(repairPlan.todos[0].id).toBe('todo-1');
    expect(repairPlan.affectedFiles).toContain('app/api/save/route.ts');
    expect(repairPlan.affectedFiles).not.toContain('src/unrelated.ts');
    expect(isDuplicateRepairPlan({
      history,
      nextFingerprint: fingerprintRepairPlan(repairPlan),
      expansionLevel: 0,
      evidenceRefs: contract.evidenceRefs ?? [],
    })).toBe(false);
  });

  it('D: second attempt keeps history and expands context without replaying the same plan', () => {
    const firstFingerprint = 'middleware.ts::modify|Change middleware|middleware.ts';
    let history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'ORIGINAL',
      failedTodoId: 'todo-2',
      todoIds: ['todo-2'],
      planFingerprint: firstFingerprint,
      filesTouched: ['middleware.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: [check.id],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    history = appendRepairAttempt(history, {
      kind: 'REPAIR',
      failedTodoId: 'todo-2',
      todoIds: ['todo-1'],
      planFingerprint: firstFingerprint,
      filesTouched: ['middleware.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: [check.id],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    expect(history.attempts[0].attemptId).toBe('attempt-1');
    expect(history.attempts[1].attemptId).toBe('attempt-2');
    // R3: the seed set no longer invents sibling paths at level 1, so the
    // proof that this attempt differs is the raised expansion level rather
    // than a longer file list. Real widening is asserted against evidence in
    // tests/core/repair/expansion-candidates.test.ts.
    expect(expandRepairFiles(['middleware.ts'], 1, 8)).toEqual(['middleware.ts']);
    expect(isDuplicateRepairPlan({
      history,
      nextFingerprint: firstFingerprint,
      expansionLevel: 1,
      evidenceRefs: [check.id],
    })).toBe(false);
  });

  it('E: maxRepairAttempts produces REPAIR_LIMIT_REACHED', () => {
    let history = emptyRepairHistory();
    history = appendRepairAttempt(history, {
      kind: 'REPAIR',
      todoIds: ['todo-1'],
      planFingerprint: 'a',
      filesTouched: ['a.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: [],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    history = appendRepairAttempt(history, {
      kind: 'REPAIR',
      todoIds: ['todo-1'],
      planFingerprint: 'b',
      filesTouched: ['b.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: [],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    expect(evaluateRepairLimits({
      history,
      limits: { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
      expansionLevel: 0,
      candidateFileCount: 1,
      startingRepair: true,
    })).toBe('REPAIR_LIMIT_REACHED');
  });

  it('F: whole-run V&V does not claim todo-2 = PASS', () => {
    const trace = mapVerificationToTodos({
      plan: originalPlan,
      checks: [{
        id: 'browser-whole-run',
        category: 'browser',
        name: 'page',
        passed: true,
        severity: 'LOW',
        evidence: 'page loaded',
      }],
    });
    expect(trace.scope).toBe('WHOLE_RUN');
    expect(trace.verdicts.find(item => item.todoId === 'todo-2')).toEqual({
      todoId: 'todo-2',
      scope: 'WHOLE_RUN',
      verdict: 'UNKNOWN',
    });
  });
});
