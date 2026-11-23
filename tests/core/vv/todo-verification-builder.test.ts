/**
 * R1.6-R1.10 — checks reach a Todo only through an explicit mapping. Nothing
 * here may fall back to matching titles or names.
 */

import { buildTodoVerificationReport } from '../../../src/core/vv/todo-verification-builder';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { TodoItem, TodoPlan } from '../../../src/domain/todo-plan';
import { VerificationCheck } from '../../../src/domain/verification-check';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    title: 'Add a JSX comment',
    description: 'Insert a marker comment',
    reason: 'requested',
    files: ['app/page.tsx'],
    dependencies: [],
    skillIds: [],
    verificationRequirements: [],
    risk: 'LOW',
    action: 'modify',
    ...overrides,
  };
}

function plan(todos: ReadonlyArray<TodoItem>, steps: ExecutionPlan['steps'] = []): ExecutionPlan {
  const todoPlan: TodoPlan = {
    goal: 'goal',
    contextSummary: 'ctx',
    affectedFiles: ['app/page.tsx'],
    constraints: [],
    todos,
  };
  return {
    id: 'plan-1',
    objective: 'goal',
    complexity: 'SIMPLE',
    reasoning: 'r',
    steps,
    affectedDomains: [],
    validationStrategy: { requiresTests: false, requiresBuild: false, criteria: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    todoPlan,
  } as unknown as ExecutionPlan;
}

function check(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    id: 'check-1',
    name: 'browser',
    category: 'browser',
    passed: true,
    severity: 'HIGH',
    evidence: 'route rendered',
    ...overrides,
  } as VerificationCheck;
}

describe('Check-to-todo mapping (R1.6)', () => {
  it('maps a check that carries an explicit todoId', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ verificationRequirements: ['browser'] })]),
      checks: [check({ todoId: 'todo-1', scope: 'TODO_SPECIFIC' })],
    });

    expect(report.scope).toBe('TODO_SPECIFIC');
    expect(report.verdicts[0].verdict).toBe('PASS');
    expect(report.verdicts[0].results[0].mappingSource).toBe('EXPLICIT_CHECK_TODO_ID');
  });

  it('maps a check whose id is an execution step the plan links to a todo', () => {
    const report = buildTodoVerificationReport({
      plan: plan(
        [todo({ id: 'todo-2', verificationRequirements: [] })],
        [{
          id: 'step-a',
          description: 'edit page',
          type: 'modify',
          requiredTools: ['write_file'],
          expectedOutcome: 'edited',
          sourceTodoId: 'todo-2',
        }] as ExecutionPlan['steps'],
      ),
      checks: [check({ id: 'step-a', scope: 'TODO_SPECIFIC' })],
    });

    expect(report.verdicts[0].results[0].mappingSource).toBe('EXECUTION_STEP_MAPPING');
    expect(report.verdicts[0].verdict).toBe('PASS');
  });

  it('does not map a check to a todo because their names look alike', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ title: 'browser check for the home page' })]),
      checks: [check({ name: 'browser check for the home page' })],
    });

    expect(report.scope).toBe('WHOLE_RUN');
    expect(report.verdicts[0].verdict).toBe('NOT_TESTED');
    expect(report.wholeRunChecks).toHaveLength(1);
  });
});

describe('Scope discipline (R1.2, R1.10)', () => {
  it('keeps a WHOLE_RUN check out of todo verdicts even when it names a todoId', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ verificationRequirements: ['browser'] })]),
      checks: [check({ todoId: 'todo-1', scope: 'WHOLE_RUN' })],
    });

    expect(report.verdicts[0].verdict).not.toBe('PASS');
    expect(report.wholeRunChecks).toHaveLength(1);
  });

  it('demotes a TODO_SPECIFIC check that has no resolvable todo to UNKNOWN scope', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo()]),
      checks: [check({ scope: 'TODO_SPECIFIC' })],
    });

    expect(report.wholeRunChecks[0].scope).toBe('UNKNOWN');
    expect(report.wholeRunChecks[0].todoId).toBeUndefined();
  });

  it('preserves whole-run checks alongside todo-specific ones', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ verificationRequirements: ['browser'] })]),
      checks: [
        check({ id: 'c-browser', todoId: 'todo-1', scope: 'TODO_SPECIFIC' }),
        check({ id: 'c-typecheck', name: 'typecheck', category: 'deterministic', scope: 'WHOLE_RUN' }),
      ],
    });

    expect(report.scope).toBe('TODO_SPECIFIC');
    expect(report.verdicts[0].verdict).toBe('PASS');
    expect(report.wholeRunChecks.map(c => c.checkId)).toEqual(['c-typecheck']);
  });
});

describe('Endpoint and database verification mapping (R1.7, R1.9)', () => {
  it('turns an explicit failing endpoint check into a todo failure', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ id: 'todo-3', verificationRequirements: ['api'] })]),
      checks: [check({
        id: 'endpoint-post-users',
        name: 'api',
        category: 'api',
        todoId: 'todo-3',
        scope: 'TODO_SPECIFIC',
        passed: false,
        expected: '201',
        actual: '500',
      })],
    });

    expect(report.verdicts[0].verdict).toBe('FAIL');
    expect(report.verdicts[0].results[0].expected).toBe('201');
    expect(report.verdicts[0].results[0].actual).toBe('500');
    expect(report.todosFailed).toBe(1);
  });

  it('treats an explicit database persistence check as todo-specific evidence', () => {
    const report = buildTodoVerificationReport({
      plan: plan([todo({ id: 'todo-4', verificationRequirements: ['database-read-check'] })]),
      checks: [check({
        id: 'db-persistence-users',
        name: 'database-read-check',
        category: 'api',
        todoId: 'todo-4',
        scope: 'TODO_SPECIFIC',
      })],
    });

    expect(report.verdicts[0].verdict).toBe('PASS');
    expect(report.scope).toBe('TODO_SPECIFIC');
  });
});

describe('Coverage counts (R1.30)', () => {
  it('counts unmapped todos as UNKNOWN when they executed and NOT_TESTED when they did not', () => {
    const executionPlan = plan(
      [todo({ id: 'todo-1' }), todo({ id: 'todo-2' })],
      [{
        id: 'step-1',
        description: 'edit',
        type: 'modify',
        requiredTools: [],
        expectedOutcome: 'edited',
        sourceTodoId: 'todo-1',
      }] as ExecutionPlan['steps'],
    );

    const report = buildTodoVerificationReport({
      plan: executionPlan,
      checks: [check({ scope: 'WHOLE_RUN' })],
      stepResults: [{ stepId: 'step-1', success: true } as never],
    });

    expect(report.todosTotal).toBe(2);
    expect(report.todosUnknown).toBe(1);
    expect(report.todosNotTested).toBe(1);
    expect(report.todosVerified).toBe(0);
  });

  it('returns an empty report when there is no todo plan', () => {
    const report = buildTodoVerificationReport({ checks: [check()] });
    expect(report.todosTotal).toBe(0);
    expect(report.wholeRunChecks).toHaveLength(1);
  });
});
