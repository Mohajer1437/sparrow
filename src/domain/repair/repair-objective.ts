/**
 * R4: the domain model for repair targeting.
 *
 * The invariant this file exists to protect is that verification success is
 * not repair success. A repair is only valid when it still serves the task the
 * user actually asked for; making the failing check stop failing is not the
 * same thing, and is often the opposite.
 *
 * Everything here is pure and deterministic. No model output reaches it.
 */

/* ------------------------------------------------------------------ intent */

/**
 * What the original task was trying to do. Deliberately coarse: this exists to
 * answer "does the proposed repair operation belong to this kind of task",
 * not to describe the task fully. Anything not clearly evidenced is UNKNOWN.
 */
export const ORIGINAL_INTENTS = [
  'ADD_COMMENT',
  'MODIFY_BEHAVIOR',
  'FIX_BUG',
  'ADD_ENDPOINT',
  'CHANGE_UI',
  'REFACTOR',
  'REMOVE_FEATURE',
  'FIX_TEST',
  'UNKNOWN',
] as const;
export type OriginalIntent = (typeof ORIGINAL_INTENTS)[number];

export const INTENT_CONFIDENCES = ['EVIDENCED', 'UNKNOWN'] as const;
export type IntentConfidence = (typeof INTENT_CONFIDENCES)[number];

export interface OriginalIntentClassification {
  readonly intent: OriginalIntent;
  readonly confidence: IntentConfidence;
  /** The phrase in the task that produced this, quoted verbatim. */
  readonly evidence?: string;
  readonly reason: string;
}

/* -------------------------------------------------------------- operations */

export const REPAIR_OPERATIONS = ['ADD', 'MODIFY', 'DELETE', 'RENAME', 'MOVE'] as const;
export type RepairOperation = (typeof REPAIR_OPERATIONS)[number];

/**
 * Which operations each intent authorises. DELETE is the operation that turns
 * a repair into a workaround, so only intents that are actually about removal
 * carry it. UNKNOWN is deliberately conservative rather than permissive.
 */
export const OPERATIONS_BY_INTENT: Readonly<Record<OriginalIntent, ReadonlyArray<RepairOperation>>> =
  Object.freeze({
    ADD_COMMENT: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    MODIFY_BEHAVIOR: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    FIX_BUG: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    ADD_ENDPOINT: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    CHANGE_UI: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    // A refactor legitimately moves and renames, but does not drop behaviour.
    REFACTOR: Object.freeze(['ADD', 'MODIFY', 'RENAME', 'MOVE'] as RepairOperation[]),
    REMOVE_FEATURE: Object.freeze(['ADD', 'MODIFY', 'DELETE', 'RENAME', 'MOVE'] as RepairOperation[]),
    FIX_TEST: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
    UNKNOWN: Object.freeze(['ADD', 'MODIFY'] as RepairOperation[]),
  });

/* --------------------------------------------------------- file categories */

/**
 * Why a path matters to repair policy. A repair that edits a test or a config
 * file is not automatically wrong, but it is a different kind of act from
 * editing the implementation and has to be judged against the task.
 */
export const REPAIR_FILE_CATEGORIES = [
  'SOURCE',
  'TEST',
  'CONFIG',
  'VERIFICATION',
  'DOC',
  'UNKNOWN',
] as const;
export type RepairFileCategory = (typeof REPAIR_FILE_CATEGORIES)[number];

/* ---------------------------------------------------------------- findings */

export const REPAIR_SAFETY_FINDINGS = [
  'ACCEPTANCE_CHASING',
  'SCOPE_ESCAPE',
  'TEST_MANIPULATION',
  'VERIFICATION_BYPASS',
  'CONFIG_BYPASS',
  'INTENT_MISMATCH',
] as const;
export type RepairSafetyFindingKind = (typeof REPAIR_SAFETY_FINDINGS)[number];

export const FINDING_SEVERITIES = ['BLOCKING', 'SUSPICIOUS', 'INFORMATIONAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface RepairSafetyFinding {
  readonly kind: RepairSafetyFindingKind;
  readonly severity: FindingSeverity;
  /** The file or artifact this is about. */
  readonly subject: string;
  /** Plain statement of what is wrong, for a human reading the run. */
  readonly reason: string;
  /** The structured field this was derived from. */
  readonly evidenceRef: string;
}

