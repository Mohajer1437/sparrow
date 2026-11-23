import { ExecutionPlan, PlanComplexity, PlanStep } from '../../domain/execution-plan';
import { TodoItem, TodoPlan, todoActionToStepType } from '../../domain/todo-plan';

const KIND_TOOLS: Record<ReturnType<typeof todoActionToStepType>, ReadonlyArray<string>> = {
  analysis: ['read_file', 'list_directory'],
  search: ['read_file', 'list_directory'],
  modify: ['read_file', 'write_file', 'apply_patch'],
  test: ['read_file'],
  validation: ['read_file'],
};

/**
 * Compatibility bridge: TodoPlan remains the planning contract.
 * Existing workflow still consumes ExecutionPlan steps.
 */
export function todoPlanToExecutionPlan(
  todoPlan: TodoPlan,
  availableTools: ReadonlyArray<string>,
): ExecutionPlan {
  const steps = todoPlan.todos.map(todo => toStep(todo, availableTools));
  const complexity = inferComplexity(todoPlan.todos.length);
  const domains = uniqueSorted(todoPlan.todos.flatMap(todo => todo.skillIds));
  const requiredTests = uniqueSorted(todoPlan.todos.flatMap(todo => [...todo.verificationRequirements]));

  return Object.freeze({
    id: `plan-${todoPlan.todos.map(todo => todo.id).join('-')}`,
    objective: todoPlan.goal,
    complexity,
    reasoning: todoPlan.contextSummary,
    steps: Object.freeze(steps),
    affectedDomains: Object.freeze(domains),
    validationStrategy: Object.freeze({
      requiredTests: Object.freeze(requiredTests),
      successCriteria: Object.freeze(
        todoPlan.constraints.length > 0 ? [...todoPlan.constraints] : [`Complete: ${todoPlan.goal}`],
      ),
    }),
    createdAt: '1970-01-01T00:00:00.000Z',
    todoPlan,
  });
}

function toStep(todo: TodoItem, availableTools: ReadonlyArray<string>): PlanStep {
  const type = todoActionToStepType(todo.action, todo);
  // Legacy requestedTools are passed through so ExecutionPlan validation can drop
  // unavailable tools and warn. Native TodoPlans only emit tools the executor has.
  const wanted = todo.requestedTools && todo.requestedTools.length > 0
    ? todo.requestedTools
    : (KIND_TOOLS[type] ?? ['read_file']).filter(tool => availableTools.includes(tool));
  const requiredTools = wanted;
  return Object.freeze({
    id: todo.id,
    description: `${todo.title}: ${todo.description}`,
    type,
    requiredTools: Object.freeze(requiredTools),
    expectedOutcome: todo.description,
    objective: todo.title,
    dependencies: Object.freeze([...todo.dependencies]),
    expectedFiles: Object.freeze([...todo.files]),
    validationCriteria: Object.freeze([...todo.verificationRequirements]),
    skillIds: Object.freeze([...todo.skillIds]),
    sourceTodoId: todo.id,
  });
}

function inferComplexity(todoCount: number): PlanComplexity {
  if (todoCount <= 1) return 'simple';
  if (todoCount <= 4) return 'medium';
  return 'complex';
}

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Map an executed or failed step back to its Todo id.
 * Used for V&V/failure traceability without Repair Intelligence.
 */
export function resolveTodoIdForStep(plan: ExecutionPlan, stepId: string): string | undefined {
  const fromTodo = plan.todoPlan?.todos.find(todo => todo.id === stepId);
  if (fromTodo) return fromTodo.id;
  const step = plan.steps.find(item => item.id === stepId);
  if (step?.sourceTodoId) return step.sourceTodoId;
  return undefined;
}
