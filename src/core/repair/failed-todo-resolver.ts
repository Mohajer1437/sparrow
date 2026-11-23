import { ExecutionPlan } from '../../domain/execution-plan';
import { TODO_ID_PATTERN } from '../../domain/todo-plan';
import { resolveTodoIdForStep } from '../planning/todo-plan-to-execution-plan';

const TODO_ID_GLOBAL = /\btodo-[1-9][0-9]*\b/g;

export interface FailedTodoResolutionInput {
  readonly plan?: ExecutionPlan;
  readonly stepId?: string;
  readonly evidence?: string;
}

/**
 * Map a failed execution step or failure evidence to a Todo id.
 * Returns undefined when the mapping is not reliable. Does not guess.
 */
export function resolveFailedTodo(input: FailedTodoResolutionInput): string | undefined {
  if (input.stepId && input.plan) {
    const fromStep = resolveTodoIdForStep(input.plan, input.stepId);
    if (fromStep) return fromStep;
  }

  if (input.evidence && input.plan) {
    const fromEvidenceTodo = uniqueTodoIdInText(input.evidence, input.plan);
    if (fromEvidenceTodo) return fromEvidenceTodo;

    const stepFromEvidence = extractExplicitStepId(input.evidence, input.plan);
    if (stepFromEvidence) {
      const mapped = resolveTodoIdForStep(input.plan, stepFromEvidence);
      if (mapped) return mapped;
    }
  }

  return undefined;
}

export function lastFailedStepId(
  results: ReadonlyArray<{ readonly stepId: string; readonly success: boolean }> | undefined,
): string | undefined {
  if (!results || results.length === 0) return undefined;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (!results[i].success) return results[i].stepId;
  }
  return undefined;
}

function uniqueTodoIdInText(text: string, plan: ExecutionPlan): string | undefined {
  const matches = text.match(TODO_ID_GLOBAL) ?? [];
  const unique = [...new Set(matches)];
  if (unique.length !== 1) return undefined;
  const candidate = unique[0];
  if (!TODO_ID_PATTERN.test(candidate)) return undefined;
  const known = plan.todoPlan?.todos.some(todo => todo.id === candidate)
    || plan.steps.some(step => step.id === candidate || step.sourceTodoId === candidate);
  return known ? candidate : undefined;
}

function extractExplicitStepId(text: string, plan: ExecutionPlan): string | undefined {
  const knownIds = plan.steps.map(step => step.id);
  const found = knownIds.filter(id => id && text.includes(id));
  return found.length === 1 ? found[0] : undefined;
}
