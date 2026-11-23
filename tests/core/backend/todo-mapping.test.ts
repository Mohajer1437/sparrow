import { mapEndpointToTodo } from '../../../src/core/backend/todo-endpoint-mapping';
import { freezeBackendEndpoint } from '../../../src/domain/backend-endpoint';
import { validateTodoPlan } from '../../../src/domain/todo-plan';

function endpoint(id: string, source = 'src/users.controller.ts') {
  const [method, ...rest] = id.split(' ');
  return freezeBackendEndpoint({
    id,
    method: method as 'GET' | 'POST',
    path: rest.join(' '),
    source,
    discoverySource: 'NESTJS_DECORATOR',
    authRequirement: 'NONE',
    adminRequired: false,
    hasJsonBody: method === 'POST',
  });
}

function plan(todos: Array<{ id: string; title: string; files: string[]; extra?: string }>) {
  return validateTodoPlan({
    goal: 'Backend change',
    contextSummary: 'users module',
    affectedFiles: [...new Set(todos.flatMap(todo => todo.files))],
    constraints: [],
    todos: todos.map(todo => ({
      id: todo.id,
      title: todo.title,
      description: todo.extra || todo.title,
      reason: 'task',
      files: todo.files,
      dependencies: [],
      skillIds: ['backend.core'],
      verificationRequirements: ['api'],
      risk: 'LOW',
    })),
  });
}

describe('endpoint to todo mapping', () => {
  it('maps an endpoint to a todo when the path is unique', () => {
    const todoPlan = plan([
      { id: 'todo-1', title: 'Inspect health', files: ['src/health.controller.ts'] },
      { id: 'todo-2', title: 'Add POST /api/users', files: ['src/users.controller.ts'] },
    ]);
    expect(mapEndpointToTodo(endpoint('POST /api/users'), todoPlan)).toBe('todo-2');
  });

  it('maps by source file when the path is not in the title', () => {
    const todoPlan = plan([
      { id: 'todo-1', title: 'Change user module', files: ['src/users.controller.ts'] },
    ]);
    expect(mapEndpointToTodo(endpoint('GET /api/users', 'src/users.controller.ts'), todoPlan)).toBe('todo-1');
  });

  it('keeps mapping unknown when more than one todo matches', () => {
    const todoPlan = plan([
      { id: 'todo-1', title: 'POST /api/users create', files: ['src/users.controller.ts'] },
      { id: 'todo-2', title: 'POST /api/users validation', files: ['src/users.controller.ts'] },
    ]);
    expect(mapEndpointToTodo(endpoint('POST /api/users'), todoPlan)).toBeUndefined();
  });

  it('maps different endpoints to different todos', () => {
    const todoPlan = plan([
      { id: 'todo-1', title: 'GET /api/users list', files: ['src/users.controller.ts'] },
      { id: 'todo-2', title: 'POST /api/items create', files: ['src/items.controller.ts'] },
    ]);
    expect(mapEndpointToTodo(endpoint('GET /api/users', 'src/users.controller.ts'), todoPlan)).toBe('todo-1');
    expect(mapEndpointToTodo(endpoint('POST /api/items', 'src/items.controller.ts'), todoPlan)).toBe('todo-2');
  });
});
