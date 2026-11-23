import { ExecutionPlan } from '../../domain/execution-plan';
import { StepResult } from '../../domain/execution-context';
import {
  TodoMappingSource,
  TodoVerificationCheckResult,
  TodoVerificationReport,
  VerificationScope,
  deriveTodoVerdict,
  summarizeTodoVerification,
} from '../../domain/todo-verification';
import { VerificationCheck } from '../../domain/verification-check';
import { VerificationReport } from '../../domain/verification-report';

/**
 * Builds per-Todo verification evidence (R1.1-R1.10).
 *
 * A check reaches a Todo only through an explicit mapping: the verifier set
 * `todoId`, or the check id is an execution step that the plan maps to a
 * Todo. Everything else stays whole-run, which keeps a global PASS from ever
 * becoming a Todo-level PASS.
 */
export function buildTodoVerificationReport(input: {
  readonly plan?: ExecutionPlan | null;
  readonly report?: VerificationReport;
  readonly checks?: ReadonlyArray<VerificationCheck>;
  readonly stepResults?: ReadonlyArray<StepResult>;
}): TodoVerificationReport {
  const checks = input.checks ?? input.report?.checks ?? [];
  const todos = input.plan?.todoPlan?.todos ?? [];
  const results = checks.map(check => toResult(check, input.plan ?? undefined));

  const wholeRunChecks = results.filter(result => result.scope !== 'TODO_SPECIFIC');
  if (todos.length === 0) {
    return summarizeTodoVerification({ verdicts: [], wholeRunChecks });
  }

  const executedTodoIds = executedTodos(input.plan ?? undefined, input.stepResults ?? []);
  const verdicts = todos.map(todo => deriveTodoVerdict({
    todoId: todo.id,
    requiredChecks: todo.verificationRequirements ?? [],
    results: results.filter(result => result.todoId === todo.id),
    executed: executedTodoIds.has(todo.id),
  }));

  return summarizeTodoVerification({ verdicts, wholeRunChecks });
}

function toResult(check: VerificationCheck, plan?: ExecutionPlan): TodoVerificationCheckResult {
  const mapping = resolveMapping(check, plan);
  const scope: VerificationScope = check.scope
    ?? (mapping.todoId ? 'TODO_SPECIFIC' : 'WHOLE_RUN');
  // An explicitly whole-run or unknown-scope check must not carry a todoId
  // into the verdict derivation (R1.2).
  const todoId = scope === 'TODO_SPECIFIC' ? mapping.todoId : undefined;
  return Object.freeze({
    checkId: check.id,
    name: check.name,
    category: check.category,
    todoId,
    scope: todoId ? scope : (scope === 'TODO_SPECIFIC' ? 'UNKNOWN' : scope),
    status: check.passed ? ('PASS' as const) : ('FAIL' as const),
    mappingSource: todoId ? mapping.source : ('NONE' as const),
    required: check.required ?? true,
    expected: check.expected,
    actual: check.actual,
    evidenceRefs: Object.freeze([...(check.evidenceRefs ?? [])]),
    source: check.source ?? check.category,
  });
}

function resolveMapping(
  check: VerificationCheck,
  plan?: ExecutionPlan,
): { todoId?: string; source: TodoMappingSource } {
  if (check.todoId) {
    return { todoId: check.todoId, source: 'EXPLICIT_CHECK_TODO_ID' };
  }
  if (plan) {
    const step = plan.steps.find(item => item.id === check.id);
    const todoId = step?.sourceTodoId
      ?? plan.todoPlan?.todos.find(todo => todo.id === check.id)?.id;
    if (todoId) return { todoId, source: 'EXECUTION_STEP_MAPPING' };
  }
  return { source: 'NONE' };
}

function executedTodos(
  plan: ExecutionPlan | undefined,
  stepResults: ReadonlyArray<StepResult>,
): Set<string> {
  const executed = new Set<string>();
  for (const result of stepResults) {
    const step = plan?.steps.find(item => item.id === result.stepId);
    const todoId = step?.sourceTodoId ?? result.stepId;
    if (todoId) executed.add(todoId);
  }
  return executed;
}
