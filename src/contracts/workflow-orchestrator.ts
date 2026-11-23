import { ExecutionPlan } from '../domain/execution-plan';
import { ImpactReport } from '../domain/impact-analysis';
import { RegressionPlan } from '../domain/regression-plan';
import { ReviewReport } from '../domain/review-report';
import { PatchResult } from '../domain/patch';
import { Reflection } from '../domain/reflection';
import { CorrelationContext } from '../domain/correlation';

export interface WorkflowOptions {
  readonly task: string;
  readonly targetFiles?: ReadonlyArray<string>;
  readonly patchRequest?: import('../domain/patch').PatchRequest;
  readonly plannedScope?: ReadonlyArray<string>;
  readonly availableTools?: ReadonlyArray<string>;
  readonly memoryContext?: string;
  readonly verificationStrategy?: import('../domain/verification-strategy').VerificationStrategy;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly plannerProviderId?: string;
  readonly plannerModelId?: string;
  readonly configurationSnapshot?: import('../domain/configuration-snapshot').ConfigurationSnapshot;
  readonly qualityProfile?: import('../domain/quality-profile').QualityProfile;
  readonly failureContract?: import('../domain/failure-contract').FailureContract;
  readonly repairAttempt?: number;
  readonly skipVv?: boolean;
  readonly previouslyTouchedFiles?: ReadonlyArray<string>;
  readonly repairAttemptHistory?: import('../domain/repair-intelligence').RepairAttemptHistory;
  readonly repairExpansionLevel?: number;
  readonly repairCandidateFiles?: ReadonlyArray<string>;
  /** R3.23: dependency evidence carried over from the attempt that failed. */
  readonly repairImpactAnalysis?: import('../domain/impact-analysis').ImpactAnalysis;
  /** R3.22: mutation evidence carried over from the attempt that failed. */
  readonly repairMutationLedger?: import('../domain/execution/mutation-safety').MutationLedger;
  /** R3.8: the context the previous attempt planned from, by content. */
  readonly repairPreviousContext?: ReadonlyArray<import('../domain/repair/context-expansion').ContextRef>;
  /** R3.11: the previous attempt reproduced an earlier plan. */
  readonly repairDuplicatePlan?: boolean;
  /** R3.19: whether the expansion before the previous attempt found anything. */
  readonly repairPreviousExpansionYieldedEvidence?: boolean;
  /**
   * R4.3: the TodoPlan from the attempt that originally failed. Repair is
   * judged against this plan's scope, so it must be carried forward rather
   * than re-derived from the failure.
   */
  readonly originalTodoPlan?: import('../domain/todo-plan').TodoPlan;
  /**
   * R4.2: acceptance criteria from the first attempt's Product QA. Carried so
   * that a later attempt cannot quietly regenerate easier criteria.
   */
  readonly originalAcceptanceCriteria?: ReadonlyArray<string>;
  /** R4.18: files R1 expected to change in the failed attempt but did not. */
  readonly repairMissingExpectedChanges?: ReadonlyArray<string>;
  /** R4.18: files R1 saw change in the failed attempt that were not intended. */
  readonly repairUnintendedChangedFiles?: ReadonlyArray<string>;
  /** Milestone B1: optional explicit skill/domain directive. CLI does not parse this yet. */
  readonly executionDirective?: import('./skill-resolver').ExecutionDirective;
  /** R1.18: explicit execution mode. Never inferred from task wording. */
  readonly executionMode?: import('../domain/execution-mode').ExecutionMode;
  /** INTERNAL_VALIDATION mode: the validator call to run instead of the pipeline. */
  readonly internalValidation?: import('../domain/internal-validation').InternalValidationRequest;
  /** R5: optional confirmation request id for resumed execution */
  readonly confirmationRequestId?: string;
  /** R5: optional interactive callback when confirmation is requested */
  readonly onConfirmationRequested?: (request: import('../domain/confirmation').ConfirmationRequest) => Promise<boolean>;
  /** R6: authoritative run correlation context */
  readonly correlationContext?: CorrelationContext;
  readonly taskId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
}

export interface WorkflowResult {
  readonly sessionId: string;
  readonly success: boolean;
  readonly plan: ExecutionPlan | null;
  readonly impactReport: ImpactReport | null;
  readonly regressionPlan?: RegressionPlan | null;
  readonly reviewReport: ReviewReport | null;
  readonly patchResult: PatchResult | null;
  readonly reflection: Reflection | null;
  readonly stateComparison?: import('../domain/execution/execution-state').StateComparison;
  readonly abortedAt?: string;
  readonly abortReason?: string;
  readonly qualityProfile?: import('../domain/quality-profile').QualityProfile;
  readonly productAnalysis?: import('../domain/product-analysis').ProductAnalysis;
  readonly verificationReport?: import('../domain/verification-report').VerificationReport;
  readonly failureContract?: import('../domain/failure-contract').FailureContract;
  readonly touchedFiles?: ReadonlyArray<string>;
  readonly plannerContext?: import('../domain/planner-context').PlannerContext;
  readonly stepResults?: ReadonlyArray<import('../domain/execution-context').StepResult>;
  readonly todoVerification?: import('../domain/repair-intelligence').TodoVerificationTrace;
  readonly repairAttemptHistory?: import('../domain/repair-intelligence').RepairAttemptHistory;
  readonly repairOutcome?: import('../domain/repair-intelligence').RepairSafetyState;
  /** R1.18/R1.24: mode this run actually executed under. */
  readonly executionMode?: import('../domain/execution-mode').ExecutionMode;
  /** R1.12: hash-based before/after comparison for eligible mutating runs. */
  readonly workspaceComparison?: import('../domain/execution/workspace-evidence').WorkspaceComparison;
  /** R2.18/R2.23: per-file mutation evidence from the executor safety boundary. */
  readonly mutationLedger?: import('../domain/execution/mutation-safety').MutationLedger;
  /** R1.3: per-Todo verdicts derived from explicitly mapped checks. */
  readonly todoVerificationReport?: import('../domain/todo-verification').TodoVerificationReport;
  /** R1.25-R1.27: what verification did to project state. */
  readonly verificationSideEffects?: import('../domain/verification-side-effect').VerificationSideEffectLedger;
  /** R3: the expansion decision, candidates and delta for this attempt. */
  readonly repairExpansion?: import('../domain/repair/repair-expansion-record').RepairExpansionRecord;
  /** R4: the repair objective, scope validation, findings and completion. */
  readonly repairTarget?: import('../domain/repair/repair-target-record').RepairTargetRecord;
  /**
   * R4.3: the TodoPlan this run planned, so the next repair attempt can be
   * judged against the scope that actually failed.
   */
  readonly executedTodoPlan?: import('../domain/todo-plan').TodoPlan;
  /** R4.2: acceptance criteria this run derived, for the next attempt to reuse. */
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  /** INTERNAL_VALIDATION mode: the validator outcome for this run. */
  readonly internalValidation?: import('../domain/internal-validation').InternalValidationOutcome;
  /** R5: confirmation request id if confirmation was created or evaluated. */
  readonly confirmationRequestId?: string;
  /** R6: authoritative run correlation identifiers */
  readonly runId?: string;
  readonly taskId?: string;
  readonly correlationContext?: CorrelationContext;
}

export interface WorkflowOrchestrator {
  execute(options: WorkflowOptions): Promise<WorkflowResult>;
}
