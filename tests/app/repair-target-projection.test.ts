/**
 * R4.35/R4.36: CLI, REPL and the Web UI must all render the same repair
 * targeting verdict, which means the verdict has to survive projection from
 * the WorkflowResult into the run snapshot without any interface recomputing
 * it. This test walks that chain for both a refused and an accepted repair.
 */

import { projectTaskRun } from '../../src/app/task-run-projection';
import { buildRepairObjective, validateRepairPlan } from '../../src/core/repair/repair-target-policy';
import { evaluateRepairCompletion } from '../../src/core/repair/repair-outcome-analysis';
import { RepairTargetRecord } from '../../src/domain/repair/repair-target-record';
import { WorkflowResult } from '../../src/contracts/workflow-orchestrator';
import { TodoItem, TodoPlan } from '../../src/domain/todo-plan';

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    title: 'Fix the component',
    description: '',
    reason: '',
    files: ['app/CrashBeacon.tsx'],
    dependencies: [],
    skillIds: ['frontend.core'],
    verificationRequirements: ['typecheck'],
    risk: 'LOW',
    action: 'modify',
    ...over,
  } as TodoItem;
}

function plan(todos: ReadonlyArray<TodoItem>): TodoPlan {
  return {
    goal: 'goal',
    contextSummary: '',
    affectedFiles: todos.flatMap(item => [...item.files]),
    constraints: [],
    todos,
  } as TodoPlan;
}

/**
 * Reproduces exactly what the orchestrator assembles: build the objective from
 * the original run, validate the proposed repair, then attach completion.
 */
function makeRecord(repairTitle: string, repairFiles: string[]): RepairTargetRecord {
  const objective = buildRepairObjective({
    originalTask: 'Fix the CrashBeacon component so the page renders the beacon marker',
    acceptanceCriteria: ['The page renders an element with data-testid="crash-beacon"'],
    originalTodoPlan: plan([todo()]),
    failedTodoId: 'todo-1',
    primaryFailure: 'build failed: unexpected token',
    primaryFailureCheckId: 'build',
  });
  const validation = validateRepairPlan({
    objective,
    repairPlan: plan([todo({ title: repairTitle, files: repairFiles })]),
  });
  const completion = evaluateRepairCompletion({
    objective,
    primaryResolved: true,
    verificationPassed: true,
    scopeRespected: !validation.findings.some(f => f.kind === 'SCOPE_ESCAPE'),
    findings: validation.findings,
  });
  return {
    attemptId: 'attempt-2',
    attemptNumber: 2,
    originalTask: objective.originalTask,
    acceptanceCriteria: objective.acceptanceCriteria,
    intent: objective.intent,
    intentConfidence: objective.intentConfidence,
    intentEvidence: objective.intentEvidence,
    originalTodoId: objective.originalTodoId,
    originalFiles: objective.originalFiles,
    primaryFailure: objective.primaryFailure,
    allowedFiles: objective.allowedFiles,
    allowedOperations: objective.allowedOperations,
    proposedFiles: validation.proposedFiles,
    proposedOperations: validation.proposedOperations,
    disallowedFiles: validation.disallowedFiles,
    decision: validation.decision,
    decisionReason: validation.reason,
    findings: validation.findings,
    completion,
  };
}

function workflowResult(target: RepairTargetRecord): WorkflowResult {
  return {
    sessionId: 'session-1',
    success: false,
    plan: null,
    impactReport: null,
    reviewReport: null,
    patchResult: null,
    reflection: null,
    repairTarget: target,
    repairOutcome: 'REPAIR_ACCEPTANCE_CHASING',
  } as unknown as WorkflowResult;
}

describe('R4.36 repair targeting reaches every interface through one projection', () => {
  it('projects a refused acceptance-chasing repair', () => {
    const record = makeRecord('Delete the failing component', ['app/CrashBeacon.tsx']);
    expect(record.decision).toBe('BLOCK');

    const snapshot = projectTaskRun({
      taskId: 'task-1',
      task: 'Fix the CrashBeacon component',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-01-01T00:00:00.000Z',
      workflowResult: workflowResult(record),
    } as any);

    const view = snapshot.repair?.target;
    expect(view).toBeDefined();
    expect(view!.decision).toBe('BLOCK');
    expect(view!.intent).toBe('FIX_BUG');
    expect(view!.originalTask).toBe(record.originalTask);
    expect(view!.allowedFiles).toEqual(['app/CrashBeacon.tsx']);
    expect(view!.findings.map(f => f.kind)).toEqual(
      expect.arrayContaining(['ACCEPTANCE_CHASING', 'INTENT_MISMATCH']),
    );
    // The decisive projection: verification passed, and the run is still not
    // a success.
    expect(view!.completion!.verificationPassed).toBe(true);
    expect(view!.completion!.state).toBe('ACCEPTANCE_CHASING_DETECTED');
    expect(view!.completion!.succeeded).toBe(false);
    expect(view!.completion!.acceptancePreserved).toBe(false);
  });

  it('projects an out-of-scope repair with the offending file named', () => {
    const record = makeRecord('Adjust the footer instead', ['app/footer.tsx']);
    const snapshot = projectTaskRun({
      taskId: 'task-1',
      task: 'Fix the CrashBeacon component',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-01-01T00:00:00.000Z',
      workflowResult: workflowResult(record),
    } as any);

    const view = snapshot.repair?.target;
    expect(view!.decision).toBe('BLOCK');
    expect(view!.disallowedFiles).toEqual(['app/footer.tsx']);
    expect(view!.findings.map(f => f.kind)).toContain('SCOPE_ESCAPE');
    expect(view!.completion!.scopeRespected).toBe(false);
  });

  it('projects a legitimate repair as allowed and complete', () => {
    const record = makeRecord('Restore the missing closing tag', ['app/CrashBeacon.tsx']);
    expect(record.decision).toBe('ALLOW');

    const snapshot = projectTaskRun({
      taskId: 'task-1',
      task: 'Fix the CrashBeacon component',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-01-01T00:00:00.000Z',
      workflowResult: {
        ...workflowResult(record),
        success: true,
        repairOutcome: 'PROCEED',
      } as unknown as WorkflowResult,
    } as any);

    const view = snapshot.repair?.target;
    expect(view!.decision).toBe('ALLOW');
    expect(view!.findings).toEqual([]);
    expect(view!.completion!.state).toBe('PRIMARY_RESOLVED');
    expect(view!.completion!.succeeded).toBe(true);
    expect(view!.completion!.acceptancePreserved).toBe(true);
  });

  it('omits the target entirely when a run never repaired', () => {
    const snapshot = projectTaskRun({
      taskId: 'task-1',
      task: 'Fix the CrashBeacon component',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-01-01T00:00:00.000Z',
      workflowResult: { sessionId: 's', success: true } as unknown as WorkflowResult,
    } as any);
    expect(snapshot.repair?.target).toBeUndefined();
  });
});
