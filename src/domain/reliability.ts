/**
 * Milestone G — Reliability Evidence & Measurement.
 *
 * These types describe what recorded evidence says about a run, not what the
 * pipeline hoped to achieve. Absent evidence stays absent: there is no state
 * in this file that lets a missing verification become a pass, or an unknown
 * impact become "no impact".
 */

import { ExecutionMode } from './execution-mode';

/**
 * Bumped whenever a persisted reliability shape changes. Readers use it to
 * decide whether a stored record can be trusted or must be rebuilt from the
 * task-run snapshot, which remains the source of truth.
 */
/**
 * v2 added `repair.repairMode` and narrowed recorded framework versions to
 * detected frameworks, so v1 records must be rebuilt from their snapshots.
 */
/**
 * v3 added `executionMode`, R1 todo-verification counters, the workspace
 * comparison record and the verification side-effect summary.
 */
export const RELIABILITY_SCHEMA_VERSION = 3;

/** How much evidence a single area of a run left behind. */
export const EVIDENCE_PRESENCES = ['COMPLETE', 'PARTIAL', 'MISSING', 'NOT_APPLICABLE'] as const;
export type EvidencePresence = (typeof EVIDENCE_PRESENCES)[number];

/**
 * What the evidence supports for a measured property.
 *
 * `NOT_PROVEN` means evidence exists and contradicts the property.
 * `UNKNOWN` means the property was never determined.
 * `INSUFFICIENT_EVIDENCE` means evidence exists but cannot carry the claim.
 */