/* ---------------------------------------------------------------- decision */

export const REPAIR_TARGET_DECISIONS = ['ALLOW', 'BLOCK', 'NEEDS_CONFIRMATION', 'UNKNOWN'] as const;
export type RepairTargetDecision = (typeof REPAIR_TARGET_DECISIONS)[number];

/* --------------------------------------------------------------- objective */

export interface RepairObjectiveEvidence {
  /** Files R1 said should have changed but did not. */
  readonly missingExpectedChanges: ReadonlyArray<string>;
  /** Files R1 said changed but should not have. */
  readonly unintendedChangedFiles: ReadonlyArray<string>;
  /** Files R2 refused or rolled back a mutation on. */
  readonly mutationTargets: ReadonlyArray<string>;
  /** Files R3 expansion added on evidence. */
  readonly expandedFiles: ReadonlyArray<string>;
}

/**
 * R4.4: what this repair is for, and what it is permitted to do. Assembled
 * once per repair attempt from the original run, then used to judge whatever
 * the planner proposes.
 */
export interface RepairObjective {
  /** R4.1: the user's words, carried forward unchanged. Never regenerated. */
  readonly originalTask: string;
  /** R4.2: from Product QA. Empty means UNKNOWN, never invented. */
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly intent: OriginalIntent;
  readonly intentConfidence: IntentConfidence;
  readonly intentEvidence?: string;
  /** R4.3 */
  readonly originalTodoId?: string;
  readonly originalFiles: ReadonlyArray<string>;
  readonly originalConstraints: ReadonlyArray<string>;
  readonly primaryFailure?: string;
  readonly primaryFailureCheckId?: string;
  /** R4.5: the only files this repair may touch. */
  readonly allowedFiles: ReadonlyArray<string>;
  /** R4.6 */
  readonly allowedOperations: ReadonlyArray<RepairOperation>;
  /** Named artifacts the repair must not remove or weaken. */
  readonly forbiddenChanges: ReadonlyArray<string>;
  readonly evidence: RepairObjectiveEvidence;
}

/* ------------------------------------------------------- validation result */

export interface RepairTargetValidation {
  readonly decision: RepairTargetDecision;
  readonly findings: ReadonlyArray<RepairSafetyFinding>;
  readonly proposedFiles: ReadonlyArray<string>;
  readonly proposedOperations: ReadonlyArray<RepairOperation>;
  /** Files in the plan that the objective did not permit. */
  readonly disallowedFiles: ReadonlyArray<string>;
  readonly reason: string;
}

/* ------------------------------------------------------------- completion */

export const REPAIR_COMPLETION_STATES = [
  'PRIMARY_RESOLVED',
  'PRIMARY_NOT_RESOLVED',
  'ACCEPTANCE_CHASING_DETECTED',
  'UNKNOWN',
] as const;
export type RepairCompletionState = (typeof REPAIR_COMPLETION_STATES)[number];

/**
 * R4.28/R4.29: whether the repair actually repaired anything. `succeeded` is
 * deliberately conjunctive — a passing build contributes one term, not the
 * verdict.
 */
export interface RepairCompletion {
  readonly state: RepairCompletionState;
  readonly succeeded: boolean;
  readonly primaryResolved: boolean;
  readonly acceptancePreserved: boolean | undefined;
  readonly verificationPassed: boolean | undefined;
  readonly scopeRespected: boolean;
  readonly findings: ReadonlyArray<RepairSafetyFinding>;
  readonly reason: string;
}

/* ------------------------------------------------------------------ shared */

export function normalizeObjectivePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function blockingFindings(
  findings: ReadonlyArray<RepairSafetyFinding>,
): ReadonlyArray<RepairSafetyFinding> {
  return findings.filter(item => item.severity === 'BLOCKING');
}

export function summarizeFindings(findings: ReadonlyArray<RepairSafetyFinding>): string {
  if (findings.length === 0) return 'none';
  return findings
    .map(item => `${item.kind}[${item.severity}]:${item.subject}`)
    .join('; ');
}
