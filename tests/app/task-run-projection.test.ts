import { projectContextContent, projectTaskRun } from '../../src/app/task-run-projection';
import { REDACTED } from '../../src/app/secret-redaction';
import {
  WORKSPACE_ROOT,
  makeExecutionPlan,
  makeFailureContract,
  makePlannerContext,
  makeRepairHistory,
  makeVerificationReport,
  makeWorkflowResult,
} from './fixtures/run-fixtures';

const BASE = {
  taskId: 'task-1',
  task: 'Inspect app/page.tsx',
  roleId: 'coder',
  workspaceRoot: WORKSPACE_ROOT,
  startedAt: '2026-08-28T10:00:00.000Z',
  completedAt: '2026-08-28T10:07:00.000Z',
};

describe('task run projection', () => {
  it('projects the workspace state comparison so wrong-file evidence survives', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult({
        stateComparison: {
          filesModified: ['app/page.tsx'],
          filesCreated: [],
          filesDeleted: [],
          unexpectedChanges: ['app/layout.tsx'],
          hasUnexpectedChanges: true,
        },
      }),
    });

    expect(snapshot.workspaceIntegrity).toEqual({
      filesModified: ['app/page.tsx'],
      filesCreated: [],
      filesDeleted: [],
      unexpectedChanges: ['app/layout.tsx'],
      hasUnexpectedChanges: true,
    });
  });

  it('leaves workspace integrity absent when the Core produced no comparison', () => {
    const snapshot = projectTaskRun({ ...BASE, success: true, workflowResult: makeWorkflowResult() });
    expect(snapshot.workspaceIntegrity).toBeUndefined();
  });

  it('projects project, skills, strategy and context provenance', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult(),
    });

    expect(snapshot.status).toBe('COMPLETED');
    expect(snapshot.workspaceRoot).toBe(WORKSPACE_ROOT);
    expect(snapshot.project?.projectType).toBe('frontend');
    expect(snapshot.skills.map(skill => skill.id)).toContain('frontend.core');
    expect(snapshot.skills[0].resolutionSource).toBe('system-rule');
    expect(snapshot.contextStrategy?.selectedSources.length).toBeGreaterThan(0);

    const collected = snapshot.context.find(item => item.reference === 'app/page.tsx');
    expect(collected).toMatchObject({
      source: 'SOURCE_FILES',
      status: 'COLLECTED',
      priority: 1,
      reason: 'explicitly referenced by task',
      truncated: true,
      hasContent: true,
    });

    const failed = snapshot.context.find(item => item.reference === 'app/missing.tsx');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toContain('ENOENT');
    expect(failed?.hasContent).toBe(false);
  });

  it('does not present excluded context as selected or collected', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult(),
    });
    const excluded = snapshot.context.find(item => item.reference === '.ai/knowledge/codebase-map.md');
    expect(excluded?.status).toBe('EXCLUDED');
    expect(excluded?.hasContent).toBe(false);
    expect(snapshot.contextStrategy?.selectedSources).not.toContain('CODEBASE_MAP');
  });

  it('never ships gathered file bodies in the snapshot', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult(),
    });
    expect(JSON.stringify(snapshot)).not.toContain('export default function Home');
  });

  it('redacts secrets that leaked into evidence and context content', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({
        success: false,
        verificationReport: makeVerificationReport(false),
      }),
    });
    const evidence = snapshot.verification!.checks[0].evidence;
    expect(evidence).not.toContain('Bearer abcdefghijklmnop');
    expect(evidence).toContain(REDACTED);

    const content = projectContextContent('task-1', makePlannerContext().gathered);
    const item = content.items.find(entry => entry.reference === 'app/page.tsx');
    expect(item?.content).not.toContain('sk-abcdefghijklmnop');
    expect(item?.content).toContain(REDACTED);
  });

  it('preserves todo identity through the execution steps', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult(),
    });
    expect(snapshot.todoPlan?.todos.map(todo => todo.id)).toEqual(['todo-1', 'todo-2']);
    expect(snapshot.execution.map(step => [step.stepId, step.sourceTodoId])).toEqual([
      ['step-1', 'todo-1'],
      ['step-2', 'todo-2'],
    ]);
    expect(snapshot.execution.every(step => step.status === 'SUCCEEDED')).toBe(true);
  });

  it('keeps whole-run verification from becoming a todo-specific pass', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: true,
      workflowResult: makeWorkflowResult({
        todoVerification: { scope: 'WHOLE_RUN', verdicts: [] },
      }),
    });
    expect(snapshot.verification?.passed).toBe(true);
    expect(snapshot.verification?.scope).toBe('WHOLE_RUN');
    expect(snapshot.verification?.todoVerdicts).toEqual([
      {
        todoId: 'todo-1',
        scope: 'WHOLE_RUN',
        verdict: 'UNKNOWN',
        reason: 'verification evidence is whole-run',
      },
      {
        todoId: 'todo-2',
        scope: 'WHOLE_RUN',
        verdict: 'UNKNOWN',
        reason: 'verification evidence is whole-run',
      },
    ]);
  });

  it('keeps todo-specific verdicts when the core produced them', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({
        success: false,
        verificationReport: makeVerificationReport(false),
        todoVerification: {
          scope: 'TODO_SPECIFIC',
          verdicts: [
            { todoId: 'todo-1', scope: 'TODO_SPECIFIC', verdict: 'PASS' },
            { todoId: 'todo-2', scope: 'TODO_SPECIFIC', verdict: 'FAIL' },
          ],
        },
      }),
    });
    expect(snapshot.verification?.scope).toBe('TODO_SPECIFIC');
    expect(snapshot.verification?.todoVerdicts.map(v => [v.todoId, v.verdict])).toEqual([
      ['todo-1', 'PASS'],
      ['todo-2', 'FAIL'],
    ]);
  });

  it('separates primary, secondary and incidental failures', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({
        success: false,
        verificationReport: makeVerificationReport(false),
        failureContract: makeFailureContract(),
      }),
    });
    const failure = snapshot.failure!;
    expect(failure.primary?.checkId).toBe('check-typecheck');
    expect(failure.secondary.map(item => item.checkId)).toEqual(['check-lint']);
    expect(failure.incidental.map(item => item.checkId)).toEqual(['check-console']);
    expect(failure.classification).toBe('PRIMARY');
    expect(failure.failedTodoId).toBe('todo-2');
    expect(failure.failedStepId).toBe('step-2');
    expect(failure.attemptId).toBe('attempt-1');
    expect(failure.expected).toBe('typecheck passes');
    expect(failure.actual).toBe('typecheck fails');
    expect(failure.evidenceRefs).toEqual(['check-typecheck']);
  });

  it('states why a failed todo is unknown instead of guessing one', () => {
    const contract = makeFailureContract({ failedTodoId: undefined, failedStepId: undefined });
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({ success: false, failureContract: contract }),
    });
    expect(snapshot.failure?.failedTodoId).toBeUndefined();
    expect(snapshot.failure?.failedTodoReason).toContain('no reliable mapping');
  });

  it('keeps every repair attempt and the core reported outcome', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({
        success: false,
        repairOutcome: 'REPAIR_LIMIT_REACHED',
        repairAttemptHistory: makeRepairHistory(),
        abortReason: 'REPAIR_LIMIT_REACHED',
      }),
      repairLimits: { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    });
    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.repair?.outcome).toBe('REPAIR_LIMIT_REACHED');
    expect(snapshot.repair?.attempts.map(attempt => attempt.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(snapshot.repair?.attempts[1].expansionLevel).toBe(1);
    expect(snapshot.repair?.limits?.maxRepairAttempts).toBe(2);
  });

  it('marks blocked repair outcomes as BLOCKED rather than FAILED', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({ success: false, repairOutcome: 'NEEDS_CONTEXT' }),
    });
    expect(snapshot.status).toBe('BLOCKED');
    expect(snapshot.repair?.outcome).toBe('NEEDS_CONTEXT');
  });

  it('degrades to an empty projection when the workflow produced nothing', () => {
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      error: 'Model not available: qwen',
      workflowResult: null,
    });
    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.context).toEqual([]);
    expect(snapshot.execution).toEqual([]);
    expect(snapshot.verification).toBeUndefined();
    expect(snapshot.failure).toBeUndefined();
    expect(snapshot.repair).toBeUndefined();
    expect(snapshot.error).toBe('Model not available: qwen');
  });

  it('includes step results that have no matching plan step', () => {
    const plan = makeExecutionPlan();
    const snapshot = projectTaskRun({
      ...BASE,
      success: false,
      workflowResult: makeWorkflowResult({
        success: false,
        plan,
        stepResults: [
          { stepId: 'step-1', success: true, completedAt: '2026-08-28T10:01:00.000Z' },
          { stepId: 'step-9', success: false, error: 'tool failed', completedAt: '2026-08-28T10:02:00.000Z' },
        ],
      }),
    });
    const ids = snapshot.execution.map(step => step.stepId);
    expect(ids).toEqual(['step-1', 'step-2', 'step-9']);
    expect(snapshot.execution.find(step => step.stepId === 'step-2')?.status).toBe('PENDING');
    expect(snapshot.execution.find(step => step.stepId === 'step-9')?.status).toBe('FAILED');
  });
});
