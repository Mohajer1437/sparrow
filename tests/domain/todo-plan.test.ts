import {
  freezeTodoPlan,
  MAX_TODOS_PER_PLAN,
  validateTodoItem,
  validateTodoPlan,
} from '../../src/domain/todo-plan';
import { TodoPlanValidationError } from '../../src/domain/errors/todo-plan-errors';

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'todo-1',
    title: 'Inspect existing home page structure',
    description: 'Read app/page.tsx and identify the current component tree.',
    reason: 'The task names app/page.tsx and gathered context collected it.',
    files: ['app/page.tsx'],
    dependencies: [],
    skillIds: ['frontend.core'],
    verificationRequirements: ['browser'],
    risk: 'LOW',
    action: 'inspect',
    ...overrides,
  };
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    goal: 'Inspect app/page.tsx',
    contextSummary: 'Next.js frontend. Gathered app/page.tsx.',
    affectedFiles: ['app/page.tsx'],
    constraints: ['Do not expand scope'],
    todos: [validItem()],
    ...overrides,
  };
}

describe('TodoPlan domain', () => {
  it('accepts a valid TodoPlan and freezes it', () => {
    const plan = validateTodoPlan(validPlan());
    expect(plan.goal).toBe('Inspect app/page.tsx');
    expect(plan.todos).toHaveLength(1);
    expect(plan.todos[0].id).toBe('todo-1');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.todos[0])).toBe(true);
  });

  it('rejects an empty goal', () => {
    expect(() => validateTodoPlan(validPlan({ goal: '  ' }))).toThrow(TodoPlanValidationError);
  });

  it('rejects a non-object plan', () => {
    expect(() => validateTodoPlan(null)).toThrow(TodoPlanValidationError);
    expect(() => validateTodoPlan('nope')).toThrow(TodoPlanValidationError);
  });

  it('rejects an empty todos list', () => {
    expect(() => validateTodoPlan(validPlan({ todos: [] }))).toThrow(/at least one todo/);
  });

  it('rejects a todo file that is missing from affectedFiles', () => {
    expect(() => validateTodoPlan(validPlan({
      affectedFiles: [],
      todos: [validItem({ files: ['app/page.tsx'] })],
    }))).toThrow(/affectedFiles/);
  });

  it('accepts failedTodoId when it matches a todo', () => {
    const plan = validateTodoPlan(validPlan({ failedTodoId: 'todo-1' }));
    expect(plan.failedTodoId).toBe('todo-1');
  });

  it('accepts failedTodoId from a prior plan that is not in the current todos', () => {
    const plan = validateTodoPlan(validPlan({ failedTodoId: 'todo-9' }));
    expect(plan.failedTodoId).toBe('todo-9');
  });

  it('rejects invalid failedTodoId', () => {
    expect(() => validateTodoPlan(validPlan({ failedTodoId: 'step-1' }))).toThrow(/failedTodoId/);
  });

  it('rejects duplicate Todo IDs', () => {
    expect(() => validateTodoPlan(validPlan({
      todos: [validItem(), validItem({ id: 'todo-1', title: 'Other' })],
    }))).toThrow(/unique/i);
  });

  it('rejects unknown dependencies', () => {
    expect(() => validateTodoPlan(validPlan({
      affectedFiles: ['app/page.tsx'],
      todos: [validItem({ dependencies: ['todo-9'] })],
    }))).toThrow(/unknown/i);
  });

  it('rejects self dependencies', () => {
    expect(() => validateTodoItem(validItem({ dependencies: ['todo-1'] }))).toThrow(/itself/);
  });

  it('rejects cyclic dependencies', () => {
    expect(() => validateTodoPlan(validPlan({
      affectedFiles: ['app/page.tsx', 'middleware.ts'],
      todos: [
        validItem({ id: 'todo-1', files: ['app/page.tsx'], dependencies: ['todo-2'] }),
        validItem({
          id: 'todo-2',
          title: 'Modify middleware',
          files: ['middleware.ts'],
          dependencies: ['todo-1'],
        }),
      ],
    }))).toThrow(/cycle/i);
  });

  it('orders todos by dependencies with stable IDs', () => {
    const plan = validateTodoPlan(validPlan({
      affectedFiles: ['app/page.tsx', 'middleware.ts'],
      todos: [
        validItem({
          id: 'todo-2',
          title: 'Modify middleware',
          files: ['middleware.ts'],
          dependencies: ['todo-1'],
          action: 'modify',
        }),
        validItem({ id: 'todo-1', files: ['app/page.tsx'], dependencies: [] }),
      ],
    }));
    expect(plan.todos.map(todo => todo.id)).toEqual(['todo-1', 'todo-2']);
  });

  it('is deterministic for identical input', () => {
    const input = validPlan({
      affectedFiles: ['b.ts', 'a.ts'],
      constraints: ['b', 'a'],
      todos: [
        validItem({
          id: 'todo-1',
          files: ['b.ts', 'a.ts'],
          skillIds: ['testing.core', 'frontend.core'],
          verificationRequirements: ['lint', 'browser'],
        }),
      ],
    });
    expect(validateTodoPlan(input)).toEqual(validateTodoPlan(input));
    expect(validateTodoPlan(input).affectedFiles).toEqual(['a.ts', 'b.ts']);
    expect(validateTodoPlan(input).todos[0].skillIds).toEqual(['frontend.core', 'testing.core']);
    expect(freezeTodoPlan(validateTodoPlan(input))).toEqual(validateTodoPlan(input));
  });
});