export const EVIDENCE_STATES = [
  'PROVEN',
  'NOT_PROVEN',
  'UNKNOWN',
  'INSUFFICIENT_EVIDENCE',
  'NOT_APPLICABLE',
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** Deterministic final classification of a run (G.3). */
export const RUN_OUTCOMES = [
  'SUCCESS',
  'SUCCESS_AFTER_REPAIR',
  'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
  'FAILED',
  'BLOCKED',
  'ABORTED',
  'PARTIAL',
  'INSUFFICIENT_EVIDENCE',
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Populations a run may belong to (G.19). A run can belong to several. */
export const RUN_POPULATIONS = [
  'ALL_RUNS',
  'EXECUTION_RUNS',
  'PLANNING_ONLY',
  'BACKEND_RUNS',
  'FRONTEND_RUNS',
  'REPAIR_RUNS',
  /** R1.32: read-only inspection is never a mutation success or failure. */
  'READ_ONLY_INSPECTION',
  'MUTATING_EXECUTION',
] as const;
export type RunPopulation = (typeof RUN_POPULATIONS)[number];

/** Why the planner stopped producing usable output (G.13). */
export const PLANNER_OUTPUT_STATUSES = [
  'VALID_TODO_PLAN',
  'PLAN_WITHOUT_TODO_PLAN',
  'OUTPUT_REJECTED',
  'PROVIDER_FAILURE',
  'TIMEOUT',
  'NOT_ATTEMPTED',
  'UNKNOWN',
] as const;
export type PlannerOutputStatus = (typeof PLANNER_OUTPUT_STATUSES)[number];

export const EXECUTION_STATUSES = [
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'NOT_ATTEMPTED',
  'UNKNOWN',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const VERIFICATION_STATUSES = ['PASSED', 'FAILED', 'NOT_RUN', 'UNKNOWN'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const REPAIR_STATUSES = [
  'NOT_REQUIRED',
  'SUCCEEDED',
  'FAILED',
  'LIMIT_REACHED',
  'BLOCKED',
  'IN_PROGRESS',
  'UNKNOWN',
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

/**
 * A counted coverage dimension.
 *
 * `ratio` is null whenever the denominator is unknown or zero: the report
 * never manufactures a percentage to fill a gap (G.8).
 */
export interface CoverageMetric {
  readonly required: number;
  readonly selected: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly unknown: number;
  readonly ratio: number | null;
  readonly state: EvidenceState;
  readonly basis: string;
}

export interface TodoCoverage {
  readonly total: number;
  readonly executed: number;
  readonly verified: number;
  readonly failed: number;
  readonly unknown: number;
  /** R1.30: todos with no mapped check at all, distinct from UNKNOWN. */
  readonly notTested: number;
  readonly blocked: number;
  readonly scope: string;
  readonly state: EvidenceState;
}

/** R1.29/R1.31: the workspace evidence a run left behind. */
export interface ReliabilityWorkspaceComparison {
  readonly present: boolean;
  readonly state: 'PROVEN' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';
  readonly intendedFiles: ReadonlyArray<string>;
  readonly intendedChangedFiles: ReadonlyArray<string>;
  readonly actualChangedFiles: ReadonlyArray<string>;
  readonly unintendedChangedFiles: ReadonlyArray<string>;
  readonly missingExpectedChanges: ReadonlyArray<string>;
  readonly preExistingDirtyFiles: ReadonlyArray<string>;
  readonly wrongFileModification: EvidenceState;
  readonly basis: string;
}

/**
 * R2.23: what the executor's mutation safety boundary actually did.
 *
 * `present: false` means the run predates R2 or never attempted a guarded
 * mutation. It is never read as "no mutation problems occurred".
 */
export interface ReliabilityMutationSafety {
  readonly present: boolean;
  readonly attempts: number;
  readonly applied: number;
  readonly rejected: number;
  readonly blocked: number;
  readonly rolledBack: number;
  readonly failed: number;
  readonly syntaxFailures: number;
  readonly suspiciousDiffs: number;
  readonly expectedChangeFailures: number;
  readonly rollbackFailures: number;
  readonly outOfScopeAttempts: number;
  /** PROVEN once any guarded mutation ran; UNKNOWN when no evidence exists. */
  readonly state: EvidenceState;
  readonly basis: string;
}

/** R1.29: verification's own footprint on project state. */
export interface ReliabilitySideEffects {
  readonly present: boolean;
  readonly policy: string;
  readonly performed: number;
  readonly blocked: number;
  readonly undeclared: number;
}

export interface ImpactCoverage {
  readonly confidence: string;
  readonly affected: number;
  readonly verified: number;
  readonly unverified: number;
  readonly unknown: number;
  readonly limitsReached: boolean;
  readonly ratio: number | null;
  readonly state: EvidenceState;
}

export interface EndpointCoverage {
  readonly discovered: number;
  readonly tested: number;
  readonly passed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly skipped: number;
  readonly skipReasons: ReadonlyArray<{ readonly endpoint: string; readonly reason: string }>;
  readonly ratio: number | null;
  readonly state: EvidenceState;
}

export interface RegressionCoverage {
  readonly risk: string;
  readonly policy: string;
  readonly selected: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly skipReasons: ReadonlyArray<{ readonly check: string; readonly reason: string }>;
  readonly ratio: number | null;
  readonly state: EvidenceState;
}

export interface ReliabilityPlanning {
  readonly plannerOutputStatus: PlannerOutputStatus;
  readonly todoPlanPresent: boolean;
  readonly todoCount: number;
  readonly plannerFailureReason?: string;
}

export interface ReliabilityExecution {
  readonly status: ExecutionStatus;
  readonly totalSteps: number;
  readonly succeededSteps: number;
  readonly failedSteps: number;
  readonly pendingSteps: number;
  readonly intendedFiles: ReadonlyArray<string>;
  readonly actualChangedFiles: ReadonlyArray<string>;
  /**
   * Only files the workspace tracker positively attributed to this run and
   * that fall outside the planned scope. A pre-existing dirty file never
   * lands here (G.17).
   */
  readonly unintendedChangedFiles: ReadonlyArray<string>;
  readonly wrongFileModification: EvidenceState;
  readonly wrongFileBasis: string;
}

export interface ReliabilityVerification {
  readonly status: VerificationStatus;
  readonly scope: string;
  readonly qualityProfile?: string;
  readonly coverage: CoverageMetric;
}

export interface ReliabilityFailure {
  readonly present: boolean;
  readonly summary?: string;
  readonly classification?: string;
  readonly primaryCheckId?: string;
  readonly secondaryCount: number;
  readonly incidentalCount: number;
  readonly failedTodoId?: string;
  readonly failedTodoKnown: boolean;
}

export interface ReliabilityRepair {
  readonly status: RepairStatus;
  readonly attempts: number;
  readonly repairAttempts: number;
  /**
   * The pipeline entered this run with a failure contract, so the run is
   * itself an answer to an earlier failure even if its own attempt history
   * is empty.
   */
  readonly repairMode: boolean;
  readonly succeeded: boolean;
  readonly limitReached: boolean;
  readonly blocked: boolean;
  readonly duplicateDetected: boolean;
  readonly maxExpansionLevel: number;
  readonly contextExpansionUsed: boolean;
  /** R3.31: files a bounded expansion actually added to the planner context. */
  readonly expandedFiles: number;
  /**
   * R3.31: true only when expansion happened AND the run then succeeded, so a
   * repair that succeeded before any expansion is never credited to it.
   */
  readonly succeededAfterExpansion: boolean;
  /** R3.18: the loop ended because a repeated plan had nothing new to read. */
  readonly stoppedForNoNewEvidence: boolean;
  /** R3.18: the loop ended at the configured expansion ceiling. */
  readonly stoppedForExpansionLimit: boolean;
  /** R3.4: the run reported it could not identify the evidence it needed. */
  readonly needsContext: boolean;
  /**
   * R4.33: whether the repair stayed anchored to the original task. False
   * whenever target validation or outcome analysis raised a blocking finding,
   * regardless of whether verification later passed.
   */
  readonly repairTargetValid: boolean;
  readonly acceptanceChasingDetected: boolean;
  readonly scopeEscapeDetected: boolean;
  readonly testManipulationDetected: boolean;
  readonly verificationBypassDetected: boolean;
  readonly configBypassDetected: boolean;
  readonly intentMismatchDetected: boolean;
  /**
   * R4.33: the distinction the milestone exists to make. A repair counts as
   * legitimate only when completion said PRIMARY_RESOLVED, not when the build
   * merely went green.
   */
  readonly legitimateRepairSuccess: boolean;
  readonly suppressedSymptomRejected: boolean;
}

export interface ReliabilityConfirmation {
  readonly confirmationRequired: boolean;
  readonly confirmationApproved: boolean;
  readonly confirmationRejected: boolean;
  readonly confirmationExpired: boolean;
  readonly confirmationInvalidated: boolean;
  readonly credentialRequested: boolean;
  readonly credentialProvided: boolean;
  readonly requestId?: string;
  readonly type?: string;
  readonly status?: string;
}

/** Why a recorded success cannot be fully trusted (G.16, G.32). */
export interface SuspicionFinding {
  readonly code: string;
  readonly detail: string;
}

export interface ReliabilitySuspicion {
  readonly suspicious: boolean;
  readonly findings: ReadonlyArray<SuspicionFinding>;
}

export interface EvidenceCompleteness {
  readonly planning: EvidencePresence;
  readonly todoPlan: EvidencePresence;
  readonly execution: EvidencePresence;
  readonly verification: EvidencePresence;
  readonly repair: EvidencePresence;
  readonly impact: EvidencePresence;
  readonly regression: EvidencePresence;
  readonly workspace: EvidencePresence;
  /** COMPLETE only when no area is MISSING or PARTIAL. */
  readonly overall: EvidencePresence;
}

/** Grouping keys recorded with the run so history is never re-derived from today's project (G.22-G.24). */
export interface ReliabilityDimensions {
  readonly workspaceRoot: string;
  readonly projectType?: string;
  readonly frameworks: ReadonlyArray<string>;
  readonly frameworkVersions: ReadonlyArray<string>;
  readonly skillIds: ReadonlyArray<string>;
  readonly qualityProfile?: string;
  readonly riskLevels: ReadonlyArray<string>;
  readonly impactConfidence?: string;
}

/** One normalized, terminated task run (G.1). */
export interface ReliabilityRecord {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly attemptCount?: number;
  readonly task: string;
  readonly roleId: string;
  readonly workspaceRoot: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs: number | null;
  readonly recordedStatus: string;
  readonly outcome: RunOutcome;
  readonly outcomeReason: string;
  readonly firstPassSuccess: boolean;
  readonly successAfterRepair: boolean;
  readonly finalFailure: boolean;
  readonly blocked: boolean;
  readonly populations: ReadonlyArray<RunPopulation>;
  /** R1.24: absent for runs recorded before R1; never assumed to be STANDARD. */
  readonly executionMode?: ExecutionMode;
  readonly readOnly: boolean;
  readonly workspaceComparison: ReliabilityWorkspaceComparison;
  readonly mutationSafety: ReliabilityMutationSafety;
  readonly verificationSideEffects: ReliabilitySideEffects;
  readonly planning: ReliabilityPlanning;
  readonly execution: ReliabilityExecution;
  readonly verification: ReliabilityVerification;
  readonly todoCoverage: TodoCoverage;
  readonly impactCoverage: ImpactCoverage;
  readonly endpointCoverage: EndpointCoverage;
  readonly regression: RegressionCoverage;
  readonly repair: ReliabilityRepair;
  readonly failure: ReliabilityFailure;
  readonly suspicion: ReliabilitySuspicion;
  readonly evidenceCompleteness: EvidenceCompleteness;
  readonly dimensions: ReliabilityDimensions;
  /** R5: confirmation outcomes and credential interactions */
  readonly confirmation?: ReliabilityConfirmation;
}

/**
 * A rate with its arithmetic exposed. A consumer can always recompute
 * `numerator / denominator` and see which population it came from (G.18).
 */
export interface ReliabilityRate {
  readonly name: string;
  readonly formula: string;
  readonly population: RunPopulation;
  readonly numerator: number;
  readonly denominator: number;
  readonly ratio: number | null;
  readonly percent: string;
  readonly sampleSize: number;
  readonly state: EvidenceState;
  readonly insufficientSample: boolean;
}

export interface ReliabilityPeriod {
  readonly window: string;
  readonly from?: string;
  readonly to?: string;
}

export interface ReliabilityFilters {
  readonly window: string;
  readonly workspaceRoot?: string;
  readonly projectType?: string;
  readonly framework?: string;
  readonly skillId?: string;
  readonly population: RunPopulation;
  readonly minSampleSize: number;
}

export interface ReliabilityTotals {
  readonly allRuns: number;
  readonly executionRuns: number;
  readonly planningOnly: number;
  readonly backendRuns: number;
  readonly frontendRuns: number;
  readonly repairRuns: number;
  /** R1.32: kept separate from mutating execution totals. */
  readonly readOnlyInspection: number;
  readonly mutatingExecution: number;
}

export interface AggregateCoverage {
  readonly runsWithEvidence: number;
  readonly runsWithoutEvidence: number;
  readonly required: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly ratio: number | null;
  readonly state: EvidenceState;
}

export interface ReliabilityPlanningSummary {
  readonly plannerRequests: number;
  readonly validTodoPlan: number;
  readonly planWithoutTodoPlan: number;
  readonly outputRejected: number;
  readonly providerFailure: number;
  readonly timeout: number;
  readonly notAttempted: number;
  readonly unknown: number;
}

export interface ReliabilityExecutionSummary {
  readonly executionAttempts: number;
  readonly completed: number;
  readonly partial: number;
  readonly failed: number;
  readonly totalSteps: number;
  readonly succeededSteps: number;
  readonly failedSteps: number;
  readonly runsWithUnintendedChanges: number;
  readonly runsWithUnknownWorkspaceEvidence: number;
}

export interface ReliabilityRepairSummary {
  readonly repairRuns: number;
  readonly repairAttempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly limitReached: number;
  readonly blocked: number;
  readonly duplicateDetected: number;
  readonly contextExpansionUsed: number;
  /** R3.31: repairs that expanded context, out of repairRuns. */
  readonly repairsWithExpansion: number;
  /** R3.31: repairs that did not expand, out of repairRuns. */
  readonly repairsWithoutExpansion: number;
  /** R3.31: successes that followed an expansion, out of succeeded. */
  readonly successfulRepairsAfterExpansion: number;
  readonly stoppedForNoNewEvidence: number;
  readonly stoppedForExpansionLimit: number;
  readonly needsContext: number;
  /** R4.33: all denominated by repairRuns unless stated otherwise. */
  readonly repairTargetValid: number;
  readonly acceptanceChasingDetected: number;
  readonly scopeEscapeDetected: number;
  readonly testManipulationDetected: number;
  readonly verificationBypassDetected: number;
  readonly configBypassDetected: number;
  readonly intentMismatchDetected: number;
  /** Out of `succeeded`: repairs that resolved the primary failure honestly. */
  readonly legitimateRepairSuccess: number;
  /** Out of repairRuns: repairs refused for suppressing the symptom. */
  readonly suppressedSymptomRejected: number;
}

export interface ReliabilitySafetySummary {
  readonly runsWithUnintendedChanges: number;
  readonly unintendedFiles: ReadonlyArray<string>;
  readonly runsWithAmbiguousWorkspaceEvidence: number;
}

export interface ReliabilityEvidenceQuality {
  readonly complete: number;
  readonly partial: number;
  readonly missing: number;
  readonly notApplicable: number;
  readonly byArea: Readonly<Record<string, Readonly<Record<EvidencePresence, number>>>>;
}

export interface ReliabilityDimensionBreakdown {
  readonly key: string;
  readonly runs: number;
  readonly firstPassSuccess: number;
  readonly finalSuccess: number;
  readonly failed: number;
  readonly blocked: number;
  readonly suspicious: number;
}

export interface ReliabilityDimensionsSummary {
  readonly bySkill: ReadonlyArray<ReliabilityDimensionBreakdown>;
  readonly byFramework: ReadonlyArray<ReliabilityDimensionBreakdown>;
  readonly byFrameworkVersion: ReadonlyArray<ReliabilityDimensionBreakdown>;
  readonly byWorkspace: ReadonlyArray<ReliabilityDimensionBreakdown>;
  readonly byRisk: ReadonlyArray<ReliabilityDimensionBreakdown>;
  readonly byImpactConfidence: ReadonlyArray<ReliabilityDimensionBreakdown>;
}

/** Which runs produced each side of a rate, so any number can be traced (G.31). */
export interface RateContribution {
  readonly name: string;
  readonly numeratorRuns: ReadonlyArray<string>;
  readonly denominatorRuns: ReadonlyArray<string>;
}

export interface SuspiciousRunView {
  readonly taskId: string;
  readonly outcome: RunOutcome;
  readonly findings: ReadonlyArray<SuspicionFinding>;
}

export interface ReliabilityConfirmationSummary {
  readonly confirmationRequiredRuns: number;
  readonly approvedRuns: number;
  readonly rejectedRuns: number;
  readonly expiredRuns: number;
  readonly invalidatedRuns: number;
  readonly credentialRequestedRuns: number;
  readonly credentialProvidedRuns: number;
}

export interface ReliabilityReport {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly period: ReliabilityPeriod;
  readonly filters: ReliabilityFilters;
  readonly totals: ReliabilityTotals;
  readonly outcomes: Readonly<Record<RunOutcome, number>>;
  readonly rates: ReadonlyArray<ReliabilityRate>;
  readonly planning: ReliabilityPlanningSummary;
  readonly execution: ReliabilityExecutionSummary;
  readonly verification: AggregateCoverage;
  readonly impact: AggregateCoverage;
  readonly endpoints: AggregateCoverage;
  readonly regression: AggregateCoverage;
  readonly todos: AggregateCoverage;
  readonly repair: ReliabilityRepairSummary;
  readonly safety: ReliabilitySafetySummary;
  readonly confirmation?: ReliabilityConfirmationSummary;
  readonly evidenceQuality: ReliabilityEvidenceQuality;
  readonly dimensions: ReliabilityDimensionsSummary;
  readonly contributions: ReadonlyArray<RateContribution>;
  readonly suspiciousRuns: ReadonlyArray<SuspiciousRunView>;
}

export const RELIABILITY_TIME_WINDOWS = ['24h', '7d', '30d', 'all'] as const;
export type ReliabilityTimeWindow = (typeof RELIABILITY_TIME_WINDOWS)[number];

export function isReliabilityTimeWindow(value: unknown): value is ReliabilityTimeWindow {
  return typeof value === 'string'
    && (RELIABILITY_TIME_WINDOWS as ReadonlyArray<string>).includes(value);
}

export function isRunPopulation(value: unknown): value is RunPopulation {
  return typeof value === 'string' && (RUN_POPULATIONS as ReadonlyArray<string>).includes(value);
}

/** Milliseconds covered by a window, or null for `all`. */
export function windowDurationMs(window: ReliabilityTimeWindow): number | null {
  switch (window) {
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/**
 * Builds a rate that refuses to invent a value: a zero denominator yields a
 * null ratio and an explicit state rather than 0%.
 */
export function buildRate(input: {
  readonly name: string;
  readonly formula: string;
  readonly population: RunPopulation;
  readonly numerator: number;
  readonly denominator: number;
  readonly minSampleSize: number;
}): ReliabilityRate {
  const { numerator, denominator, minSampleSize } = input;
  const hasDenominator = denominator > 0;
  const ratio = hasDenominator ? numerator / denominator : null;
  const insufficientSample = hasDenominator && denominator < minSampleSize;
  const state: EvidenceState = !hasDenominator
    ? 'INSUFFICIENT_EVIDENCE'
    : insufficientSample
      ? 'INSUFFICIENT_EVIDENCE'
      : 'PROVEN';
  return Object.freeze({
    name: input.name,
    formula: input.formula,
    population: input.population,
    numerator,
    denominator,
    ratio,
    percent: ratio === null ? 'INSUFFICIENT_EVIDENCE' : `${(ratio * 100).toFixed(1)}%`,
    sampleSize: denominator,
    state,
    insufficientSample,
  });
}

export function formatRate(rate: ReliabilityRate): string {
  if (rate.ratio === null) {
    return `${rate.name}: INSUFFICIENT_EVIDENCE (0 eligible runs in ${rate.population})`;
  }
  const suffix = rate.insufficientSample ? ' [INSUFFICIENT_SAMPLE]' : '';
  return `${rate.name}: ${rate.numerator} / ${rate.denominator} ${rate.population} = ${rate.percent}${suffix}`;
}
