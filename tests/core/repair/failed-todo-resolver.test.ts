import { resolveFailedTodo } from '../../../src/core/repair/failed-todo-resolver';
import { resolveTodoIdForStep, todoPlanToExecutionPlan } from '../../../src/core/planning/todo-plan-to-execution-plan';
import { validateTodoPlan } from '../../../src/domain/todo-plan';
import { ExecutionPlan } from '../../../src/domain/execution-plan';

function planWithTodos(): ExecutionPlan {
  const todoPlan = validateTodoPlan({
    goal: 'Add comment',
    contextSummary: 'page only',
    affectedFiles: ['app/page.tsx', 'middleware.ts'],
    constraints: ['do not expand'],
    todos: [
      {
        id: 'todo-1',
        title: 'Read page',
        description: 'Inspect app/page.tsx',
        reason: 'needed',
        files: ['app/page.tsx'],
        dependencies: [],
        skillIds: ['frontend.core'],
        verificationRequirements: ['browser'],
        risk: 'LOW',
        action: 'inspect',
      },
      {
        id: 'todo-2',
        title: 'Edit middleware',
        description: 'Change middleware.ts',
        reason: 'auth path',
        files: ['middleware.ts'],
        dependencies: ['todo-1'],
        skillIds: ['frontend.core'],
        verificationRequirements: ['intent-contract'],
        risk: 'MEDIUM',
        action: 'modify',
      },
    ],
  });
  return todoPlanToExecutionPlan(todoPlan, ['read_file', 'write_file', 'apply_patch']);
}

describe('failed Todo mapping', () => {
  it('maps execution step id to sourceTodoId', () => {
    const plan = planWithTodos();
    expect(resolveTodoIdForStep(plan, 'todo-2')).toBe('todo-2');
    expect(resolveFailedTodo({ plan, stepId: 'todo-2' })).toBe('todo-2');
  });

  it('maps failure evidence containing a step id to the Todo', () => {
    const plan = planWithTodos();
    expect(resolveFailedTodo({
      plan,
      evidence: 'step todo-2 failed: Expected: 401 Actual: 500',
    })).toBe('todo-2');
  });

  it('leaves unknown mapping undefined', () => {
    const plan = planWithTodos();
    expect(resolveFailedTodo({ plan, stepId: 'repair-modify-implicated' })).toBeUndefined();
    expect(resolveFailedTodo({ plan, evidence: 'something failed in an unnamed step' })).toBeUndefined();
  });

  it('does not guess a Todo id from multiple mentions', () => {
    const plan = planWithTodos();
    expect(resolveFailedTodo({
      plan,
      evidence: 'todo-1 and todo-2 both mentioned without a single owner',
    })).toBeUndefined();
  });

  it('does not invent a Todo that is not in the plan', () => {
    const plan = planWithTodos();
    expect(resolveFailedTodo({
      plan,
      evidence: 'failedTodoId=todo-9',
    })).toBeUndefined();
  });
});
