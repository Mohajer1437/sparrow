import { validateTodoPlan } from '../../../src/domain/todo-plan';
import { applyRepairTodoPlanPolicy } from '../../../src/core/repair/repair-todo-plan-policy';

describe('repair TodoPlan', () => {
  it('uses the same TodoPlan schema with deterministic IDs and bounded files', () => {
    const plan = validateTodoPlan({
      goal: 'Repair POST /api/save 500',
      contextSummary: 'Observed 500; hypothesis is unconfirmed',
      affectedFiles: ['app/api/save/route.ts', 'middleware.ts', 'src/unrelated.ts'],
      constraints: ['repair primary only'],
      failedTodoId: 'todo-2',
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect save route',
          description: 'Trace the failing POST /api/save path',
          reason: 'Observed 500 on POST /api/save',
          files: ['app/api/save/route.ts'],
          dependencies: [],
          skillIds: ['backend.core'],
          verificationRequirements: ['api'],
          risk: 'MEDIUM',
          action: 'inspect',
        },
        {
          id: 'todo-2',
          title: 'Repair failing path',
          description: 'Fix the confirmed failing path',
          reason: 'Primary failure is POST /api/save 500',
          files: ['app/api/save/route.ts', 'middleware.ts'],
          dependencies: ['todo-1'],
          skillIds: ['backend.core'],
          verificationRequirements: ['api', 'intent-contract'],
          risk: 'HIGH',
          action: 'modify',
        },
      ],
    });
    expect(plan.todos.map(todo => todo.id)).toEqual(['todo-1', 'todo-2']);
    expect(plan.failedTodoId).toBe('todo-2');
    const bounded = applyRepairTodoPlanPolicy({
      todoPlan: plan,
      failedTodoId: 'todo-2',
      allowedFiles: ['app/api/save/route.ts', 'middleware.ts'],
      maxRepairFiles: 8,
    });
    expect(bounded.affectedFiles).toEqual(['app/api/save/route.ts', 'middleware.ts']);
    expect(bounded.affectedFiles).not.toContain('src/unrelated.ts');
    expect(bounded.failedTodoId).toBe('todo-2');
    expect(bounded.todos[1].dependencies).toEqual(['todo-1']);
    expect(bounded.todos[1].skillIds).toEqual(['backend.core']);
    expect(bounded.todos[1].verificationRequirements).toEqual(['api', 'intent-contract']);
  });
});
