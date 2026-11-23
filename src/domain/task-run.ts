import { TodoPlan } from './todo-plan';
import { RepairAttempt, RepairSafetyState, TodoVerificationScope, TodoVerificationVerdictKind } from './repair-intelligence';
import { FailureClassification } from './failure-contract';
import { GatheredContextStatus, GatheredCollectionMethod } from './gathered-context';
import { ExecutionMode } from './execution-mode';
import { TodoVerdictKind, VerificationScope } from './todo-verification';
import { TaskOutcomeSummary } from './task-outcome-summary';

export * from './task-outcome-summary';

/**
 * Read model for one pipeline run, shared by CLI, REPL and the Web API.
 *
 * This is a projection of what Sparrow Core already produced. It never adds a
 * verdict the Core did not reach: absent evidence stays absent, and Todo-level
 * verification stays UNKNOWN while V&V evidence is whole-run.
 */

export const TASK_RUN_STATUSES = [
  'PLANNING',
  'CONTEXT',
  'EXECUTION',
  'VERIFICATION',
  'ACCEPTANCE',
  'REPAIR',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'INTERRUPTED',
] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export const TERMINAL_TASK_RUN_STATUSES: ReadonlyArray<TaskRunStatus> = Object.freeze([
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'INTERRUPTED',
]);

export interface TaskRunProject {
  readonly workspaceRoot: string;
  readonly projectType: string;
  readonly detectedFrameworks: ReadonlyArray<string>;
  readonly languages: ReadonlyArray<string>;
  readonly packageManager: string;
  readonly availableTestingTools: ReadonlyArray<string>;
  readonly detectedDomains: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<string>;
}

export interface TaskRunSkill {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly domains: ReadonlyArray<string>;
  readonly frameworks: ReadonlyArray<string>;
  readonly requiredChecks: ReadonlyArray<string>;
  readonly planningConstraints: ReadonlyArray<string>;
  /** Why the deterministic resolver selected this skill. */
  readonly resolutionSource?: string;
  readonly resolutionDetail?: string;
}

export interface TaskRunDirective {
  readonly explicitSkillIds: ReadonlyArray<string>;
  readonly requestedDomains: ReadonlyArray<string>;
}

export interface TaskRunVersionKnowledgeItem {
  readonly technology: string;
  readonly declaredVersion?: string;
  readonly resolvedVersion?: string;
  readonly normalizedVersion: string;
  readonly versionSource: string;
  readonly status: string;
  readonly effectiveSource: string;
  readonly summary: string;
  readonly provenance: string;
  readonly overridePath?: string;
  readonly staleReason?: string;
  readonly conflictReason?: string;
}

export interface TaskRunVersionIntelligence {
  readonly summary: string;
  readonly dependenciesCount: number;
  readonly effectiveKnowledgeCount: number;
  readonly items: ReadonlyArray<TaskRunVersionKnowledgeItem>;
  readonly staleCount: number;
  readonly conflictCount: number;
}

export interface TaskRunImpactRelation {
  readonly source: string;
  readonly target: string;
  readonly relationType: string;
  readonly confidence: string;
  readonly reason: string;
}

export interface TaskRunImpactAnalysis {
  readonly confidence: string;
  readonly summary: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly directlyAffected: ReadonlyArray<string>;
  readonly indirectlyAffected: ReadonlyArray<string>;
  readonly affectedEndpoints: ReadonlyArray<string>;
  readonly affectedTests: ReadonlyArray<string>;
  readonly affectedDomains: ReadonlyArray<string>;
  readonly relations: ReadonlyArray<TaskRunImpactRelation>;
  readonly unknowns: ReadonlyArray<string>;
  readonly limitsReached: boolean;
}

export interface TaskRunSkippedCheck {
  readonly check: string;
  readonly reason: string;
}

