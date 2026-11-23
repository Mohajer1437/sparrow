import { TodoItem, TodoPlan, TODO_ID_PATTERN } from '../../domain/todo-plan';
import { BackendEndpoint } from '../../domain/backend-endpoint';

/**
 * Map an endpoint to a Todo only when the evidence is unique and grounded.
 * Returns undefined (UNKNOWN) when mapping is not reliable.
 */
export function mapEndpointToTodo(
  endpoint: BackendEndpoint,
  plan?: TodoPlan,
): string | undefined {
  if (!plan || plan.todos.length === 0) return undefined;
  const matches = plan.todos.filter(todo => todoMentionsEndpoint(todo, endpoint));
  if (matches.length === 1) {
    const id = matches[0].id;
    return TODO_ID_PATTERN.test(id) ? id : undefined;
  }
  return undefined;
}

function todoMentionsEndpoint(todo: TodoItem, endpoint: BackendEndpoint): boolean {
  const text = `${todo.title} ${todo.description} ${todo.reason}`.toLowerCase();
  const path = (endpoint.path || '').toLowerCase();
  const id = (endpoint.id || '').toLowerCase();
  if (text.includes(id) || text.includes(`${(endpoint.method || '').toLowerCase()} ${path}`)) {
    return true;
  }
  if (path && text.includes(path) && path.length > 1) return true;
  const source = (endpoint.source || '').replace(/\\/g, '/').toLowerCase();
  if (source && todo.files && todo.files.some(file => {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return normalized === source || source.endsWith('/' + normalized) || normalized.endsWith(source);
  })) {
    return true;
  }
  return false;
}
