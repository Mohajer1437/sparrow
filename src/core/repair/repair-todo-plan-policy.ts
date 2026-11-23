import { ExecutionPlan, PlanStep } from '../../domain/execution-plan';
import { freezeTodoPlan, TodoPlan } from '../../domain/todo-plan';
import { normalizeRepairFile } from '../../domain/repair-intelligence';
import { uniqueSortedPaths } from '../vv/repair-scope';

/**
 * Stamp original failedTodoId onto a repair TodoPlan and drop files outside
 * the deterministic allow-list. Does not invent files or todo ids.
 */
export function applyRepairTodoPlanPolicy(input: {
  readonly todoPlan: TodoPlan;
  readonly failedTodoId?: string;
  readonly allowedFiles: ReadonlyArray<string>;
  readonly maxRepairFiles: number;
}): TodoPlan {
  const allowed = new Set(
    uniqueSortedPaths(input.allowedFiles).map(normalizeRepairFile),
  );
  const cap = Math.max(0, input.maxRepairFiles);
  const boundedAffected = uniqueSortedPaths(input.todoPlan.affectedFiles)
    .map(normalizeRepairFile)
    .filter(file => allowed.size === 0 || allowed.has(file))
    .slice(0, cap);

  const allowedSet = new Set(boundedAffected);
  const todos = input.todoPlan.todos.map(todo => {
    const files = uniqueSortedPaths(todo.files).filter(file => allowedSet.has(file));
    return { ...todo, files };
  });

  return freezeTodoPlan({
    ...input.todoPlan,
    affectedFiles: boundedAffected,
    todos,
    failedTodoId: input.todoPlan.failedTodoId ?? input.failedTodoId,
  });
}

export function applyRepairPolicyToExecutionPlan(input: {
  readonly plan: ExecutionPlan;
  readonly failedTodoId?: string;
  readonly allowedFiles: ReadonlyArray<string>;
  readonly maxRepairFiles: number;
}): ExecutionPlan {
  if (!input.plan.todoPlan) return input.plan;
  const todoPlan = applyRepairTodoPlanPolicy({
    todoPlan: input.plan.todoPlan,
    failedTodoId: input.failedTodoId,
    allowedFiles: input.allowedFiles,
    maxRepairFiles: input.maxRepairFiles,
  });
  const byId = new Map(todoPlan.todos.map(todo => [todo.id, todo]));
  const steps: ReadonlyArray<PlanStep> = Object.freeze(input.plan.steps.map(step => {
    const todo = byId.get(step.sourceTodoId ?? step.id);
    if (!todo) return step;
    return Object.freeze({
      ...step,
      expectedFiles: Object.freeze([...todo.files]),
    });
  }));
  return Object.freeze({
    ...input.plan,
    steps,
    todoPlan,
  });
}