export interface TaskRunRegressionPlan {
  readonly risk: string;
  readonly policy: string;
  readonly directChecks: ReadonlyArray<string>;
  readonly expandedChecks: ReadonlyArray<string>;
  readonly selectedChecks: ReadonlyArray<string>;
  readonly skippedChecks: ReadonlyArray<TaskRunSkippedCheck>;
  readonly affectedArtifacts: ReadonlyArray<string>;
  readonly verifiedArtifacts: ReadonlyArray<string>;
  readonly unverifiedArtifacts: ReadonlyArray<string>;
  readonly reasons: ReadonlyArray<string>;
}

export interface TaskRunContextStrategy {
  readonly repairMode: boolean;
  readonly selectedSources: ReadonlyArray<string>;
  readonly requiredSources: ReadonlyArray<string>;
  readonly optionalSources: ReadonlyArray<string>;
  readonly excludedSources: ReadonlyArray<string>;
  readonly deferredSources: ReadonlyArray<string>;
  readonly missingRequired: ReadonlyArray<string>;
  readonly missingOptional: ReadonlyArray<string>;
  readonly reasoning: ReadonlyArray<string>;
}

export interface TaskRunContextItem {
  readonly index: number;
  readonly source: string;
  readonly reference: string;
  readonly status: GatheredContextStatus | string;
  readonly reason: string;
  readonly collectionMethod: GatheredCollectionMethod | string;
  readonly priority: number;
  readonly sizeBytes: number;
  readonly truncated: boolean;
  readonly hasContent: boolean;
  readonly error?: string;
  readonly failureRole?: string;
  readonly cacheHit?: boolean;
}

export interface TaskRunContextTotals {
  readonly records: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly truncatedCount: number;
  readonly limitReached: boolean;
}

export interface TaskRunStep {
  readonly stepId: string;
  readonly sourceTodoId?: string;
  readonly type?: string;
  readonly description?: string;
  readonly expectedOutcome?: string;
  readonly requiredTools: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly completedAt?: string;
  readonly error?: string;
}

export interface TaskRunVerificationCheck {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly severity: string;
  readonly passed: boolean;
  readonly evidence: string;
  readonly acceptanceCriterion?: string;
}

export interface TaskRunTodoVerdict {
  readonly todoId: string;
  readonly scope: TodoVerificationScope;
  readonly verdict: TodoVerificationVerdictKind;
  readonly reason: string;
}

export interface TaskRunVerification {
  readonly id?: string;
  readonly qualityProfile?: string;
  readonly passed: boolean;
  readonly scope: TodoVerificationScope;
  readonly checks: ReadonlyArray<TaskRunVerificationCheck>;
  readonly evidence: ReadonlyArray<string>;
  readonly todoVerdicts: ReadonlyArray<TaskRunTodoVerdict>;
}

export interface TaskRunFailureItem {
  readonly checkId: string;
  readonly name: string;
  readonly category: string;
  readonly severity: string;
  readonly evidence: string;
  readonly acceptanceCriterion?: string;
}

export interface TaskRunFailure {
  readonly id: string;
  readonly createdAt: string;
  readonly summary: string;
  readonly attempt: number;
  readonly attemptId?: string;
  readonly classification?: FailureClassification;
  readonly failureType?: string;
  readonly failedTodoId?: string;
  readonly failedTodoReason?: string;
  readonly failedStepId?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly primary?: TaskRunFailureItem & { readonly requiredOutcome?: string };
  readonly secondary: ReadonlyArray<TaskRunFailureItem>;
  readonly incidental: ReadonlyArray<TaskRunFailureItem>;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly implicatedFiles: ReadonlyArray<string>;
}

export interface TaskRunRepairAttemptView {
  readonly attemptId: string;
  readonly kind: string;
  readonly failedTodoId?: string;
  readonly failedStepId?: string;
  readonly todoIds: ReadonlyArray<string>;
  readonly planFingerprint: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly filesTouched: ReadonlyArray<string>;
  readonly verificationPassed?: boolean;
  readonly verificationScope: TodoVerificationScope;
  readonly failureContractId?: string;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly expansionLevel: number;
  readonly outcome: string;
  /** R3.9: identifies the context this attempt planned from. */
  readonly contextFingerprint?: string;
  /** R3.2: why the expansion before this attempt was allowed. */
  readonly expansionReason?: string;
}

