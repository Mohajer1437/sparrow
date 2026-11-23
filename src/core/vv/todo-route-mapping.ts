import { TodoPlan } from '../../domain/todo-plan';

/**
 * R1.8: maps a browser route to a Todo through the Todo's own file list.
 *
 * The mapping is structural (Next.js route file -> route path) and only
 * accepted when exactly one Todo owns the route. An ambiguous or whole-app
 * check stays whole-run rather than being attributed to a guess.
 */
export function mapRouteToTodo(route: string, plan?: TodoPlan): string | undefined {
  if (!plan || plan.todos.length === 0) return undefined;
  const target = normalizeRoute(route);
  const matches = plan.todos.filter(todo =>
    todo.files.some(file => routeForPageFile(file) === target),
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

/** `app/dashboard/page.tsx` -> `/dashboard`; non-page files yield undefined. */
export function routeForPageFile(file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const match = /^(?:src\/)?(?:app|pages)\/(.*)$/.exec(normalized);
  if (!match) return undefined;
  let rest = match[1];
  const pageFile = /(?:^|\/)(page|index)\.(t|j)sx?$/.exec(rest);
  if (!pageFile) return undefined;
  rest = rest.replace(/(?:^|\/)(page|index)\.(t|j)sx?$/, '');
  const segments = rest.split('/').filter(segment => segment && !/^\(.*\)$/.test(segment));
  return normalizeRoute('/' + segments.join('/'));
}

function normalizeRoute(route: string): string {
  const trimmed = (route || '/').split('?')[0].replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
