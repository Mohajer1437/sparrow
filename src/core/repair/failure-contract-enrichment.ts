import { FailureContract } from '../../domain/failure-contract';
import { ExecutionPlan } from '../../domain/execution-plan';
import { FailureClassification } from '../../domain/failure-contract';
import { lastFailedStepId, resolveFailedTodo } from './failed-todo-resolver';
import { prioritizeFailures } from './failure-prioritizer';

export function enrichFailureContract(input: {
  readonly contract: FailureContract;
  readonly plan?: ExecutionPlan | null;
  readonly stepResults?: ReadonlyArray<{ readonly stepId: string; readonly success: boolean }>;
  readonly attemptId?: string;
}): FailureContract {
  const contract = input.contract;
  const failedStepId = contract.failedStepId
    ?? lastFailedStepId(input.stepResults);
  const failedTodoId = contract.failedTodoId
    ?? resolveFailedTodo({
      plan: input.plan ?? undefined,
      stepId: failedStepId,
      evidence: [
        contract.primaryFailure?.actualBehavior,
        contract.actual?.actualBehavior,
        contract.summary,
        contract.repairInstructions,
        ...(contract.failedChecks.map(check => check.evidence)),
      ].filter(Boolean).join('\n'),
    });
  const prioritized = prioritizeFailures(contract.failedChecks, contract.acceptanceCriteria);
  const classification: FailureClassification = contract.classification
    ?? prioritized[0]?.classification
    ?? 'PRIMARY';
  const evidenceRefs = contract.evidenceRefs
    ?? unique([
      ...(contract.evidencePack?.logRefs ?? []),
      ...(contract.failedChecks.map(check => check.id)),
      contract.primaryFailure?.check.id,
      contract.verification?.originalCheck,
    ].filter((item): item is string => typeof item === 'string' && item.length > 0));

  return Object.freeze({
    ...contract,
    failedTodoId,
    failedStepId,
    failureType: contract.failureType ?? contract.primaryFailure?.category ?? contract.category,
    attemptId: input.attemptId ?? contract.attemptId ?? `attempt-${Math.max(1, contract.attempt)}`,
    classification,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}