/**
 * R3.29: expansion evidence for one repair attempt, shared verbatim by CLI,
 * REPL and Web so no interface derives expansion state of its own.
 */
export interface TaskRunExpansionView {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly expansionLevel: number;
  readonly decision: string;
  readonly reason: string;
  readonly stopCode?: string;
  readonly selectedFiles: ReadonlyArray<string>;
  readonly candidates: ReadonlyArray<{
    readonly path: string;
    readonly source: string;
    readonly rank: number;
    readonly confidence: string;
    readonly exists: boolean;
    readonly alreadyInContext: boolean;
    readonly reason: string;
  }>;
  readonly rejected: ReadonlyArray<{
    readonly path: string;
    readonly rejection: string;
    readonly reason: string;
  }>;
  readonly missingEvidence: ReadonlyArray<{
    readonly kind: string;
    readonly reference: string;
    readonly resolved: boolean;
  }>;
  readonly previousContextFingerprint?: string;
  readonly contextFingerprint?: string;
  readonly newFiles: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly unchangedFiles: ReadonlyArray<string>;
  readonly hasNewEvidence: boolean;
  readonly duplicatePlan: boolean;
}

export interface TaskRunRepair {
  readonly outcome?: RepairSafetyState;
  readonly attempts: ReadonlyArray<TaskRunRepairAttemptView>;
  readonly limits?: {
    readonly maxRepairAttempts: number;
    readonly maxContextExpansion: number;
    readonly maxRepairFiles: number;
  };
  /** R3.17: the expansion decision recorded for the latest repair attempt. */
  readonly expansion?: TaskRunExpansionView;
  /** R4.36: the repair-targeting decision for the latest repair attempt. */
  readonly target?: TaskRunRepairTargetView;
}

/**
 * R4.35/R4.36: repair targeting as the interfaces render it. CLI, REPL and Web
 * all read this, so none of them decides for itself whether a repair was
 * legitimate.
 */
export interface TaskRunRepairTargetView {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly originalTask: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly intent: string;
  readonly intentConfidence: string;
  readonly intentEvidence?: string;
  readonly originalTodoId?: string;
  readonly originalFiles: ReadonlyArray<string>;
  readonly primaryFailure?: string;
  readonly allowedFiles: ReadonlyArray<string>;
  readonly allowedOperations: ReadonlyArray<string>;
  readonly proposedFiles: ReadonlyArray<string>;
  readonly proposedOperations: ReadonlyArray<string>;
  readonly disallowedFiles: ReadonlyArray<string>;
  readonly decision: string;
  readonly decisionReason: string;
  readonly findings: ReadonlyArray<{
    readonly kind: string;
    readonly severity: string;
    readonly subject: string;
    readonly reason: string;
    readonly evidenceRef: string;
  }>;
  readonly completion?: {
    readonly state: string;
    readonly succeeded: boolean;
    readonly primaryResolved: boolean;
    /** Undefined when there were no acceptance criteria to preserve. */
    readonly acceptancePreserved?: boolean;
    readonly verificationPassed?: boolean;
    readonly scopeRespected: boolean;
    readonly reason: string;
  };
}

/**
 * Post-execution workspace comparison as the state tracker reported it.
 *
 * This is the only evidence that distinguishes a file this run actually
 * changed from a file that was already dirty beforehand, so reliability
 * measurement depends on it rather than on raw git status.
 */
export interface TaskRunWorkspaceIntegrity {
  readonly filesModified: ReadonlyArray<string>;
  readonly filesCreated: ReadonlyArray<string>;
  readonly filesDeleted: ReadonlyArray<string>;
  readonly unexpectedChanges: ReadonlyArray<string>;
  readonly hasUnexpectedChanges: boolean;
}

