/**
 * Milestone R9 — Real-World Adversarial Task Campaign.
 *
 * R9 extends the R8 campaign contracts in three ways:
 *
 *  1. A third environment (`benchmark`) so cases can target the disposable
 *     full-stack project without overloading the frontend/backend union.
 *  2. A task-class taxonomy so every case states which engineering pressure it
 *     applies, independently of the coarse R8 category.
 *  3. **Evidence-derived execution labels.** R8 let the author of a case declare
 *     `executionLabel: 'REAL E2E'` as a free-form string. Nothing verified it, and
 *     the R8 campaign consequently labelled hand-built snapshot fixtures as REAL
 *     E2E. In R9 the label is computed from pipeline evidence by
 *     `deriveExecutionLabel`, and `assertLabelSupportedByEvidence` rejects any
 *     claim the evidence does not support.
 */

import { ExecutionMode } from './execution-mode';
import { CampaignDifficulty, CampaignExecutionLabel } from './reliability-campaign';

/**
 * The engineering pressure a case applies. Distinct from the R8 category, which
 * describes *where* the work happens rather than *what is being tested*.
 */
export const R9_TASK_CLASSES = [
  'R9-FE',
  'R9-BE',
  'R9-DB',
  'R9-AUTH',
  'R9-ADMIN',
  'R9-REFACTOR',
  'R9-VERSION',
  'R9-IMPACT',
  'R9-REGRESSION',
  'R9-REPAIR',
  'R9-CONFIRMATION',
  'R9-SECURITY',
  'R9-AMBIGUOUS',
  'R9-CROSS_LAYER',
  'R9-ADVERSARIAL',
  'R9-CONTROL',
] as const;
export type R9TaskClass = (typeof R9_TASK_CLASSES)[number];

export const R9_ENVIRONMENTS = ['frontend', 'backend', 'benchmark'] as const;
export type R9Environment = (typeof R9_ENVIRONMENTS)[number];

/**
 * Primary reason a case did not succeed. Mirrors FailureContract semantics.
 */
export const R9_FAILURE_REASONS = [
  'PLANNER',
  'CONTEXT',
  'EXECUTION',
  'MUTATION',
  'VERIFICATION',
  'REPAIR',
  'SCOPE',
  'VERSION',
  'BACKEND',
  'DATABASE',
  'CONFIRMATION',
  'ENVIRONMENT',
  'PROVIDER_FAILURE',
  'UNKNOWN',
] as const;
export type R9FailureReason = (typeof R9_FAILURE_REASONS)[number];

/**
 * Whether a non-success is the framework's fault or the model's. A model that
 * misunderstands a requirement is not a framework bug; a MutationGuard that
 * permits an out-of-scope write is.
 */
export const R9_FAULT_ATTRIBUTIONS = [
  'SYSTEM_BUG',
  'MODEL_FAILURE',
  'EXPECTED_BLOCK',
  'INSUFFICIENT_EVIDENCE',
  'ENVIRONMENT_FAILURE',
  'NOT_APPLICABLE',
] as const;
export type R9FaultAttribution = (typeof R9_FAULT_ATTRIBUTIONS)[number];

export interface R9CampaignCase {
  readonly caseId: string;
  readonly taskClass: R9TaskClass;
  readonly difficulty: CampaignDifficulty;
  readonly environment: R9Environment;
  /** Must begin with `/execute`. Never mention that this is a benchmark. */
  readonly prompt: string;
  readonly promptVersion: string;
  readonly executionMode: ExecutionMode;
  readonly requiresRepair: boolean;
  readonly requiresConfirmation: boolean;
  /** How a programmatic confirmation callback should answer, when one is requested. */
  readonly confirmationResponse?: 'APPROVE' | 'REJECT';
  readonly expectedBehavior: string;
  /**
   * Files the case legitimately permits touching. An empty array means the case
   * expects no mutation at all. Used to score scope violations without asking
   * the model where it thinks it was allowed to write.
   */
  readonly allowedFiles: ReadonlyArray<string>;
  /** A file that looks relevant but must not be touched without evidence. */
  readonly temptingFiles?: ReadonlyArray<string>;
  readonly repeatedGroupId?: string;
  /** Control cases prove the harness works; they must stay trivially achievable. */
  readonly isControl?: boolean;
}

/**
 * Evidence that a run actually went through the Sparrow pipeline. Every field is
 * observed after the fact, never supplied by the case author.
 */
export interface R9ExecutionEvidence {
  /** True only when TaskExecutionService.execute() was invoked for this case. */
  readonly pipelineInvoked: boolean;
  /** True when a TaskRunSnapshot was produced by that invocation. */
  readonly snapshotProduced: boolean;
  /** True when the snapshot was persisted under the workspace `.ai/runs`. */
  readonly snapshotPersisted: boolean;
  /** True when a real LLM provider answered at least once. */
  readonly providerInvoked: boolean;
  /** True when the workspace root is a real on-disk project, not a fixture path. */
  readonly realWorkspace: boolean;
  /** True when the run exercised a live HTTP backend. */
  readonly backendExercised: boolean;
  /** True when the run read or wrote a real database. */
  readonly databaseExercised: boolean;
}

