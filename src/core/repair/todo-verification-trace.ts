import { ExecutionPlan } from '../../domain/execution-plan';
import {
  TodoVerificationTrace,
  TodoVerificationVerdict,
} from '../../domain/repair-intelligence';
import { VerificationCheck } from '../../domain/verification-check';
import { VerificationReport } from '../../domain/verification-report';
import { resolveTodoIdForStep } from '../planning/todo-plan-to-execution-plan';

const TODO_ID_GLOBAL = /\btodo-[1-9][0-9]*\b/g;

/**
 * Map V&V evidence to Todo verdicts without inventing Todo-specific PASS.
 * Whole-run verification remains WHOLE_RUN with UNKNOWN per-todo verdicts.
 */
export function mapVerificationToTodos(input: {
  readonly plan?: ExecutionPlan | null;
  readonly report?: VerificationReport;
  readonly checks?: ReadonlyArray<VerificationCheck>;
}): TodoVerificationTrace {
  const checks = input.checks ?? input.report?.checks ?? [];
  const todos = input.plan?.todoPlan?.todos ?? [];
  if (todos.length === 0) {
    return Object.freeze({
      scope: 'WHOLE_RUN',
      verdicts: Object.freeze([]),
    });
  }

  const verdicts: TodoVerificationVerdict[] = todos.map(todo => {
    const related = checks.filter(check => checkMentionsTodo(check, todo.id, input.plan ?? undefined));
    if (related.length === 0) {
      return Object.freeze({
        todoId: todo.id,
        scope: 'WHOLE_RUN' as const,
        verdict: 'UNKNOWN' as const,
      });
    }
    const failed = related.some(check => !check.passed);
    return Object.freeze({
      todoId: todo.id,
      scope: 'TODO_SPECIFIC' as const,
      verdict: failed ? 'FAIL' as const : 'PASS' as const,
    });
  });

  const anySpecific = verdicts.some(item => item.scope === 'TODO_SPECIFIC');
  return Object.freeze({
    scope: anySpecific ? 'TODO_SPECIFIC' : 'WHOLE_RUN',
    verdicts: Object.freeze(verdicts),
  });
}

function checkMentionsTodo(
  check: VerificationCheck,
  todoId: string,
  plan?: ExecutionPlan,
): boolean {
  const blob = [check.id, check.name, check.evidence, check.acceptanceCriterion ?? ''].join('\n');
  const mentioned: string[] = blob.match(TODO_ID_GLOBAL) ?? [];
  if (mentioned.includes(todoId)) return true;
  if (plan) {
    const fromStep = resolveTodoIdForStep(plan, check.id);
    if (fromStep === todoId) return true;
  }
  return false;
}