/** R1.12: hash-based before/after comparison, projected for observers. */
export interface TaskRunWorkspaceComparison {
  readonly state: 'PROVEN' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';
  readonly basis: string;
  readonly intendedFiles: ReadonlyArray<string>;
  readonly intendedChangedFiles: ReadonlyArray<string>;
  readonly actualChangedFiles: ReadonlyArray<string>;
  readonly unintendedChangedFiles: ReadonlyArray<string>;
  readonly missingExpectedChanges: ReadonlyArray<string>;
  readonly preExistingDirtyFiles: ReadonlyArray<string>;
  readonly createdFiles: ReadonlyArray<string>;
  readonly deletedFiles: ReadonlyArray<string>;
  readonly wrongFileModification: 'PROVEN' | 'NOT_PROVEN' | 'INSUFFICIENT_EVIDENCE';
}

/** R1.3: per-Todo verdicts with the checks they were derived from. */
export interface TaskRunTodoVerificationEntry {
  readonly todoId: string;
  readonly scope: VerificationScope;
  readonly verdict: TodoVerdictKind;
  readonly requiredChecks: ReadonlyArray<string>;
  readonly executedChecks: ReadonlyArray<string>;
  readonly missingChecks: ReadonlyArray<string>;
  readonly reason: string;
}

export interface TaskRunTodoVerification {
  readonly scope: VerificationScope;
  readonly todosTotal: number;
  readonly todosVerified: number;
  readonly todosFailed: number;
  readonly todosBlocked: number;
  readonly todosUnknown: number;
  readonly todosNotTested: number;
  readonly wholeRunCheckCount: number;
  readonly verdicts: ReadonlyArray<TaskRunTodoVerificationEntry>;
}

export interface TaskRunVerificationSideEffect {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly target: string;
  readonly policy: string;
  readonly status: string;
  readonly declared: boolean;
  readonly reversible: boolean;
  readonly detail: string;
}

export interface TaskRunSideEffects {
  readonly policy: string;
  readonly performedCount: number;
  readonly blockedCount: number;
  readonly undeclaredCount: number;
  readonly effects: ReadonlyArray<TaskRunVerificationSideEffect>;
}

/** R2.18/R2.23: per-file mutation evidence recorded with the run. */
export interface TaskRunMutationEntry {
  readonly path: string;
  readonly operation: string;
  readonly toolName: string;
  readonly status: string;
  readonly decision: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changed: boolean;
  readonly syntaxValid: boolean | null;
  readonly expectedChangePresent: boolean | null;
  readonly suspicious: boolean;
  readonly rolledBack: boolean;
  readonly rollbackVerified: boolean | null;
  readonly afterRollbackHash?: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly failureCodes: ReadonlyArray<string>;
  readonly detail?: string;
}

/** R2.23: run-level mutation accounting; never carries file bodies. */
export interface TaskRunMutationSafety {
  readonly mutationAttempts: number;
  readonly successfulMutations: number;
  readonly rejectedMutations: number;
  readonly blockedMutations: number;
  readonly rolledBackMutations: number;
  readonly failedMutations: number;
  readonly syntaxFailures: number;
  readonly unexpectedDiffs: number;
  readonly expectedChangeFailures: number;
  readonly rollbackFailures: number;
  readonly outOfScopeAttempts: number;
  readonly mutations: ReadonlyArray<TaskRunMutationEntry>;
}

export interface TaskRunConfirmationView {
  readonly requestId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly type?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly risk?: string;
  readonly requestedAction?: string;
  readonly affectedFiles?: ReadonlyArray<string>;
  readonly affectedArtifacts?: ReadonlyArray<string>;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly fingerprint?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly decision?: {
    readonly decision: string;
    readonly actor: string;
    readonly decidedAt: string;
    readonly reason?: string;
  };
  readonly credentialRequirement?: {
    readonly kind: string;
    readonly environment: string;
    readonly scope: string;
    readonly endpoints: ReadonlyArray<string>;
    readonly reason: string;
  };
}