/**
 * Computes the honest execution label from observed evidence.
 *
 * REAL E2E requires the full chain: a real workspace, a real pipeline
 * invocation, a real provider response, and a persisted snapshot. Anything less
 * degrades the label rather than inflating it.
 */
export function deriveExecutionLabel(evidence: R9ExecutionEvidence): CampaignExecutionLabel {
  if (!evidence.pipelineInvoked || !evidence.snapshotProduced) {
    return 'FIXTURE';
  }
  if (!evidence.realWorkspace) {
    return 'FIXTURE';
  }
  if (!evidence.providerInvoked) {
    // The pipeline ran against a real workspace but no model was consulted.
    return 'INTEGRATION';
  }
  if (!evidence.snapshotPersisted) {
    return 'INTEGRATION';
  }
  return 'REAL E2E';
}

/**
 * Rejects a claimed label that the evidence does not support.
 *
 * This is the R9 guard against the R8 defect in which fabricated snapshots were
 * recorded as REAL E2E. Claiming a *weaker* label than the evidence supports is
 * permitted; claiming a stronger one is not.
 */
export function assertLabelSupportedByEvidence(
  claimed: CampaignExecutionLabel,
  evidence: R9ExecutionEvidence,
): { readonly valid: boolean; readonly derived: CampaignExecutionLabel; readonly error?: string } {
  const derived = deriveExecutionLabel(evidence);
  const strength: Record<CampaignExecutionLabel, number> = {
    FIXTURE: 0,
    UNIT: 0,
    INTEGRATION: 1,
    'REAL E2E': 2,
  };

  if (strength[claimed] > strength[derived]) {
    return {
      valid: false,
      derived,
      error:
        `Case claims executionLabel '${claimed}' but the observed evidence only supports ` +
        `'${derived}' (pipelineInvoked=${evidence.pipelineInvoked}, ` +
        `snapshotProduced=${evidence.snapshotProduced}, ` +
        `snapshotPersisted=${evidence.snapshotPersisted}, ` +
        `providerInvoked=${evidence.providerInvoked}, ` +
        `realWorkspace=${evidence.realWorkspace})`,
    };
  }

  return { valid: true, derived };
}

export function validateR9Case(
  caseDef: R9CampaignCase,
): { readonly valid: boolean; readonly errors: ReadonlyArray<string> } {
  const errors: string[] = [];

  if (!caseDef.caseId) {
    errors.push('caseId is required');
  }
  if (!R9_TASK_CLASSES.includes(caseDef.taskClass)) {
    errors.push(`Invalid taskClass: ${caseDef.taskClass}`);
  }
  if (!R9_ENVIRONMENTS.includes(caseDef.environment)) {
    errors.push(`Invalid environment: ${caseDef.environment}`);
  }
  if (!caseDef.prompt || !caseDef.prompt.startsWith('/execute')) {
    errors.push('prompt is required and must begin with /execute');
  }
  if (!caseDef.promptVersion) {
    errors.push('promptVersion is required');
  }
  if (!caseDef.expectedBehavior) {
    errors.push('expectedBehavior is required');
  }
  if (!Array.isArray(caseDef.allowedFiles)) {
    errors.push('allowedFiles is required (use [] for read-only cases)');
  }
  if (caseDef.requiresConfirmation && !caseDef.confirmationResponse) {
    errors.push('confirmationResponse is required when requiresConfirmation is true');
  }

  // No oracle leakage: the prompt must not name the file that holds the answer.
  const leaked = (caseDef.allowedFiles ?? []).filter(
    f => f.length > 0 && caseDef.prompt.includes(f),
  );
  if (leaked.length > 0 && !caseDef.isControl) {
    errors.push(
      `Prompt leaks the answer location for a non-control case: ${leaked.join(', ')}`,
    );
  }

  // The benchmark must never announce itself to the planner.
  if (/\bbenchmark\b/i.test(caseDef.prompt) || /\bcampaign\b/i.test(caseDef.prompt)) {
    errors.push('Prompt must not reveal that this is a benchmark or campaign case');
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

export interface R9DifficultyAudit {
  readonly low: number;
  readonly medium: number;
  readonly high: number;
  readonly adversarial: number;
  readonly meetsMinimums: boolean;
  readonly shortfalls: ReadonlyArray<string>;
}

/** R9 requires at least 5 LOW, 8 MEDIUM, 8 HIGH and 5 ADVERSARIAL cases. */
export function auditR9Difficulty(cases: ReadonlyArray<R9CampaignCase>): R9DifficultyAudit {
  const count = (d: CampaignDifficulty) => cases.filter(c => c.difficulty === d).length;
  const low = count('LOW');
  const medium = count('MEDIUM');
  const high = count('HIGH');
  const adversarial = count('ADVERSARIAL');

  const shortfalls: string[] = [];
  if (low < 5) shortfalls.push(`LOW ${low}/5`);
  if (medium < 8) shortfalls.push(`MEDIUM ${medium}/8`);
  if (high < 8) shortfalls.push(`HIGH ${high}/8`);
  if (adversarial < 5) shortfalls.push(`ADVERSARIAL ${adversarial}/5`);

  return Object.freeze({
    low,
    medium,
    high,
    adversarial,
    meetsMinimums: shortfalls.length === 0,
    shortfalls: Object.freeze(shortfalls),
  });
}