describe('TodoItem', () => {
  it('accepts a valid item', () => {
    const item = validateTodoItem(validItem());
    expect(item.risk).toBe('LOW');
    expect(item.skillIds).toEqual(['frontend.core']);
  });

  it('rejects invalid risk', () => {
    expect(() => validateTodoItem(validItem({ risk: 'CRITICAL' }))).toThrow(/risk/);
  });

  it('rejects missing required fields', () => {
    expect(() => validateTodoItem(validItem({ title: '' }))).toThrow(/title/);
    expect(() => validateTodoItem(validItem({ reason: '' }))).toThrow(/reason/);
  });

  it('rejects unknown skill IDs', () => {
    expect(() => validateTodoItem(validItem({ skillIds: ['auth.custom'] }))).toThrow(/unknown skill/);
  });

  it('rejects skill IDs not in the resolved allow-list', () => {
    expect(() => validateTodoItem(validItem({ skillIds: ['backend.core'] }), {
      allowedSkillIds: ['frontend.core'],
    })).toThrow(/unknown skill/);
  });

  it('rejects invalid verification requirements', () => {
    expect(() => validateTodoItem(validItem({ verificationRequirements: ['telepathy'] }))).toThrow(
      /verification/,
    );
  });

  it('accepts backend verification requirement aliases', () => {
    const item = validateTodoItem(validItem({
      verificationRequirements: ['auth', 'authorization', 'error-handling', 'endpoint'],
    }));
    expect(item.verificationRequirements).toEqual(['api', 'auth', 'authorization', 'error-handling']);
  });

  it('rejects path traversal in files', () => {
    expect(() => validateTodoItem(validItem({ files: ['../secret.ts'] }))).toThrow(/traversal/);
  });

  it('accepts root path dot and skips empty strings in files without error', () => {
    const item = validateTodoItem(validItem({ files: ['.', ''] }));
    expect(item.files).toEqual(['.']);
  });
});

describe('TodoPlan limits', () => {
  it('rejects more than the maximum number of todos', () => {
    const todos = Array.from({ length: MAX_TODOS_PER_PLAN + 1 }, (_, i) => validItem({
      id: `todo-${i + 1}`,
      files: [],
    }));
    expect(() => validateTodoPlan(validPlan({ todos, affectedFiles: [] }))).toThrow(/max/);
  });
});