export interface TaskRunSnapshot {
  readonly taskId: string;
  /** R6: authoritative run correlation identifier */
  readonly runId?: string;
  readonly sessionId?: string;
  /**
   * Session id used by the pipeline logger. It differs from the workflow
   * session id, so observers need it to find this run's events.
   */
  readonly logSessionId?: string;
  /** R6.42: audit fingerprint for run identity */
  readonly fingerprint?: string;
  /** R6.12: attempt count recorded during this run */
  readonly attemptCount?: number;
  /** Mandatory log correlation: exact filename of the pipeline log for this run */
  readonly logFileName?: string;
  /** Mandatory log correlation: relative path of the pipeline log file */
  readonly logFilePath?: string;
  readonly task: string;
  readonly roleId: string;
  readonly workspaceRoot: string;
  readonly status: TaskRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly domain?: string;
  readonly project?: TaskRunProject;
  readonly executionDirective?: TaskRunDirective;
  readonly skills: ReadonlyArray<TaskRunSkill>;
  readonly contextStrategy?: TaskRunContextStrategy;
  readonly versionIntelligence?: TaskRunVersionIntelligence;
  readonly contextTotals?: TaskRunContextTotals;
  readonly context: ReadonlyArray<TaskRunContextItem>;
  readonly plannerContextSummary?: string;
  readonly todoPlan?: TodoPlan;
  readonly impactAnalysis?: TaskRunImpactAnalysis;
  readonly regressionPlan?: TaskRunRegressionPlan;
  readonly execution: ReadonlyArray<TaskRunStep>;
  readonly touchedFiles: ReadonlyArray<string>;
  readonly workspaceIntegrity?: TaskRunWorkspaceIntegrity;
  /** R1.18: mode the run executed under; absent for runs recorded before R1. */
  readonly executionMode?: ExecutionMode;
  readonly workspaceComparison?: TaskRunWorkspaceComparison;
  /** R2.23: absent for runs recorded before R2; never assumed to be clean. */
  readonly mutationSafety?: TaskRunMutationSafety;
  readonly todoVerification?: TaskRunTodoVerification;
  readonly verificationSideEffects?: TaskRunSideEffects;
  readonly verification?: TaskRunVerification;
  readonly failure?: TaskRunFailure;
  readonly repair?: TaskRunRepair;
  /** R5: human confirmation state attached to this run */
  readonly confirmation?: TaskRunConfirmationView;
  readonly abortedAt?: string;
  readonly abortReason?: string;
  readonly error?: string;
  /** UX-OUTCOME.1: concise deterministic outcome explanation */
  readonly outcomeSummary?: TaskOutcomeSummary;
  /** PHASE-09: single durable execution authority */
  readonly finalTruth?: import('./final-truth').FinalTruth;
}

/** Stored separately from the snapshot so the dashboard never ships file bodies. */
export interface TaskRunContextContent {
  readonly taskId: string;
  readonly items: ReadonlyArray<{
    readonly index: number;
    readonly reference: string;
    readonly content: string;
    readonly truncatedForDisplay: boolean;
  }>;
}

export function isTaskRunStatus(value: unknown): value is TaskRunStatus {
  return typeof value === 'string' && (TASK_RUN_STATUSES as ReadonlyArray<string>).includes(value);
}

export function isTerminalTaskRunStatus(status: TaskRunStatus): boolean {
  return TERMINAL_TASK_RUN_STATUSES.includes(status);
}

export function repairAttemptToView(attempt: RepairAttempt): TaskRunRepairAttemptView {
  return Object.freeze({
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    failedTodoId: attempt.failedTodoId,
    failedStepId: attempt.failedStepId,
    todoIds: Object.freeze([...attempt.todoIds]),
    planFingerprint: attempt.planFingerprint,
    expected: attempt.expected,
    actual: attempt.actual,
    filesTouched: Object.freeze([...attempt.filesTouched]),
    verificationPassed: attempt.verificationPassed,
    verificationScope: attempt.verificationScope,
    failureContractId: attempt.failureContractId,
    evidenceRefs: Object.freeze([...attempt.evidenceRefs]),
    expansionLevel: attempt.expansionLevel,
    outcome: attempt.outcome,
    contextFingerprint: attempt.contextFingerprint,
    expansionReason: attempt.expansionReason,
  });
}
