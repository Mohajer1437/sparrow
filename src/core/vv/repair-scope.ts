import { FailureContract } from '../../domain/failure-contract';
import { ExecutionContract } from '../../domain/pre-execution/contract';
import { ExecutionPlan, PlanStep } from '../../domain/execution-plan';
import { extractFilePaths } from './infer-source-files';

export function normalizeRepairPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function uniqueSortedPaths(paths: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of paths) {
    if (!file) continue;
    const normalized = normalizeRepairPath(file);
    if (!normalized || seen.has(normalized)) continue;
    if (!/\.(tsx|ts|jsx|js|json|css|scss|md)$/i.test(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * EffectiveRepairScope = original task files ∪ PRIMARY implicated files
 * ∪ evidence-supported repair files ∪ planner-selected files.
 * Previously touched files are not unioned automatically.
 */
export function collectEffectiveRepairScope(input: {
  readonly originalTask: string;
  readonly failureContract?: FailureContract;
  readonly plannerFiles?: ReadonlyArray<string>;
  readonly previousAttemptFiles?: ReadonlyArray<string>;
}): string[] {
  const files: string[] = [];
  files.push(...extractFilePaths(input.originalTask || ''));
  files.push(...(input.plannerFiles ?? []));

  const contract = input.failureContract;
  if (contract) {
    if (contract.location?.file) files.push(contract.location.file);
    if (contract.implicatedFiles) files.push(...contract.implicatedFiles);
    const primaryEvidence = contract.primaryFailure?.actualBehavior
      || contract.primaryFailure?.check.evidence
      || '';
    if (primaryEvidence) files.push(...extractFilePaths(primaryEvidence));
  }

  return uniqueSortedPaths(files);
}

export function applyRepairScopeToPlan(
  plan: ExecutionPlan,
  scope: ReadonlyArray<string>,
): ExecutionPlan {
  if (scope.length === 0) return plan;
  const allowedList = Object.freeze(uniqueSortedPaths(scope));

  let steps: PlanStep[] = plan.steps.map(step => {
    const merged = uniqueSortedPaths([...(step.expectedFiles ?? []), ...allowedList]);
    return Object.freeze({ ...step, expectedFiles: Object.freeze(merged) });
  });

  if (!steps.some(step => step.type === 'modify')) {
    const files = allowedList.join(', ');
    steps = [
      ...steps,
      Object.freeze({
        id: 'repair-modify-implicated',
        description:
          'Repair the verification defect in ' + files
          + '. The original user task may already be implemented; that is not acceptance. '
          + 'Edit the implicated file(s) so the failed check passes. Do not skip this step.',
        type: 'modify',
        requiredTools: Object.freeze(['apply_patch', 'write_file', 'read_file']),
        expectedOutcome: 'Implicated files no longer produce the verification failure',
        expectedFiles: allowedList,
      }),
    ];
  }

  return Object.freeze({ ...plan, steps: Object.freeze(steps) });
}

export function expandContractFilesInScope(
  contract: ExecutionContract,
  scope: ReadonlyArray<string>,
): ExecutionContract {
  const merged = uniqueSortedPaths([...(contract.filesInScope ?? []), ...scope]);
  return Object.freeze({ ...contract, filesInScope: Object.freeze(merged) });
}

export function isRepairContext(context: { metadata?: Readonly<Record<string, string>> }): boolean {
  return context.metadata?.repair === 'true';
}

/**
 * Compact objective for deterministic fallback planning.
 * The full formatted Failure Contract must not be sentence-split into 9+ junk steps.
 */
export function buildCompactRepairObjective(input: {
  readonly originalTask: string;
  readonly failureContract: FailureContract;
  readonly previousAttemptFiles?: ReadonlyArray<string>;
}): string {
  const files = collectEffectiveRepairScope({
    originalTask: input.originalTask,
    failureContract: input.failureContract,
  });
  const required = input.failureContract.repairContract?.requiredOutcome
    || input.failureContract.expectation?.expectedBehavior
    || input.failureContract.summary;
  const testId = input.failureContract.location?.testId;
  const parts = [
    'VERIFICATION REPAIR: modify implicated product files so the failed check passes.',
    files.length ? 'Implicated files: ' + files.join(', ') + '.' : '',
    'Required outcome: ' + required + '.',
    testId ? 'Visible data-testid must be ' + testId + '.' : '',
    'Do not treat the original task as already complete.',
    'Do not remove previously satisfied acceptance markers while adding the missing one.',
    'Original task (context only): ' + input.originalTask,
  ];
    return parts.filter(Boolean).join(' | ');
}
