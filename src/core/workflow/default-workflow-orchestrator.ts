import { WorkflowOrchestrator, WorkflowOptions, WorkflowResult } from '../../contracts/workflow-orchestrator';
import { TaskPlanner } from '../../contracts/task-planner';
import { ImpactAnalyzer } from '../../contracts/impact-analyzer';
import { ImpactReport } from '../../domain/impact-analysis';
import { RegressionSelector } from '../../contracts/regression-selector';
import { DeterministicRegressionSelector } from '../impact-analysis/deterministic-regression-selector';
import { RegressionPlan } from '../../domain/regression-plan';
import { Reviewer, PatchInfo } from '../../contracts/reviewer';
import { SafePatchExecutor } from '../patch/safe-patch-executor';
import { GitManager } from '../../contracts/git-manager';
import { ReflectionEngine } from '../../contracts/reflection-engine';
import { PlanValidator } from '../../contracts/plan-validator';
import { VerificationStrategyEngine } from '../../contracts/verification-strategy-engine';
import { PostExecutionPipeline } from '../../contracts/post-execution-pipeline';
import { ExecutionGovernor } from '../../contracts/execution-governor';
import { RuntimeHealthProvider } from '../../contracts/runtime-health-provider';
import { PipelineHooks } from '../../contracts/pipeline-hooks';
import { SessionManager } from '../session/session-manager';
import { WorkspaceMemory } from '../../contracts/workspace-memory';
import { ExecutionPlan } from '../../domain/execution-plan';
import * as crypto from 'crypto';
const randomUUID = crypto.randomUUID;
import * as process from 'process';
import { ExecutionLogger } from '../observability/execution-logger';
import { TaskExecutor } from '../execution/task-executor';
import { ToolDefinition } from '../../contracts/provider';
import { Role } from '../../contracts/role';
import { WorkspaceMemoryRepository } from '../../contracts/workspace-memory-repository';
import { RoleMemoryRepository } from '../../contracts/role-memory-repository';
import { MemoryContextBuilder } from '../../contracts/memory-context-builder';
import { StepExecutionEngine } from '../execution/step-execution-engine';
import { ExecutionContext } from '../../domain/execution-context';
import { ContextEngine } from '../../contracts/context';
import { ProjectDiscoveryService } from '../discovery/project-discovery-service';
import type { ProjectStructureService } from '../../contracts/project-structure-service';
// G.1: TaskIntake (Stage 1 — observation-only, does not control execution)
import { TaskIntake } from '../../contracts/task-intake';
// G.2: PreflightAnalyzer and EvidenceBuilder (Stage 2 — observation-only)
import { PreflightAnalyzer } from '../../contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../contracts/evidence-builder';
import { Evidence, EvidenceType } from '../../domain/pre-execution/evidence';
import { collectContractScopeFiles, createInspectionEvidence } from '../pre-execution/contract-builder';
import { selectTaskChangedFiles } from '../workspace/workspace-paths';
// G.3: ClarificationEngine (Stage 3 — blocking capability)
import { ClarificationEngine } from '../../contracts/clarification-engine';
import { RiskAssessment } from '../../domain/pre-execution/risk';
// G.4: DecisionAdvisor (Stage 4 — real risk assessment)
import { DecisionAdvisor } from '../../contracts/decision-advisor';
// G.5: ContractBuilder (Stage 5 — execution contract building)
import { ContractBuilder } from '../../contracts/contract-builder';
import { ExecutionContract } from '../../domain/pre-execution/contract';
// G.6: ExecutionGate + SafeExperiment (Stage 6 - enforcement)
import { ExecutionGate, GateCheckInput } from '../../contracts/execution-gate';
import { SafeExperiment } from '../../contracts/safe-experiment';
import { GateEvaluation } from '../../domain/pre-execution/gate';
import { Configuration } from '../../contracts/configuration';
import { ExecutionPlanner } from '../../contracts/execution-planner';
import { PlanningContext } from '../../domain/planning-context';
import { TaskDecomposer } from '../../contracts/task-decomposer';
import { MicroTaskGraph, DecompositionContext } from '../../domain/micro-task';
import type { IExecutionStateTracker } from '../../contracts/execution-state-tracker';
import { StateComparison } from '../../domain/execution/execution-state';
// R1: execution mode, workspace evidence, per-todo verification, V&V side effects
import { DEFAULT_EXECUTION_MODE, ExecutionMode, allowsGitMutation, resolveAuthoritativeExecutionMode } from '../../domain/execution-mode';
import {
  DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
  WorkspaceComparison,
  WorkspaceSnapshot,
  compareWorkspaceSnapshots,
  insufficientWorkspaceComparison,
} from '../../domain/execution/workspace-evidence';
import { WorkspaceSnapshotService } from '../execution/workspace-snapshot-service';
import { MutationLedger } from '../../domain/execution/mutation-safety';
import { TodoVerificationReport } from '../../domain/todo-verification';
import { buildTodoVerificationReport } from '../vv/todo-verification-builder';
import {
  VerificationSideEffect,
  VerificationSideEffectLedger,
  buildSideEffectLedger,
} from '../../domain/verification-side-effect';
import { QualityProfile, DEFAULT_QUALITY_PROFILE } from '../../domain/quality-profile';
import { ProductAnalysis, formatProductAnalysis, shouldAbortForProductCheckpoint } from '../../domain/product-analysis';
import { FailureContract, formatFailureContract } from '../../domain/failure-contract';
import { VerificationReport } from '../../domain/verification-report';
import { QualityPolicy } from '../../contracts/quality-policy';
import { ProductValidator } from '../../contracts/product-validator';
import { VerificationValidationAgent } from '../../contracts/vv-agent';
import { applyRepairScopeToPlan, buildCompactRepairObjective, collectEffectiveRepairScope, expandContractFilesInScope, uniqueSortedPaths } from '../vv/repair-scope';
import { saveIntentContract } from '../vv/intent-contract-store';
import { bindAcceptanceContract, evaluateAcceptanceContract, readScopedFiles, snapshotFromContents, toAcceptanceContract, allowedChangeFromFailure } from '../vv/acceptance-contract';
import { mergePreserveSnapshots } from '../../domain/acceptance-contract';
import { buildFailureContract } from '../vv/failure-contract-builder';
import { extractFilePaths } from '../vv/infer-source-files';
import { PlannerContextPreparationService } from '../../contracts/planner-context';
import { PlannerContext, formatPlannerContextSummary } from '../../domain/planner-context';
import { PlannerAllowedTargets, createPlannerAllowedTargets, sanitizeRejectedTargets } from '../../domain/planner-allowed-targets';
import { validateTodoPlanGrounding } from '../workspace/target-path-grounding';
import { PlannerOutputRejectedError } from '../../domain/errors/todo-plan-errors';
import { LocalWorkspace } from '../workspace/local-workspace';
import { InternalValidationRequest, createValidationOutcome } from '../../domain/internal-validation';
import { internalValidationRunner } from '../validation/internal-validation-runner';
import { parseInternalValidationCommand } from '../validation/internal-validation-parser';
import { StepResult } from '../../domain/execution-context';
import {
  RepairAttemptHistory,
  RepairContext,
  RepairSafetyState,
  TodoVerificationTrace,
  emptyRepairHistory,
  fingerprintRepairPlan,
  nextAttemptId,
} from '../../domain/repair-intelligence';
import { prioritizeFailures } from '../repair/failure-prioritizer';
import { enrichFailureContract } from '../repair/failure-contract-enrichment';
import { formatRepairAttemptHistory } from '../repair/repair-attempt-history';
import { buildRepairContext, formatRepairContext } from '../repair/repair-context';
import { WorkspaceContextReader } from '../planning/context-gathering/workspace-context-reader';
import { contextRefsFromPlannerContext } from '../repair/context-refs';
import { computeContextDelta } from '../../domain/repair/context-expansion';
import { RepairExpansionRecord } from '../../domain/repair/repair-expansion-record';
import { RepairTargetRecord } from '../../domain/repair/repair-target-record';
import { TodoPlan } from '../../domain/todo-plan';
import { RepairObjective } from '../../domain/repair/repair-objective';
import { buildRepairObjective, validateRepairPlan } from '../repair/repair-target-policy';
import { analyzeRepairOutcome, evaluateRepairCompletion } from '../repair/repair-outcome-analysis';
import { resolveRepairLimits } from '../repair/repair-limits';
import { isDuplicateRepairPlan } from '../repair/duplicate-repair-plan';
import { applyRepairPolicyToExecutionPlan } from '../repair/repair-todo-plan-policy';
import { mapVerificationToTodos } from '../repair/todo-verification-trace';
import { ConfirmationService } from '../../app/confirmation-service';
import { CorrelationContext } from '../../domain/correlation';

export class DefaultWorkflowOrchestrator implements WorkflowOrchestrator {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly workspaceMemory: WorkspaceMemory,
    private readonly taskPlanner: TaskPlanner,
    private readonly impactAnalyzer: ImpactAnalyzer,
    private readonly reviewer: Reviewer,
    private readonly safePatchExecutor: SafePatchExecutor,
    private readonly gitManager: GitManager,
    private readonly reflectionEngine: ReflectionEngine,
    private readonly planValidator: PlanValidator,
    private readonly verificationStrategyEngine: VerificationStrategyEngine,
    private readonly postExecutionPipeline?: PostExecutionPipeline,
    private readonly executionGovernor?: ExecutionGovernor,
    private readonly runtimeHealthProvider?: RuntimeHealthProvider,
    private readonly pipelineHooks?: PipelineHooks,
    private readonly taskExecutor?: TaskExecutor,
    private readonly toolDefinitions?: ReadonlyArray<ToolDefinition>,
    private readonly workspaceMemoryRepository?: WorkspaceMemoryRepository,
    private readonly roleMemoryRepository?: RoleMemoryRepository,
    private readonly memoryContextBuilder?: MemoryContextBuilder,
    private readonly stepExecutionEngine?: StepExecutionEngine,
    private readonly contextEngine?: ContextEngine,
    private readonly discoveryService?: ProjectDiscoveryService,
    private readonly config?: Configuration,
    private readonly executionPlanner?: ExecutionPlanner,
    private readonly taskDecomposer?: TaskDecomposer,
    private readonly executionStateTracker?: IExecutionStateTracker,
    private readonly workspacePath?: string,
    private readonly projectStructureService?: ProjectStructureService,
    // G.1: TaskIntake (Stage 1 — observation-only, backward compatible optional)
    private readonly taskIntake?: TaskIntake,
    // G.2: PreflightAnalyzer (Stage 2 — observation-only, backward compatible optional)
    private readonly preflightAnalyzer?: PreflightAnalyzer,
    // G.2: EvidenceBuilder (Stage 2 — observation-only, backward compatible optional)
    private readonly evidenceBuilder?: EvidenceBuilder,
    // G.3: ClarificationEngine (Stage 3 — blocking capability, backward compatible optional)
    private readonly clarificationEngine?: ClarificationEngine,
    // G.4: DecisionAdvisor (Stage 4 — real risk assessment, backward compatible optional)
    private readonly decisionAdvisor?: DecisionAdvisor,
    // G.5: ContractBuilder (Stage 5 — execution contract building, backward compatible optional)
    private readonly contractBuilder?: ContractBuilder,
    // G.6: ExecutionGate (Stage 6 - enforcement, backward compatible optional)
    private readonly executionGate?: ExecutionGate,
    // G.6: SafeExperiment (Stage 6 - safe experiment enforcement, backward compatible optional)
    private readonly safeExperiment?: SafeExperiment,
    private readonly qualityPolicy?: QualityPolicy,
    private readonly productValidator?: ProductValidator,
    private readonly vvAgent?: VerificationValidationAgent,
    // Milestone B1: planner context strategy (observation + planning request boundary)
    private readonly plannerContextPreparer?: PlannerContextPreparationService,
    private readonly regressionSelectorOverride?: RegressionSelector,
    // R5: ConfirmationService for human-in-the-loop decision boundary
    private readonly confirmationService?: ConfirmationService,
  ) {
    this.regressionSelector = regressionSelectorOverride ?? new DeterministicRegressionSelector();
  }

  private readonly regressionSelector: RegressionSelector;

  private readonly workspaceSnapshotService = new WorkspaceSnapshotService();

  async execute(options: WorkflowOptions): Promise<WorkflowResult> {
    let sessionId: string | null = null;
    let plan: ExecutionPlan | null = null;
    let executionContract: ExecutionContract | null = null;
    let impactReport: ImpactReport | null = null;
    let regressionPlan: RegressionPlan | null = null;
    let reviewReport = null;
    let patchResult = null;
    let reflection = null;
    let stateComparison: StateComparison | undefined;
    let abortedAt: string | undefined;
    let abortReason: string | undefined;
    let productAnalysis: ProductAnalysis | undefined;
    let acceptanceContract: import('../../domain/acceptance-contract').AcceptanceContract | undefined;
    let verificationReport: VerificationReport | undefined;
    let plannerContext: PlannerContext | undefined;
    let failureContract = options.failureContract;
    let stepResults: ReadonlyArray<StepResult> | undefined;
    let todoVerification: TodoVerificationTrace | undefined;
    let repairOutcome: RepairSafetyState | undefined;
    let repairContext: RepairContext | undefined;
    let repairExpansion: RepairExpansionRecord | undefined;
    // R4: the objective is built once the failure evidence is known and then
    // used to judge whatever the planner proposes.
    let repairObjective: RepairObjective | undefined;
    let repairTarget: RepairTargetRecord | undefined;
    const repairHistory: RepairAttemptHistory = options.repairAttemptHistory ?? emptyRepairHistory();
    const qualityProfile: QualityProfile = options.qualityProfile ?? this.qualityPolicy?.profile ?? DEFAULT_QUALITY_PROFILE;
    let preexistingDirtyFiles: string[] = [];
    const modeResolution = resolveAuthoritativeExecutionMode({
      executionMode: options.executionMode,
      task: options.task,
    });
    const executionMode: ExecutionMode = modeResolution.mode;
    let workspaceSnapshotBefore: WorkspaceSnapshot | undefined;
    let workspaceComparison: WorkspaceComparison | undefined;
    let mutationLedger: MutationLedger | undefined;
    let todoVerificationReport: TodoVerificationReport | undefined;
    let verificationSideEffects: VerificationSideEffectLedger | undefined;
    // Effects produced before the V&V agent runs (intent-contract persistence)
    // still belong in the run's ledger (R1.25).
    const preVerificationSideEffects: VerificationSideEffect[] = [];

    let correlationContext: CorrelationContext | undefined = options.correlationContext;

    try {
      // Step 1: Start Session
      sessionId = await this.sessionManager.startSession(options.task, null);
      correlationContext = options.correlationContext ?? {
        taskId: options.taskId ?? (sessionId ? `task-${sessionId}` : 'task-unknown'),
        runId: options.runId ?? (sessionId ?? 'run-unknown'),
        sessionId: options.sessionId ?? (sessionId ?? 'session-unknown'),
        attemptId: options.failureContract?.attemptId ?? (options.repairAttempt ? `attempt-${options.repairAttempt + 1}` : 'attempt-1'),
      };
      ExecutionLogger.setContext(correlationContext);
      ExecutionLogger.log('WORKFLOW', '-', options.modelId ?? '-', `Session started: ${sessionId}`, { task: options.task?.substring(0, 80) });
      if (!sessionId) {
        return this.createFailedResult(null, 'Failed to start session', null, null, null, null, null, 'workflow', 'Failed to start session', { correlationContext, runId: correlationContext.runId, taskId: correlationContext.taskId });
      }

      ExecutionLogger.log('EXECUTION_MODE', '-', '-', `Execution mode: ${executionMode}`, {
        executionMode,
        source: modeResolution.source,
        authoritative: true,
      });

      // Internal validation calls a validator directly. It must not reach the
      // planner, a provider, the executor, the reviewer, or verification.
      if (executionMode === 'INTERNAL_VALIDATION') {
        // An explicit API payload wins; otherwise the directive is parsed
        // deterministically out of the raw command text.
        let validationRequest: InternalValidationRequest | undefined = options.internalValidation;
        let parseError: string | undefined;
        if (!validationRequest) {
          const parsed = parseInternalValidationCommand(options.task);
          validationRequest = parsed.request;
          parseError = parsed.error;
        }

        const outcome = validationRequest
          ? internalValidationRunner.run(validationRequest)
          : createValidationOutcome({
            validator: '(unparsed)',
            status: 'ERROR',
            reasonCode: 'INVALID_VALIDATION_REQUEST',
            issues: [parseError ?? 'no internal validation request supplied'],
            message: parseError ?? 'INVALID_VALIDATION_REQUEST: no internal validation request supplied',
          });
        const message = outcome.message ?? `${outcome.validator}: ${outcome.result}`;
        ExecutionLogger.log('INTERNAL_VALIDATION', '-', '-', message, {
          validator: outcome.validator,
          status: outcome.status,
          reasonCode: outcome.reasonCode,
          rejectedTargets: outcome.rejectedTargets,
        });
        const accepted = outcome.status === 'ACCEPT';
        if (!accepted) {
          await this.sessionManager.failSession(sessionId, message);
        }
        return {
          sessionId,
          runId: correlationContext.runId,
          taskId: correlationContext.taskId,
          correlationContext,
          success: accepted,
          plan: null,
          impactReport: null,
          reviewReport: null,
          patchResult: null,
          reflection: null,
          executionMode,
          internalValidation: outcome,
          touchedFiles: [],
          abortedAt: accepted ? undefined : 'internal-validation',
          abortReason: accepted ? undefined : message,
        };
      }

      try {
        const baselineStatus = await this.gitManager.status();
        preexistingDirtyFiles = [...(baselineStatus.changedFiles ?? [])];
      } catch {
        preexistingDirtyFiles = [];
      }

      if (failureContract) {
        const limits = resolveRepairLimits(this.qualityPolicy);
        // R3.5: expansion may only consider files that exist. The context
        // reader also refuses paths outside the workspace, so a candidate can
        // never point the planner at something the run has no business reading.
        const probe = this.workspacePath
          ? new WorkspaceContextReader(this.workspacePath)
          : undefined;
        repairContext = buildRepairContext({
          originalTask: options.task,
          failureContract,
          failedTodoId: failureContract.failedTodoId,
          failedStepId: failureContract.failedStepId,
          history: repairHistory,
          expansionLevel: options.repairExpansionLevel ?? 0,
          limits,
          previouslyTouchedFiles: options.previouslyTouchedFiles,
          impactAnalysis: options.repairImpactAnalysis,
          mutationLedger: options.repairMutationLedger,
          previousContext: options.repairPreviousContext,
          duplicatePlan: options.repairDuplicatePlan,
          previousExpansionYieldedEvidence: options.repairPreviousExpansionYieldedEvidence,
          fileExists: probe ? (file: string) => safeProbe(() => probe.exists(file), false) : undefined,
          fingerprintOf: probe
            ? (file: string) => safeProbe(() => probe.stat(file).fingerprint, undefined)
            : undefined,
        });
        const prioritized = prioritizeFailures(
          failureContract.failedChecks,
          failureContract.acceptanceCriteria,
        );
        ExecutionLogger.log(
          'FAILURE_PRIORITIZATION',
          'repair',
          '-',
          prioritized.map(item => `${item.order}:${item.classification}:${item.check.id}:rank=${item.rank}`).join(' | ') || '(none)',
          {
            attemptId: failureContract.attemptId,
            failedTodoId: failureContract.failedTodoId,
            failureIds: prioritized.map(item => item.check.id),
            classifications: prioritized.map(item => item.classification),
          },
        );
        ExecutionLogger.log(
          'REPAIR_CONTEXT',
          'repair',
          '-',
          formatRepairContext(repairContext),
          {
            attemptId: failureContract.attemptId,
            failedTodoId: repairContext.failedTodoId,
            expansionLevel: repairContext.expansionLevel,
            candidateFiles: repairContext.candidateFiles,
            safety: repairContext.safety,
          },
        );
        // R3.28: the expansion decision is separate evidence from the context
        // itself, and it must be readable even when the answer was "no".
        ExecutionLogger.log(
          'REPAIR_CONTEXT_EXPANSION',
          'repair',
          '-',
          `${repairContext.expansionDecision ?? 'UNKNOWN'}: ${repairContext.expansionReason ?? '-'}`,
          {
            attemptId: failureContract.attemptId,
            expansionLevel: repairContext.expansionLevel,
            decision: repairContext.expansionDecision,
            stopCode: repairContext.expansionStopCode,
            candidateFiles: (repairContext.candidates ?? []).map(
              item => `${item.path}[${item.source}/rank=${item.rank}/${item.exists ? 'found' : 'NOT_FOUND'}]`,
            ),
            selectedFiles: repairContext.expandedFiles,
            rejected: (repairContext.rejectedCandidates ?? []).map(
              item => `${item.path}:${item.rejection}`,
            ),
            missingEvidence: (repairContext.missingEvidence ?? []).map(
              item => `${item.kind}:${item.reference}:${item.resolved ? 'resolved' : 'NOT_FOUND'}`,
            ),
          },
        );
        if (repairContext.safety !== 'PROCEED') {
          abortReason = repairContext.safety === 'REPAIR_LIMIT_REACHED'
            ? 'REPAIR_LIMIT_REACHED'
            : repairContext.safety;
          abortedAt = 'repair';
          repairOutcome = repairContext.safety;
          await this.sessionManager.failSession(sessionId, abortReason);
          return this.createFailedResult(
            sessionId, abortReason, null, null, null, null, null, abortedAt, abortReason,
            { qualityProfile, failureContract, plannerContext, repairOutcome, repairAttemptHistory: repairHistory },
          );
        }
      }

      // Record configuration snapshot for traceability
      if (options.configurationSnapshot) {
        await this.sessionManager.recordEvent(sessionId, 'SESSION_CREATED', 'Configuration snapshot recorded', {
          configurationSnapshot: options.configurationSnapshot
        });
      }

      // ============================================================
      // G.1 Stage 1: TaskIntake (OBSERVATION-ONLY)
      // Normalize raw prompt into structured TaskIntent.
      // Does NOT control execution, does NOT block, does NOT change planner.
      // ============================================================
      let intakeResult: any = null;
      if (this.taskIntake) {
        try {
          intakeResult = await this.taskIntake.normalize({
            rawPrompt: options.task,
          });

          const intent = intakeResult.intent;
          const metadata = {
            intentId: intent.id,
            intentType: intent.type,
            taskMode: intent.mode,
            objective: intent.objective,
            initialScope: intent.initialScope,
            informationCount: intent.information.length,
            ambiguityCount: intakeResult.ambiguities.length,
            criticalMissingInfoCount: intakeResult.criticalMissingInfo.length,
            readinessScore: intakeResult.readinessScore,
            ambiguities: intakeResult.ambiguities,
            criticalMissingInfo: intakeResult.criticalMissingInfo,
            normalizedAt: intent.normalizedAt,
          };

          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `TaskIntake: type=${intent.type}, mode=${intent.mode}, readiness=${intakeResult.readinessScore}`,
            metadata,
          );

          if (this.sessionManager && sessionId) {
            await this.sessionManager.recordEvent(
              sessionId,
              'INTENT_NORMALIZED',
              `Intent normalized: type=${intent.type}, mode=${intent.mode}, readiness=${intakeResult.readinessScore}`,
              metadata as any,
            );
          }
        } catch (intakeError: any) {
          // TaskIntake failure is NON-FATAL in Stage 1.
          // Log and continue with existing execution flow.
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `TaskIntake failed (non-fatal): ${intakeError?.message || String(intakeError)}`,
            { error: intakeError?.message },
          );
        }
      }


          // ============================================================
          // G.2 Stage 2: PreflightAnalyzer (OBSERVATION-ONLY)
          // Analyze project context: framework, package manager, structure.
          // Does NOT control execution, does NOT block.
          // ============================================================
          let preflightResult: any = null;
          if (this.preflightAnalyzer && intakeResult) {
            try {
              preflightResult = await this.preflightAnalyzer.analyze(intakeResult.intent);

              const preflightMetadata = {
                intentId: intakeResult.intent.id,
                framework: preflightResult.inspection.framework,
                runtime: preflightResult.inspection.runtime,
                packageManager: preflightResult.inspection.packageManager,
                hasTypeScript: preflightResult.inspection.hasTypeScript,
                hasTests: preflightResult.inspection.hasTests,
                hasESLint: preflightResult.inspection.hasESLint,
                hasPrettier: preflightResult.inspection.hasPrettier,
                structure: preflightResult.inspection.structure,
                dependenciesCount: preflightResult.inspection.dependencies.length,
                feasible: preflightResult.feasibility.feasible,
                missingRequirements: preflightResult.feasibility.missingRequirements,
                blockers: preflightResult.feasibility.blockers,
                warnings: preflightResult.warnings,
                recommendations: preflightResult.recommendations,
                inspectedAt: preflightResult.inspection.inspectedAt,
              };

              const detectedFws = (preflightResult.inspection.detectedFrameworks && preflightResult.inspection.detectedFrameworks.length > 0)
                ? preflightResult.inspection.detectedFrameworks.join(',')
                : preflightResult.inspection.framework;

              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `PreflightAnalyzer: framework=${preflightResult.inspection.framework}, frameworks=${detectedFws}, packageManager=${preflightResult.inspection.packageManager}, feasible=${preflightResult.feasibility.feasible}`,
                preflightMetadata,
              );

              if (this.sessionManager && sessionId) {
                await this.sessionManager.recordEvent(
                  sessionId,
                  'PREFLIGHT_COMPLETED',
                  `Preflight: framework=${preflightResult.inspection.framework}, frameworks=${detectedFws}, packageManager=${preflightResult.inspection.packageManager}, feasible=${preflightResult.feasibility.feasible}`,
                  preflightMetadata as any,
                );
              }
            } catch (preflightError: any) {
              // PreflightAnalyzer failure is NON-FATAL in Stage 2.
              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `PreflightAnalyzer failed (non-fatal): ${preflightError?.message || String(preflightError)}`,
                { error: preflightError?.message },
              );
            }
          }

          // ============================================================
          // G.2 Stage 2: EvidenceBuilder (OBSERVATION-ONLY)
          // Collect evidence for files in scope.
          // Does NOT enforce NO_EVIDENCE_NO_MUTATION yet.
          // ============================================================
          let evidenceResult: any = null;
          if (this.evidenceBuilder && intakeResult && intakeResult.intent.initialScope.length > 0) {
            try {
              const evidenceRequest = {
                evidenceTypes: ['FILE_EXISTS', 'FILE_CONTENT'] as ReadonlyArray<EvidenceType>,
                targets: intakeResult.intent.initialScope,
              };

              evidenceResult = await this.evidenceBuilder.collect(evidenceRequest);

              const confirmedCount = evidenceResult.evidence.filter((e: any) => e.status === 'CONFIRMED').length;
              const notFoundCount = evidenceResult.evidence.filter((e: any) => e.status === 'NOT_FOUND').length;
              const errorCount = evidenceResult.evidence.filter((e: any) => e.status === 'ERROR').length;

              const evidenceMetadata = {
                intentId: intakeResult.intent.id,
                evidenceCount: evidenceResult.evidence.length,
                confirmedCount,
                notFoundCount,
                errorCount,
                evidenceTypes: ['FILE_EXISTS', 'FILE_CONTENT'],
                targets: intakeResult.intent.initialScope,
              };

              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `EvidenceBuilder: collected=${evidenceResult.evidence.length}, confirmed=${confirmedCount}, notFound=${notFoundCount}`,
                evidenceMetadata,
              );

              if (this.sessionManager && sessionId) {
                await this.sessionManager.recordEvent(
                  sessionId,
                  'EVIDENCE_COLLECTED',
                  `Evidence: collected=${evidenceResult.evidence.length}, confirmed=${confirmedCount}, notFound=${notFoundCount}`,
                  evidenceMetadata as any,
                );
              }

              // Only an explicitly requested target may block here. Scope inferred
              // from task wording is a hint, and missing hints stay non-fatal.
              const explicitlyRequested = (options.targetFiles ?? []).length > 0;
              if (explicitlyRequested && intakeResult.intent.initialScope.length === 1 && !intakeResult.intent.initialScope[0].includes('*') && confirmedCount === 0 && notFoundCount > 0) {
                const missingTarget = intakeResult.intent.initialScope[0];
                abortedAt = 'evidence-collection';
                abortReason = `TARGET_NOT_FOUND: The requested file "${missingTarget}" was not found in the active workspace.`;
                ExecutionLogger.log('PRE_EXECUTION', '-', '-', abortReason, {
                  reasonCode: 'TARGET_NOT_FOUND',
                  missingTarget,
                });
                if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
                reflection = await this.generateReflectionSafely(sessionId);
                return this.createFailedResult(
                  sessionId,
                  abortReason,
                  null,
                  null,
                  null,
                  null,
                  reflection,
                  abortedAt,
                  abortReason,
                  { executionMode },
                );
              }
            } catch (evidenceError: any) {
              // EvidenceBuilder failure is NON-FATAL in Stage 2.
              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `EvidenceBuilder failed (non-fatal): ${evidenceError?.message || String(evidenceError)}`,
                { error: evidenceError?.message },
              );
            }
          }

          // ============================================================
          // G.4 Stage 4: DecisionAdvisor (REAL RISK ASSESSMENT)
          // Assess risk based on TaskIntent + ProjectInspection.
          // Replaces Stage 3 minimal risk with real deterministic assessment.
          // ============================================================
          let riskAssessment: RiskAssessment | null = null;
          if (this.decisionAdvisor && intakeResult && preflightResult) {
            try {
              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `DecisionAdvisor: assessing risk for intent=${intakeResult.intent.id}`,
                { intentId: intakeResult.intent.id },
              );

              riskAssessment = await this.decisionAdvisor.assessRisk(
                intakeResult.intent,
                preflightResult.inspection,
              );

              const riskMetadata = {
                intentId: intakeResult.intent.id,
                level: riskAssessment.level,
                explanation: riskAssessment.explanation,
                factors: riskAssessment.factors,
                reversible: riskAssessment.reversible,
                estimatedFilesAffected: riskAssessment.estimatedFilesAffected,
                requiresConfirmation: riskAssessment.requiresConfirmation,
                safeExperimentRecommended: riskAssessment.safeExperimentRecommended,
              };

              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `DecisionAdvisor: level=${riskAssessment.level}, requiresConfirmation=${riskAssessment.requiresConfirmation}, safeExperimentRecommended=${riskAssessment.safeExperimentRecommended}`,
                riskMetadata,
              );

              if (this.sessionManager && sessionId) {
                await this.sessionManager.recordEvent(
                  sessionId,
                  'RISK_ASSESSED',
                  `Risk assessed: level=${riskAssessment.level}, requiresConfirmation=${riskAssessment.requiresConfirmation}`,
                  riskMetadata as any,
                );
              }
            } catch (riskError: any) {
              // DecisionAdvisor failure is NON-FATAL but EXPLICIT.
              // Do NOT convert to LOW risk.
              // Log and mark as null (unknown risk).
              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `DecisionAdvisor failed (non-fatal, risk unknown): ${riskError?.message || String(riskError)}`,
                { error: riskError?.message },
              );
              riskAssessment = null;
            }
          }



          // ============================================================
          // G.3 Stage 3: ClarificationEngine (BLOCKING CAPABILITY)
          // Generate clarification questions for plan-changing ambiguities.
          // If blocking questions exist, DO NOT proceed to TaskPlanner.
          // Uses REAL risk assessment from DecisionAdvisor (Stage 4).
          // ============================================================
          let clarificationResult: any = null;
          let requiresClarification = false;
          if (this.clarificationEngine && intakeResult) {
            try {
              // Use real risk assessment from DecisionAdvisor
              // If risk assessment failed, use conservative MEDIUM (not LOW)
              const riskForClarification: RiskAssessment = riskAssessment || Object.freeze({
                level: 'MEDIUM' as const,
                explanation: 'Risk assessment failed, using conservative default',
                factors: ['DecisionAdvisor failed - risk unknown'],
                reversible: false,
                estimatedFilesAffected: intakeResult.intent.initialScope.length,
                requiresConfirmation: true,
                safeExperimentRecommended: true,
              });

              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `ClarificationEngine: analyzing for blocking questions with risk=${riskForClarification.level}`,
                { 
                  intentId: intakeResult.intent.id,
                  riskLevel: riskForClarification.level,
                  riskFactors: riskForClarification.factors,
                },
              );

              if (this.sessionManager && sessionId) {
                await this.sessionManager.recordEvent(
                  sessionId,
                  'CLARIFICATION_STARTED',
                  'Clarification analysis started',
                  { 
                    intentId: intakeResult.intent.id,
                    riskLevel: riskForClarification.level,
                  },
                );
              }

              clarificationResult = await this.clarificationEngine.generateQuestions(
                intakeResult.intent,
                riskForClarification,
                intakeResult.ambiguities,
              );

              const blockingCount = clarificationResult.requiredQuestions.length;
              const optionalCount = clarificationResult.optionalQuestions.length;
              const totalCount = clarificationResult.questions.length;

              const clarificationMetadata = {
                intentId: intakeResult.intent.id,
                totalQuestions: totalCount,
                blockingQuestions: blockingCount,
                optionalQuestions: optionalCount,
                hasBlockingQuestions: clarificationResult.hasBlockingQuestions,
                questionIds: clarificationResult.questions.map((q: any) => q.id),
                riskLevel: riskForClarification.level,
                requiresConfirmation: riskForClarification.requiresConfirmation,
              };

              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `ClarificationEngine: total=${totalCount}, blocking=${blockingCount}, optional=${optionalCount}, risk=${riskForClarification.level}`,
                clarificationMetadata,
              );

              if (this.sessionManager && sessionId) {
                await this.sessionManager.recordEvent(
                  sessionId,
                  clarificationResult.hasBlockingQuestions ? 'CLARIFICATION_REQUIRED' : 'CLARIFICATION_COMPLETED',
                  clarificationResult.hasBlockingQuestions
                    ? `Blocking clarification required: ${blockingCount} question(s)`
                    : `Clarification completed: ${totalCount} question(s), none blocking`,
                  clarificationMetadata as any,
                );
              }

              // If blocking questions exist, DO NOT proceed to TaskPlanner
              // PRODUCTION defers ordinary clarification into the single product checkpoint.
              if (clarificationResult.hasBlockingQuestions && qualityProfile !== 'PRODUCTION') {
                requiresClarification = true;
                ExecutionLogger.log(
                  'PRE_EXECUTION',
                  '-',
                  '-',
                  `BLOCKING: ${blockingCount} clarification question(s) must be answered before planning`,
                  {
                    blockingQuestions: clarificationResult.requiredQuestions.map((q: any) => ({
                      id: q.id,
                      question: q.question,
                      reason: q.reason,
                      affects: q.affects,
                    })),
                  },
                );

                // Return early with failure status
                return {
                  sessionId: sessionId || '',
                  success: false,
                  plan: null,
                  impactReport: null,
                  reviewReport: null,
                  patchResult: null,
                  reflection: null,
                  abortedAt: new Date().toISOString(),
                  abortReason: `Requires clarification: ${blockingCount} blocking question(s) must be answered`,
                };
              }
            } catch (clarificationError: any) {
              // ClarificationEngine failure is NON-FATAL in Stage 3.
              // Log and continue (do not block execution due to clarification failure).
              ExecutionLogger.log(
                'PRE_EXECUTION',
                '-',
                '-',
                `ClarificationEngine failed (non-fatal): ${clarificationError?.message || String(clarificationError)}`,
                { error: clarificationError?.message },
              );
            }
          }

      // Step 2: Load Context (ContextEngine + Memory)
      let memoryContext = options.memoryContext || '';
      try {
        // 2a. Use ContextEngine if available (full pipeline: discover → select → limit → build → freeze)
        if (this.contextEngine && this.discoveryService) {
          // Ensure configuration is loaded before discovery
          if (this.config) {
            try {
              const cfgAny = this.config as any;
              const cfgExists = cfgAny.exists ? await cfgAny.exists() : false;
              if (cfgExists) {
                await this.config.load();
              } else if (cfgAny.initialize) {
                await cfgAny.initialize();
                ExecutionLogger.log('CONTEXT', '-', '-', 'Initialized default config.json');
              }
            } catch (cfgErr: any) {
              console.warn('[Workflow] Config init failed (non-fatal): ' + cfgErr.message);
            }
          }
          const snapshot = await this.discoveryService.discover();
          const contextObject = await this.contextEngine.buildContext({
            task: options.task,
            snapshot,
          });

          const parts: string[] = [];
          if (contextObject.rules.length > 0) {
            parts.push('RULES:\n' + contextObject.rules.map(r => `- [${r.id}] ${r.content}`).join('\n'));
            ExecutionLogger.log('CONTEXT', '-', '-', `Rules loaded: ${contextObject.rules.length}`);
          }
          if (contextObject.knowledge.length > 0) {
            parts.push('KNOWLEDGE:\n' + contextObject.knowledge.map(k => `- ${k.content?.substring(0, 200) ?? ''}`).join('\n'));
            ExecutionLogger.log('CONTEXT', '-', '-', `Knowledge loaded: ${contextObject.knowledge.length}`);
          }
          if (contextObject.memories.length > 0) {
            parts.push('MEMORIES:\n' + contextObject.memories.map(m => `- [${m.scope}] ${m.key}: ${String(m.value ?? '')}`).join('\n'));
            ExecutionLogger.log('CONTEXT', '-', '-', `Memories loaded: ${contextObject.memories.length}`);
          }
          if (contextObject.roleMemory) {
            parts.push('ROLE MEMORY:\n' + contextObject.roleMemory);
          }
          if (parts.length > 0) {
            memoryContext = memoryContext ? memoryContext + '\n\n' + parts.join('\n\n') : parts.join('\n\n');
          }
        }

        // 2b. Fallback: load knowledge directly if ContextEngine not available
        if (!this.contextEngine) {
          const knowledge = await this.workspaceMemory.load();
          if (!knowledge.isEmpty && this.memoryContextBuilder) {
            const knowledgeText = this.memoryContextBuilder.build(knowledge);
            if (knowledgeText) {
              memoryContext = memoryContext ? memoryContext + '\n\n' + knowledgeText : knowledgeText;
              ExecutionLogger.log('MEMORY', '-', '-', 'Project knowledge loaded into context (fallback)');
            }
          }
        }

        // 2c. Load shared memory (always — not covered by ContextEngine)
        if (this.workspaceMemoryRepository) {
          const sharedEntries = await this.workspaceMemoryRepository.load();
          if (sharedEntries.length > 0) {
            const sharedText = 'SHARED MEMORY:\n' + sharedEntries.map(e => `- [${e.category}] ${e.content}`).join('\n');
            memoryContext = memoryContext ? memoryContext + '\n\n' + sharedText : sharedText;
            ExecutionLogger.log('MEMORY', '-', '-', `Shared memory loaded: ${sharedEntries.length} entries`);
          }
        }

        // 2d. Load role memory (always — not covered by ContextEngine)
        if (this.roleMemoryRepository) {
          const roleEntries = await this.roleMemoryRepository.load('coder');
          if (roleEntries.length > 0) {
            const roleText = 'ROLE MEMORY (coder):\n' + roleEntries.map(e => `- [${e.category}] ${e.content}`).join('\n');
            memoryContext = memoryContext ? memoryContext + '\n\n' + roleText : roleText;
            ExecutionLogger.log('MEMORY', '-', '-', `Role memory loaded: ${roleEntries.length} entries`);
          }
        }
      } catch (error: any) {
        console.warn(`[Workflow] Context loading failed: ${error.message}`);
      }

      // Step 2.5: Before Plan Hook (R4.14)
      if (this.pipelineHooks?.beforePlan) {
        try { await this.pipelineHooks.beforePlan(options.task); } catch (e: any) { console.warn(`[Workflow] beforePlan hook failed: ${e.message}`); }
      }

      // Pre-planning product validation (V&V). Does not write production code.
      if (this.productValidator && this.qualityPolicy?.requiresPrePlanningValidation && !options.skipVv) {
        try {
          productAnalysis = await this.productValidator.analyze({
            task: options.task,
            qualityProfile,
            workspacePath: this.workspacePath,
            intakeAmbiguities: intakeResult?.ambiguities,
            clarificationQuestions: clarificationResult?.requiredQuestions?.map((q: any) => q.question) ?? clarificationResult?.questions?.map((q: any) => q.question),
            riskLevel: riskAssessment?.level,
          });
          ExecutionLogger.log('PRE_EXECUTION', '-', '-', 'Product validation completed', {
            blocking: productAnalysis.blockingQuestions.length,
            assumptions: productAnalysis.assumptions.length,
            profile: qualityProfile,
            goal: productAnalysis.intent?.userGoal,
          });
          const intentContractEffect = await saveIntentContract(
            this.workspacePath,
            productAnalysis,
            executionMode === 'READ_ONLY' ? 'READ_ONLY' : 'CONTROLLED_MUTATION',
          );
          if (intentContractEffect) preVerificationSideEffects.push(intentContractEffect);
          acceptanceContract = toAcceptanceContract(productAnalysis, options.task);
          if (failureContract && acceptanceContract && this.workspacePath) {
            const scope = collectEffectiveRepairScope({
              originalTask: options.task,
              failureContract,
              previousAttemptFiles: options.previouslyTouchedFiles,
            });
            const contents = await readScopedFiles(
              this.workspacePath,
              scope.length ? scope : extractFilePaths(options.task),
            );
            const snap = snapshotFromContents(contents, acceptanceContract);
            acceptanceContract = Object.freeze({
              ...acceptanceContract,
              preserve: mergePreserveSnapshots(acceptanceContract.preserve, snap),
            });
          }
          if (shouldAbortForProductCheckpoint(productAnalysis, !!failureContract)) {
            abortReason = 'Requires one human checkpoint: ' + productAnalysis.blockingQuestions.join(' | ');
            abortedAt = 'product-validation';
            if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
            return this.createFailedResult(sessionId, abortReason, null, null, null, null, null, abortedAt, abortReason, { qualityProfile, productAnalysis });
          }
          const analysisText = formatProductAnalysis(productAnalysis);
          memoryContext = memoryContext ? memoryContext + '\n\n' + analysisText : analysisText;
        } catch (error: any) {
          console.warn('[Workflow] Product validation failed (non-fatal): ' + (error && error.message));
        }
      }
      // Step 2.5: Planner Context Strategy + Targeted Gathering (Milestone B2)
      if (this.plannerContextPreparer && this.workspacePath) {
        try {
          plannerContext = await this.plannerContextPreparer.prepare({
            userTask: options.task,
            workspaceRoot: this.workspacePath,
            executionDirective: options.executionDirective,
            productQa: productAnalysis,
            failureContract,
            repairCandidateFiles: repairContext?.candidateFiles ?? options.repairCandidateFiles,
            repairExpansionLevel: repairContext?.expansionLevel ?? options.repairExpansionLevel,
          });
          // R3.9/R3.10: the delta is only knowable once the context has been
          // gathered, so it is measured here against what the previous attempt
          // actually held, not against what this one hoped to add.
          if (repairContext) {
            const nextRefs = contextRefsFromPlannerContext(plannerContext);
            const delta = computeContextDelta(options.repairPreviousContext ?? [], nextRefs);
            repairExpansion = Object.freeze({
              attemptId: failureContract?.attemptId ?? `attempt-${(options.repairAttempt ?? 0) + 1}`,
              attemptNumber: (options.repairAttempt ?? 0) + 1,
              expansionLevel: repairContext.expansionLevel,
              decision: repairContext.expansionDecision ?? 'REPAIR_WITH_EXISTING_CONTEXT',
              reason: repairContext.expansionReason ?? '',
              stopCode: repairContext.expansionStopCode,
              missingEvidence: repairContext.missingEvidence ?? [],
              candidates: repairContext.candidates ?? [],
              rejected: repairContext.rejectedCandidates ?? [],
              selectedFiles: repairContext.expandedFiles ?? [],
              previousContextFingerprint: delta.previousFingerprint,
              contextFingerprint: delta.nextFingerprint,
              contextDelta: delta,
              duplicatePlan: options.repairDuplicatePlan === true,
            });
            ExecutionLogger.log(
              'REPAIR_CONTEXT_DELTA',
              'repair',
              '-',
              `${delta.previousFingerprint} -> ${delta.nextFingerprint}`
              + ` new=${delta.newFiles.length} changed=${delta.changedFiles.length}`
              + ` unchanged=${delta.unchangedFiles.length}`
              + ` newEvidence=${delta.hasNewEvidence ? 'yes' : 'no'}`,
              {
                attemptId: repairExpansion.attemptId,
                expansionLevel: repairExpansion.expansionLevel,
                newFiles: delta.newFiles,
                changedFiles: delta.changedFiles,
                hasNewEvidence: delta.hasNewEvidence,
              },
            );
          }
          ExecutionLogger.log(
            'CONTEXT_STRATEGY',
            'planner-context',
            '-',
            formatPlannerContextSummary(plannerContext),
            {
              repairMode: plannerContext.repairMode,
              skills: plannerContext.resolvedSkills.skills.map(skill => skill.id),
              selected: plannerContext.strategy.selectedSources,
              excluded: plannerContext.strategy.excludedSources,
              deferred: plannerContext.strategy.deferredSources,
              missingRequired: plannerContext.strategy.missingRequired,
              workspaceRoot: plannerContext.gathered.workspaceRoot,
              gatheredFiles: plannerContext.gathered.fileCount,
              gatheredBytes: plannerContext.gathered.totalBytes,
              limitReached: plannerContext.gathered.limitReached,
              gathered: plannerContext.gathered.records.map(record => ({
                source: record.source,
                reference: record.reference,
                status: record.status,
                reason: record.reason,
                priority: record.priority,
                sizeBytes: record.sizeBytes,
                truncated: record.truncated,
                collectionMethod: record.collectionMethod,
                error: record.error,
              })),
            },
          );
          if (plannerContext.versionIntelligence) {
            const vi = plannerContext.versionIntelligence;
            ExecutionLogger.log(
              'VERSION_CONTEXT',
              'version-intelligence',
              '-',
              vi.summary,
              {
                dependenciesCount: vi.dependencies.length,
                effectiveKnowledgeCount: vi.effectiveKnowledge.length,
                staleCount: vi.staleItems.length,
                conflictCount: vi.conflicts.length,
                effectiveKnowledge: vi.effectiveKnowledge.map(ek => ({
                  technology: ek.technology,
                  version: ek.normalizedVersion,
                  status: ek.status,
                  source: ek.effectiveSource,
                  overridePath: ek.overridePath,
                  staleReason: ek.staleReason,
                  conflictReason: ek.conflictReason,
                })),
                staleItems: vi.staleItems.map(s => ({
                  technology: s.technology,
                  installed: s.installedVersion,
                  target: s.declaredApplicableVersion,
                  overridePath: s.overridePath,
                  reason: s.reason,
                })),
                conflicts: vi.conflicts.map(c => ({
                  technology: c.technology,
                  version: c.resolvedVersion,
                  globalKnowledgeId: c.globalKnowledgeId,
                  overridePath: c.overridePath,
                  resolution: c.resolution,
                })),
              },
            );
          }
        } catch (error: any) {
          console.warn('[Workflow] Planner context strategy failed (non-fatal): ' + (error && error.message));
        }
      }
      // Step 3: Task Planning
      ExecutionLogger.log('WORKFLOW', 'planner', options.modelId ?? '-', 'Starting task planning');
      try {
        const planningTask = failureContract
          ? '[REPAIR] Verification rejected the product. This is not a continuation of the original task. '
            + 'The original task may already be implemented; that is not acceptance. '
            + 'Repair the failure contract. Original scope does not limit which files may be repaired.\n\n'
            + formatFailureContract(failureContract)
            + '\n\n' + formatRepairAttemptHistory(repairHistory)
            + (repairContext ? '\n\n' + formatRepairContext(repairContext) : '')
            + '\n\nOriginal task (context only):\n' + options.task
          : options.task;
        // Files implicated by a failure contract are observed verification evidence,
        // so a repair plan is allowed to target them.
        const implicatedFiles = failureContract ? extractFilePaths(formatFailureContract(failureContract)) : [];
        const plannerAllowedTargets = this.evidenceBuilder?.generateAllowedTargets?.(evidenceResult?.evidence, plannerContext)
          ?? createPlannerAllowedTargets({
            evidence: evidenceResult?.evidence,
            plannerContext,
            verifiedFiles: implicatedFiles,
          });

        plan = await this.taskPlanner.plan({
          task: planningTask,
          availableTools: options.availableTools || (this.toolDefinitions ? this.toolDefinitions.map(t => t.name) : []),
          memoryContext,
          providerId: options.plannerProviderId ?? options.providerId,
          model: options.plannerModelId ?? options.modelId,
          productAnalysis: productAnalysis ? formatProductAnalysis(productAnalysis) : undefined,
          verificationRequirements: productAnalysis ? productAnalysis.verificationRequirements.join('\n') : undefined,
          failureContract: failureContract ? formatFailureContract(failureContract) : undefined,
          acceptanceContract,
          plannerContext,
          plannerAllowedTargets,
          executionMode,
        });
        // Step 3.1: ExecutionPlanner fallback (deterministic, no LLM).
        // When PlannerContext is present, a validated TodoPlan is required.
        // Do not silently replace a failed LLM planner with a non-Todo plan.
        if (!plan && this.executionPlanner) {
          if (plannerContext) {
            ExecutionLogger.log(
              'PLANNING',
              'execution-planner',
              '-',
              'Fallback skipped: PlannerContext requires a validated TodoPlan',
            );
          } else {
          try {
            const planningContext: PlanningContext = {
              objective: failureContract
                ? buildCompactRepairObjective({
                    originalTask: options.task,
                    failureContract,
                    previousAttemptFiles: options.previouslyTouchedFiles,
                  })
                : planningTask,
              availableTools: options.availableTools || (this.toolDefinitions ? this.toolDefinitions.map(t => t.name) : []),
              maxSteps: failureContract ? 1 : 10,
              memoryContext: memoryContext || undefined,
              acceptanceContract,
            };
            plan = this.executionPlanner.createPlan(planningContext);
            if (plan) {
              ExecutionLogger.log('PLANNING', 'execution-planner', '-', `Fallback plan: ${plan.steps.length} steps (deterministic)`);
            }
          } catch (e: any) {
            console.warn('[Workflow] ExecutionPlanner fallback failed: ' + e.message);
          }
          }
        }

        if (plan && acceptanceContract) {
          plan = bindAcceptanceContract(plan, acceptanceContract);
        }
        if (plan && failureContract) {
          plan = this.unionRepairFiles(plan, failureContract, options.task, options.previouslyTouchedFiles);
          const limits = resolveRepairLimits(this.qualityPolicy);
          const allowedFiles = repairContext?.candidateFiles
            ?? failureContract.implicatedFiles
            ?? [];
          plan = applyRepairPolicyToExecutionPlan({
            plan,
            failedTodoId: failureContract.failedTodoId,
            allowedFiles: allowedFiles.length > 0 ? allowedFiles : (plan.todoPlan?.affectedFiles ?? []),
            maxRepairFiles: limits.maxRepairFiles,
          });
          // R4.4: assemble the objective from the original run, not from the
          // failure. `options.task` is the user's original wording; the failed
          // plan and acceptance criteria are carried forward by the agent
          // orchestrator so that a later attempt cannot substitute easier ones.
          repairObjective = buildRepairObjective({
            originalTask: options.task,
            acceptanceCriteria:
              options.originalAcceptanceCriteria
              ?? productAnalysis?.acceptanceCriteria
              ?? failureContract.acceptanceCriteria,
            originalTodoPlan: options.originalTodoPlan,
            failedTodoId: failureContract.failedTodoId,
            primaryFailure:
              failureContract.primaryFailure?.check.name ?? failureContract.summary,
            primaryFailureCheckId: failureContract.primaryFailure?.check.id,
            expandedFiles: repairContext?.expandedFiles,
            missingExpectedChanges: options.repairMissingExpectedChanges,
            unintendedChangedFiles: options.repairUnintendedChangedFiles,
            mutationTargets: (options.repairMutationLedger?.results ?? []).map(r => r.path),
            implicatedFiles: failureContract.implicatedFiles,
            requiredObservables: [
              ...(acceptanceContract?.requiredTestIds ?? []),
              ...(acceptanceContract?.requiredExactTexts ?? []),
            ],
          });
          ExecutionLogger.log(
            'REPAIR_TARGET_ANALYSIS',
            'repair',
            '-',
            `intent=${repairObjective.intent} (${repairObjective.intentConfidence})`
            + ` todo=${repairObjective.originalTodoId ?? '(unknown)'}`
            + ` allowedOps=${repairObjective.allowedOperations.join('/')}`,
            {
              attemptId: failureContract.attemptId,
              intent: repairObjective.intent,
              intentEvidence: repairObjective.intentEvidence,
              originalTodoId: repairObjective.originalTodoId,
              originalFiles: repairObjective.originalFiles,
              allowedFiles: repairObjective.allowedFiles,
              acceptanceCriteriaCount: repairObjective.acceptanceCriteria.length,
              primaryFailure: repairObjective.primaryFailure,
            },
          );
          ExecutionLogger.log(
            'REPAIR_PLAN',
            'repair',
            options.plannerModelId ?? '-',
            plan.todoPlan
              ? `todos=${plan.todoPlan.todos.map(todo => todo.id).join(',')} failedTodoId=${plan.todoPlan.failedTodoId ?? '(unknown)'}`
              : `steps=${plan.steps.map(step => step.id).join(',')}`,
            {
              attemptId: failureContract.attemptId,
              failedTodoId: failureContract.failedTodoId ?? plan.todoPlan?.failedTodoId,
              todoIds: plan.todoPlan?.todos.map(todo => todo.id) ?? plan.steps.map(step => step.id),
              failureIds: failureContract.failedChecks.map(check => check.id),
              affectedFiles: plan.todoPlan?.affectedFiles ?? [],
            },
          );
          // R4.22/R4.25: the planner proposed this; policy decides whether it
          // is a repair of the original task or a way to silence the check.
          if (plan.todoPlan && repairObjective) {
            const validation = validateRepairPlan({
              objective: repairObjective,
              repairPlan: plan.todoPlan,
            });
            repairTarget = Object.freeze({
              attemptId: failureContract.attemptId ?? `attempt-${(options.repairAttempt ?? 0) + 1}`,
              attemptNumber: (options.repairAttempt ?? 0) + 1,
              originalTask: repairObjective.originalTask,
              acceptanceCriteria: repairObjective.acceptanceCriteria,
              intent: repairObjective.intent,
              intentConfidence: repairObjective.intentConfidence,
              intentEvidence: repairObjective.intentEvidence,
              originalTodoId: repairObjective.originalTodoId,
              originalFiles: repairObjective.originalFiles,
              primaryFailure: repairObjective.primaryFailure,
              allowedFiles: repairObjective.allowedFiles,
              allowedOperations: repairObjective.allowedOperations,
              proposedFiles: validation.proposedFiles,
              proposedOperations: validation.proposedOperations,
              disallowedFiles: validation.disallowedFiles,
              decision: validation.decision,
              decisionReason: validation.reason,
              findings: validation.findings,
            });
            ExecutionLogger.log(
              'REPAIR_SCOPE_VALIDATION',
              'repair',
              '-',
              `decision=${validation.decision} proposed=${validation.proposedFiles.join(',') || '(none)'}`
              + ` disallowed=${validation.disallowedFiles.join(',') || '(none)'}`,
              {
                attemptId: repairTarget.attemptId,
                allowedFiles: repairObjective.allowedFiles,
                proposedFiles: validation.proposedFiles,
                allowedOperations: repairObjective.allowedOperations,
                proposedOperations: validation.proposedOperations,
                decision: validation.decision,
              },
            );
            for (const finding of validation.findings) {
              ExecutionLogger.log(
                'REPAIR_SAFETY_FINDING',
                'repair',
                '-',
                `${finding.kind}[${finding.severity}] ${finding.subject}: ${finding.reason}`,
                {
                  attemptId: repairTarget.attemptId,
                  kind: finding.kind,
                  severity: finding.severity,
                  subject: finding.subject,
                  evidenceRef: finding.evidenceRef,
                },
              );
            }

            if (validation.decision === 'BLOCK' || validation.decision === 'NEEDS_CONFIRMATION') {
              let userApproved = false;
              if (validation.decision === 'NEEDS_CONFIRMATION' && options.confirmationRequestId && this.confirmationService) {
                const val = await this.confirmationService.validateDecision(options.confirmationRequestId, {
                  taskId: sessionId ?? 'task',
                  runId: sessionId ?? undefined,
                  type: 'DESTRUCTIVE_REPAIR',
                  risk: 'HIGH',
                  requestedAction: 'APPLY_REPAIR',
                  affectedFiles: validation.proposedFiles,
                  affectedArtifacts: repairObjective.originalFiles,
                });
                if (val.valid) {
                  userApproved = true;
                }
              }

              let confirmationReqId = options.confirmationRequestId;
              if (validation.decision === 'NEEDS_CONFIRMATION' && !userApproved && this.confirmationService) {
                if (!confirmationReqId) {
                  const req = await this.confirmationService.createRequest({
                    taskId: correlationContext.taskId,
                    runId: correlationContext.runId,
                    type: 'DESTRUCTIVE_REPAIR',
                    reason: validation.reason,
                    risk: 'HIGH',
                    requestedAction: 'APPLY_REPAIR',
                    affectedFiles: validation.proposedFiles,
                    affectedArtifacts: repairObjective.originalFiles,
                  });
                  confirmationReqId = req.id;
                }
                if (options.onConfirmationRequested && confirmationReqId) {
                  const req = await this.confirmationService.getRequest(confirmationReqId);
                  if (req) {
                    const approved = await options.onConfirmationRequested(req);
                    if (approved) {
                      await this.confirmationService.approve(confirmationReqId, { actor: 'cli-user' });
                      userApproved = true;
                    } else {
                      await this.confirmationService.reject(confirmationReqId, { actor: 'cli-user', reason: 'User rejected repair in prompt' });
                    }
                  }
                }
              }

              if (!userApproved) {
                // R4.27: a repair that needs a human decision is not executed on
                // the strength of the planner's own confidence.
                repairOutcome = validation.decision === 'BLOCK'
                  ? 'REPAIR_TARGET_REJECTED'
                  : 'REPAIR_NEEDS_CONFIRMATION';
                abortReason = `Repair rejected: ${validation.reason}`;
                abortedAt = 'repair-target-validation';
                await this.sessionManager.failSession(sessionId, abortReason);
                return this.createFailedResult(
                  sessionId, abortReason, plan, null, null, null, null, abortedAt, abortReason,
                  {
                    qualityProfile,
                    failureContract,
                    plannerContext,
                    repairOutcome,
                    repairAttemptHistory: repairHistory,
                    repairExpansion,
                    repairTarget,
                    confirmationRequestId: confirmationReqId,
                  },
                );
              }
            }
          }

          if (plan.todoPlan && isDuplicateRepairPlan({
            history: repairHistory,
            nextFingerprint: fingerprintRepairPlan(plan.todoPlan ?? plan),
            expansionLevel: repairContext?.expansionLevel ?? 0,
            evidenceRefs: failureContract.evidenceRefs ?? failureContract.failedChecks.map(check => check.id),
          })) {
            abortReason = 'DUPLICATE_REPAIR_PLAN';
            abortedAt = 'repair';
            repairOutcome = 'DUPLICATE_REPAIR_PLAN';
            await this.sessionManager.failSession(sessionId, abortReason);
            return this.createFailedResult(
              sessionId, abortReason, plan, null, null, null, null, abortedAt, abortReason,
              {
                qualityProfile,
                failureContract,
                plannerContext,
                repairOutcome,
                repairAttemptHistory: repairHistory,
              },
            );
          }
        }

        if (!plan) {
          abortedAt = 'planning';
          abortReason = 'Planner returned null plan';
          await this.sessionManager.failSession(sessionId, abortReason);
          return this.createFailedResult(sessionId, abortReason, null, null, null, null, null, abortedAt, abortReason, { plannerContext, executionMode });
        }

        ExecutionLogger.log('WORKFLOW', 'planner', options.modelId ?? '-', `Plan created: ${plan.steps.length} steps, complexity: ${plan.complexity}`);
      } catch (error: any) {
        if (
          error?.reasonCode === 'PLANNER_UNGROUNDED_TARGET' ||
          (typeof error?.message === 'string' && error.message.includes('PLANNER_UNGROUNDED_TARGET'))
        ) {
          const rawRejected: ReadonlyArray<string> = (error?.rejectedTargets && error.rejectedTargets.length > 0)
            ? error.rejectedTargets
            : (error?.message?.match(/not grounded in workspace evidence:\s*(.+)$/i)?.[1]?.split(',').map((f: string) => f.trim()).filter(Boolean) ?? []);
          const rejectedTargets = sanitizeRejectedTargets(rawRejected);

          abortedAt = 'planning';
          abortReason = error.message || `PLANNER_UNGROUNDED_TARGET: Planner referenced files not grounded in workspace evidence: ${rejectedTargets.join(', ')}`;
          ExecutionLogger.log(
            'PLANNING_BLOCKED',
            'planner',
            options.modelId ?? '-',
            `Planning blocked: reason=PLANNER_UNGROUNDED_TARGET targets=${rejectedTargets.join(', ') || '(none)'}`,
            {
              reasonCode: 'PLANNER_UNGROUNDED_TARGET',
              rejectedTargets,
            },
          );
          if (sessionId) await this.sessionManager.failSession(sessionId, abortReason || 'PLANNER_UNGROUNDED_TARGET');
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(
            sessionId,
            abortReason || 'PLANNER_UNGROUNDED_TARGET',
            null,
            null,
            null,
            null,
            reflection,
            abortedAt,
            abortReason || 'PLANNER_UNGROUNDED_TARGET',
            {
              plannerContext,
              qualityProfile,
              productAnalysis,
              executionMode,
            },
          );
        }

        abortedAt = 'planning';
        abortReason = `Planning failed: ${error.message}`;
        ExecutionLogger.log(
          'PLANNING_FAILED',
          'planner',
          options.modelId ?? '-',
          `Planning failed: ${error.message}`,
          { error: error.message },
        );
        if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
        reflection = await this.generateReflectionSafely(sessionId);
        return this.createFailedResult(sessionId, abortReason, null, null, null, null, reflection, abortedAt, abortReason, { plannerContext, qualityProfile, productAnalysis, executionMode });
      }

      // Step 3.5: Plan Validation (R4.14)
      if (plan) {
        try {
          const validation = await this.planValidator.validate(plan, options.availableTools || (this.toolDefinitions ? this.toolDefinitions.map(t => t.name) : []));
          if (!validation.valid) {
            abortedAt = 'plan-validation';
            abortReason = `Plan validation failed: ${validation.errors.map(e => e.message).join('; ')}`;
            await this.sessionManager.failSession(sessionId, abortReason);
            reflection = await this.generateReflectionSafely(sessionId);
            return this.createFailedResult(sessionId, abortReason, plan, null, null, null, reflection, abortedAt, abortReason, { plannerContext });
          }
        } catch (error: any) {
          console.warn(`[Workflow] Plan validation error (non-fatal): ${error.message}`);
        }
      }

      // Capture plan files before decomposition. Micro-tasks may drop
      // expectedFiles when the original step only named files in prose.
      const preDecomposeScope = (plan && intakeResult)
        ? collectContractScopeFiles(intakeResult.intent, plan)
        : [];

      // Step 3.55: Task Decomposition (micro tasks for weak models).
      // Skip on verification repair: splitting the Failure Contract / repair
      // prompt into per-sentence micro-tasks thrashes implicated files and
      // undoes a correct edit (CrashBeacon fixed, then page.tsx footer lost).
      if (plan && this.taskDecomposer && !failureContract) {
        if (plan.todoPlan) {
          ExecutionLogger.log(
            'DECOMPOSE',
            '-',
            '-',
            `Skipped: TodoPlan already defines ${plan.todoPlan.todos.length} bounded execution units`,
          );
        } else {
        try {
          const decompContext: DecompositionContext = {
            memoryContext: memoryContext || undefined,
            constraints: options.availableTools,
          };
          const graph = this.taskDecomposer.decompose(plan, decompContext);
          const graphValidation = this.taskDecomposer.validateGraph(graph);

          if (graphValidation.valid && graph.totalTasks > 0) {
            const microSteps = graph.tasks.map(mt => Object.freeze({
              id: mt.id,
              description: mt.description,
              type: 'modify' as const,
              requiredTools: Object.freeze([] as string[]),
              expectedOutcome: mt.expectedOutput,
              objective: mt.title,
              dependencies: Object.freeze([...mt.dependencies]),
              expectedFiles: Object.freeze([...mt.targetFiles]),
              validationCriteria: Object.freeze([...mt.verificationSteps]),
            }));

            plan = Object.freeze({
              ...plan,
              steps: Object.freeze(microSteps),
              metadata: plan.metadata
                ? Object.freeze({ ...plan.metadata, stepCount: microSteps.length })
                : undefined,
            }) as ExecutionPlan;

            ExecutionLogger.log('DECOMPOSE', '-', '-',
              `Plan decomposed: ${graph.totalTasks} micro tasks | High risk: ${graph.highRiskTasks} | Avg difficulty: ${graph.averageDifficulty}`);
          } else if (!graphValidation.valid) {
            console.warn(`[Workflow] Task decomposition graph invalid: ${graphValidation.errors.join('; ')}`);
          }
        } catch (e: any) {
          console.warn('[Workflow] Task decomposition failed (non-fatal): ' + e.message);
        }
        if (plan && failureContract) {
          plan = this.unionRepairFiles(plan, failureContract, options.task, options.previouslyTouchedFiles);
        }
        }
      }

      // Step 3.6: After Plan Hook (R4.14)
      if (this.pipelineHooks?.afterPlan) {
        try { await this.pipelineHooks.afterPlan(plan); } catch (e: any) { console.warn(`[Workflow] afterPlan hook failed: ${e.message}`); }
      }

      // Grounding validation layer: Ensure every plan target is grounded in workspace evidence before ContractBuilder
      // Without an explicitly configured workspace root there is no authoritative
      // filesystem to ground against, so enforcement is skipped rather than guessed.
      if (plan && this.workspacePath) {
        try {
          const workspace = new LocalWorkspace(this.workspacePath);
          const groundingCheck = await validateTodoPlanGrounding(
            workspace,
            plan.todoPlan ?? plan,
            options.task,
            this.workspacePath,
            intakeResult?.intent.initialScope,
          );

          if (!groundingCheck.valid) {
            if (groundingCheck.reasonCode === 'PLANNER_UNGROUNDED_TARGET') {
              const rejectedTargets = sanitizeRejectedTargets(groundingCheck.ungroundedFiles);
              abortedAt = 'planning';
              abortReason = groundingCheck.error || `PLANNER_UNGROUNDED_TARGET: Planner referenced files not grounded in workspace evidence: ${rejectedTargets.join(', ')}`;
              ExecutionLogger.log(
                'PLANNING_BLOCKED',
                'planner',
                options.modelId ?? '-',
                `Planning blocked: reason=PLANNER_UNGROUNDED_TARGET targets=${rejectedTargets.join(', ') || '(none)'}`,
                {
                  reasonCode: 'PLANNER_UNGROUNDED_TARGET',
                  rejectedTargets,
                },
              );
              if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
              reflection = await this.generateReflectionSafely(sessionId);
              return this.createFailedResult(
                sessionId,
                abortReason,
                null,
                null,
                null,
                null,
                reflection,
                abortedAt,
                abortReason,
                { plannerContext, qualityProfile, productAnalysis, executionMode },
              );
            } else if (groundingCheck.reasonCode === 'TARGET_NOT_FOUND') {
              abortedAt = 'planning';
              abortReason = groundingCheck.error || `TARGET_NOT_FOUND: The requested file "${groundingCheck.missingRequestedFiles[0]}" was not found in the active workspace.`;
              ExecutionLogger.log(
                'PLANNING_BLOCKED',
                'planner',
                options.modelId ?? '-',
                `Planning blocked: reason=TARGET_NOT_FOUND missing=${groundingCheck.missingRequestedFiles.join(', ') || '(none)'}`,
                {
                  reasonCode: 'TARGET_NOT_FOUND',
                  missingFiles: groundingCheck.missingRequestedFiles,
                },
              );
              if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
              reflection = await this.generateReflectionSafely(sessionId);
              return this.createFailedResult(
                sessionId,
                abortReason,
                null,
                null,
                null,
                null,
                reflection,
                abortedAt,
                abortReason,
                { plannerContext, qualityProfile, productAnalysis, executionMode },
              );
            }
          }
        } catch (groundingError: any) {
          console.warn('[Workflow] Plan grounding check warning: ' + (groundingError && groundingError.message));
        }
      }

      // ============================================================
      // G.5 Stage 5: ContractBuilder (EXECUTION CONTRACT BUILDING)
      // Build after planning/decomposition so scope comes from the
      // ExecutionPlan that will actually run, not only intake regex.
      // ============================================================
      executionContract = null;
      evidenceResult = await this.prepareEvidenceForContract(
        evidenceResult,
        intakeResult,
        preflightResult,
        plan,
        preDecomposeScope,
      );

      if (this.contractBuilder && plan && intakeResult && preflightResult && riskAssessment) {
        try {
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `ContractBuilder: building execution contract from plan=${plan.id}`,
            { planId: plan.id, intentId: intakeResult.intent.id },
          );

          const intentForContract = Object.freeze({
            ...intakeResult.intent,
            initialScope: Object.freeze([
              ...new Set([
                ...intakeResult.intent.initialScope,
                ...preDecomposeScope,
              ]),
            ]),
          });

          const buildResult = await this.contractBuilder.build(
            intentForContract,
            preflightResult.inspection,
            riskAssessment,
            evidenceResult.evidence,
            undefined,  // critiqueResult (PlanCritic not yet integrated)
            plan,
          );

          executionContract = buildResult.contract;
          if (failureContract && plan) {
            const repairScope = collectEffectiveRepairScope({
              originalTask: options.task,
              failureContract,
              plannerFiles: plan.steps.flatMap(s => s.expectedFiles ?? []),
              previousAttemptFiles: options.previouslyTouchedFiles,
            });
            executionContract = expandContractFilesInScope(executionContract, repairScope);
          }

          const contractMetadata = {
            contractId: executionContract.id,
            intentId: intakeResult.intent.id,
            planId: plan.id,
            riskLevel: executionContract.risk,
            validated: buildResult.validated,
            validationErrors: buildResult.validationErrors,
            critiqueApproved: buildResult.critiqueApproved,
            stepsCount: executionContract.steps.length,
            filesInScopeCount: executionContract.filesInScope.length,
            constraintsCount: executionContract.constraints.length,
            evidenceCount: executionContract.evidence.length,
            builtAt: buildResult.builtAt,
          };

          const validationSummary = buildResult.validated
            ? 'validated=true'
            : `validated=false, errors=${buildResult.validationErrors.join('; ')}`;
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `ContractBuilder: contract built, id=${executionContract.id}, risk=${executionContract.risk}, steps=${executionContract.steps.length}, ${validationSummary}`,
            contractMetadata,
          );

          if (this.sessionManager && sessionId) {
            await this.sessionManager.recordEvent(
              sessionId,
              'CONTRACT_BUILT',
              `Execution contract built: id=${executionContract.id}, risk=${executionContract.risk}, steps=${executionContract.steps.length}, ${validationSummary}`,
              contractMetadata as any,
            );
          }
        } catch (contractError: any) {
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `ContractBuilder failed (non-fatal): ${contractError?.message || String(contractError)}`,
            { error: contractError?.message },
          );
          executionContract = null;
        }
      }

      // ============================================================
      // G.6 Stage 6: ExecutionGate + SafeExperiment (ENFORCEMENT)
      // Gate protects all execution paths before mutation.
      // Stage 6 preserves ExecutionPlan -> StepExecutionEngine.
      // ============================================================
      if (this.contractBuilder) {
        const gateFailure = await this.evaluateExecutionGateStage6(
          sessionId,
          plan,
          executionContract,
          intakeResult,
          riskAssessment,
          evidenceResult,
          options,
        );

        if (gateFailure) {
          await this.sessionManager.failSession(sessionId, gateFailure);
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(
            sessionId,
            gateFailure,
            plan,
            impactReport,
            reviewReport,
            patchResult,
            reflection,
            'execution-gate',
            gateFailure,
            { plannerContext, qualityProfile, productAnalysis },
          );
        }
      }

      // R1.11: workspace baseline before anything can mutate files. Every
      // execution path below shares this snapshot, which is what gives step
      // execution real comparison evidence instead of INSUFFICIENT_EVIDENCE.
      workspaceSnapshotBefore = await this.captureWorkspaceBaseline(
        executionMode,
        plan,
        options,
        preexistingDirtyFiles,
      );

      // Step 3.7: Step-by-Step Execution (if no pre-built patchRequest)
      if (!options.patchRequest && this.stepExecutionEngine && plan && plan.steps.length > 0) {
        ExecutionLogger.log('WORKFLOW', 'coder', options.modelId ?? '-', `Step-by-step execution: ${plan.steps.length} steps`);
        let projectStructure = '';
        if (this.projectStructureService && this.workspacePath) {
          try {
            projectStructure = await this.projectStructureService.scan(this.workspacePath);
            if (projectStructure) {
              ExecutionLogger.log('CONTEXT', '-', '-', `Project structure scanned: ${projectStructure.split('\n').length} lines`);
            }
          } catch (err: any) {
            console.warn(`[Workflow] Project structure scan failed (non-fatal): ${err.message}`);
          }
        }

        const execContext: ExecutionContext = {
          sessionId: sessionId || '',
          plan: plan,
          currentStepIndex: 0,
          totalSteps: plan.steps.length,
          startedAt: new Date().toISOString(),
          executionId: sessionId || undefined,
          projectStructure,
          resumedFromCheckpoint: false,
          contract: executionContract ?? undefined,  // Stage 7: Contract policy boundary
          acceptanceContract,
          preserveObservables: acceptanceContract?.preserve,
          workspacePath: this.workspacePath,
          plannerContext,
          executionMode,
          metadata: (failureContract || plannerContext)
            ? Object.freeze({
              ...(failureContract ? { repair: 'true' } : {}),
              ...(plannerContext ? {
                contextStrategy: 'true',
                contextRepairMode: plannerContext.repairMode ? 'true' : 'false',
              } : {}),
            })
            : undefined,
        };
        const stepResult = await this.stepExecutionEngine.executeSteps(sessionId, plan, execContext, options.modelId, options.providerId as any);
        stepResults = stepResult.results;
        // R2.23: drained once per run so a retried step does not double-count.
        mutationLedger = this.stepExecutionEngine.drainMutationLedger?.();
        if (mutationLedger && mutationLedger.mutationAttempts > 0) {
          ExecutionLogger.log('MUTATION', '-', '-',
            `Mutation ledger: ${mutationLedger.successfulMutations} applied, `
            + `${mutationLedger.rejectedMutations} rejected, ${mutationLedger.blockedMutations} blocked, `
            + `${mutationLedger.rolledBackMutations} rolled back`,
            {
              mutationAttempts: mutationLedger.mutationAttempts,
              syntaxFailures: mutationLedger.syntaxFailures,
              unexpectedDiffs: mutationLedger.unexpectedDiffs,
              rollbackFailures: mutationLedger.rollbackFailures,
              outOfScopeAttempts: mutationLedger.outOfScopeAttempts,
            });
        }
        ExecutionLogger.log('WORKFLOW', 'coder', options.modelId ?? '-', `Step execution completed: ${stepResult.completedSteps}/${stepResult.totalSteps} steps`);
        if (failureContract) {
          ExecutionLogger.log(
            'REPAIR_ATTEMPT',
            'repair',
            options.modelId ?? '-',
            `executed ${stepResult.completedSteps}/${stepResult.totalSteps} repair steps`,
            {
              attemptId: failureContract.attemptId,
              failedTodoId: failureContract.failedTodoId ?? plan.todoPlan?.failedTodoId,
              todoIds: plan.todoPlan?.todos.map(todo => todo.id) ?? [],
              failureIds: failureContract.failedChecks.map(check => check.id),
              success: stepResult.success,
            },
          );
        }

        const stepFailed = stepResult && (stepResult.success === false || (stepResult.totalSteps > 0 && stepResult.completedSteps < stepResult.totalSteps) || (stepResults && stepResults.some(r => !r.success)));
        if (stepFailed) {
          const failedStep = stepResults?.find(r => !r.success);
          const errorMsg = failedStep?.error || `Step execution failed (${stepResult.completedSteps}/${stepResult.totalSteps} steps completed)`;
          abortedAt = 'step-execution';
          abortReason = errorMsg;
          // PHASE-09: classify mutation failures explicitly (no silent stop).
          if (/MUTATION_NOT_APPLIED|WRITE_FAILED|mutation safety/i.test(errorMsg) && mutationLedger) {
            const { buildMutationFailureContract } = await import('../../domain/mutation-failure-contract');
            const failedFiles = [...new Set(
              (mutationLedger.results ?? [])
                .filter((r) => r.status !== 'APPLIED')
                .map((r) => r.path),
            )];
            const mfc = buildMutationFailureContract({
              failedFiles,
              attempts: mutationLedger.mutationAttempts,
              reason: errorMsg,
              failureCodes: ['MUTATION_NOT_APPLIED'],
            });
            abortReason = `MUTATION_FAILURE: ${mfc.reason} (files=${mfc.failedFiles.join(',') || 'unknown'}; attempts=${mfc.attempts})`;
            ExecutionLogger.log('MUTATION', '-', '-', `MutationFailureContract ${mfc.id}`, {
              failedFiles: mfc.failedFiles,
              attempts: mfc.attempts,
            });
          }
          if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(
            sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection,
            abortedAt, abortReason,
            {
              qualityProfile, productAnalysis, plannerContext,
              stepResults, executionMode, workspaceComparison, mutationLedger,
            },
          );
        }

        // Update session + git commit after step execution
        try {
          const sess = await this.sessionManager.getSession(sessionId);
          if (sess) {
            const gitStatus = await this.gitManager.status().catch(() => null);
            const changedFiles = selectTaskChangedFiles(gitStatus?.changedFiles ?? [], preexistingDirtyFiles);
            await this.sessionManager.updateSession({
              ...sess,
              status: 'completed' as any,
              totalSteps: plan.steps.length,
              currentStep: stepResult.completedSteps,
              modifiedFiles: changedFiles.length > 0 ? changedFiles : (sess.modifiedFiles ?? []),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (e: any) {
          console.warn('[Workflow] Failed to update session after steps: ' + e.message);
        }

        // Auto-commit if git repo and changes exist. R1.22: never in READ_ONLY.
        // PHASE-09: skip here when commit barrier defers until acceptance after VV.
        const deferCommits = this.stepExecutionEngine?.peekPendingAcceptanceFiles
          && (this.stepExecutionEngine.peekPendingAcceptanceFiles().length > 0
            || true); // barrier enabled by default on step engine
        if (!deferCommits) {
        try {
          const isRepo = allowsGitMutation(executionMode) && await this.gitManager.isRepository();
          if (isRepo) {
            const status = await this.gitManager.status();
            if (status.hasChanges) {
              const taskFiles = selectTaskChangedFiles(status.changedFiles, preexistingDirtyFiles);
              if (taskFiles.length === 0) {
                ExecutionLogger.log('GIT', '-', '-', 'Auto-commit skipped: only pre-existing dirty files remain');
              } else {
                const commitMsg = 'feat: ' + options.task.substring(0, 72);
                await this.gitManager.commit({
                  sessionId,
                  message: commitMsg,
                  changedFiles: taskFiles,
                });
                ExecutionLogger.log('GIT', '-', '-', 'Auto-committed: ' + commitMsg, { changedFiles: taskFiles });
              }
            }
          }
        } catch (gitErr: any) {
          console.warn('[Workflow] Git auto-commit failed (non-fatal): ' + gitErr.message);
        }
        } else {
          ExecutionLogger.log('GIT', '-', '-', 'Auto-commit deferred until acceptance (PHASE-09 commit barrier)');
        }
      } else if (!options.patchRequest && this.taskExecutor && this.toolDefinitions) {
        // Fallback: single TaskExecutor call (no plan steps)
        ExecutionLogger.log('WORKFLOW', 'coder', options.modelId ?? '-', 'Sparrow execution via TaskExecutor (fallback)');
        await this.sessionManager.recordStepStarted(sessionId, 'sparrow-execution', 'Executing task via TaskExecutor with tools');
        try {
          const workflowRole: Role = {
            getName: () => 'Workflow Agent',
            getConfig: () => ({
              systemPrompt: 'You are an AI software engineer with access to workspace tools. Execute the task immediately using tools. Read files, create files, modify files as needed. Do NOT ask for permission. Do NOT explain - just do it. CRITICAL RULES: 1) After completing the task, respond with a brief text summary WITHOUT any tool calls. 2) NEVER repeat the same tool call with the same arguments twice. 3) NEVER read a file you just wrote - you already know its content. 4) When the task is done, STOP calling tools and respond with text only.'
            })
          };

          const response = await this.taskExecutor.execute({
            sessionId,
            context: {
              taskIntent: options.task,
              rules: [],
              knowledge: memoryContext ? [{ id: 'workflow-memory', content: memoryContext, filePath: 'memory://workflow' }] : [],
              files: [],
              memories: [],
            },
            role: workflowRole,
            providerId: (options.providerId ?? 'ollama') as any,
            model: options.modelId ?? 'gpt-oss:20b-cloud',
            tools: this.toolDefinitions,
          });

          patchResult = {
            success: true,
            changedFiles: [] as string[],
            failedFiles: [] as string[],
            rollbackPerformed: false,
            validationPassed: true,
            testsPassed: true,
          } as any;

          await this.sessionManager.recordStepCompleted(sessionId, 'sparrow-execution', 'Task executed successfully');

          // Mark session completed + set steps + modifiedFiles for accurate Reflection
          try {
            const sess = await this.sessionManager.getSession(sessionId);
            if (sess) {
              const gitStatus = await this.gitManager.status().catch(() => null);
              const changedFiles = selectTaskChangedFiles(gitStatus?.changedFiles ?? [], preexistingDirtyFiles);
              await this.sessionManager.updateSession({
                ...sess,
                status: 'completed' as any,
                totalSteps: plan ? plan.steps.length : 1,
                currentStep: plan ? plan.steps.length : 1,
                modifiedFiles: changedFiles.length > 0 ? changedFiles : (sess.modifiedFiles ?? []),
                updatedAt: new Date().toISOString(),
              });
            }
          } catch (e: any) {
            console.warn('[Workflow] Failed to update session: ' + e.message);
          }
          ExecutionLogger.log('WORKFLOW', 'coder', options.modelId ?? '-', 'Sparrow execution completed', {
            responseLength: response.content.length,
          });

          // Auto-commit if git repo and changes exist. R1.22: never in READ_ONLY.
          try {
            const isRepo = allowsGitMutation(executionMode) && await this.gitManager.isRepository();
            if (isRepo) {
              const status = await this.gitManager.status();
              if (status.hasChanges) {
                const taskFiles = selectTaskChangedFiles(status.changedFiles, preexistingDirtyFiles);
                if (taskFiles.length === 0) {
                  ExecutionLogger.log('GIT', '-', '-', 'Auto-commit skipped: only pre-existing dirty files remain');
                } else {
                  const commitMsg = 'feat: ' + options.task.substring(0, 72);
                  await this.gitManager.commit({
                    sessionId,
                    message: commitMsg,
                    changedFiles: taskFiles,
                  });
                  ExecutionLogger.log('GIT', '-', '-', 'Auto-committed: ' + commitMsg, { changedFiles: taskFiles });
                }
              }
            }
          } catch (gitErr: any) {
            console.warn('[Workflow] Git auto-commit failed (non-fatal): ' + gitErr.message);
          }

        } catch (error: any) {
          abortedAt = 'sparrow-execution';
          abortReason = 'Sparrow execution failed: ' + error.message;
          await this.sessionManager.recordStepFailed(sessionId, 'sparrow-execution', abortReason);
          await this.sessionManager.failSession(sessionId, abortReason);
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection, abortedAt, abortReason, { plannerContext, qualityProfile, productAnalysis });
        }
      }

      // R1.12/R1.15: post-execution comparison for every execution path that
      // reached this point, including step execution.
      if (!options.patchRequest) {
        workspaceComparison = await this.compareWorkspaceAfterExecution(
          workspaceSnapshotBefore,
          plan,
          options,
          preexistingDirtyFiles,
        );
        if (workspaceComparison) {
          stateComparison = toStateComparison(workspaceComparison);
        }
      }

      // Step 3.9: Runtime Protection Check (sparrow mode)
      {
        const governor = this.executionGovernor;
        const healthProvider = this.runtimeHealthProvider;
        if (governor && healthProvider) {
          try {
            const health = await healthProvider.collect();
            const decision = governor.evaluate(health);
            ExecutionLogger.log('GOVERNOR', '-', '-', `Health check: ${decision.action} - ${decision.reason}`);
            if (decision.action === 'pause') {
              await this.sessionManager.pauseSession(sessionId, decision.reason);
              const policy = governor.getPolicy();
              await new Promise(resolve => setTimeout(resolve, policy.pauseDurationMs));
              await this.sessionManager.resumeSession(sessionId);
            }
          } catch (e: any) {
            console.warn('[Workflow] Governor check failed (non-fatal): ' + e.message);
          }
        }
      }

      // Step 4: Impact Analysis (use targetFiles or session.modifiedFiles)
      ExecutionLogger.log('WORKFLOW', '-', '-', 'Starting impact analysis');
      
      // Phase 2-B: Capture pre-execution state
      let preExecutionState: import('../../domain/execution/execution-state').PreExecutionState | null = null;
      if (this.executionStateTracker && plan) {
        try {
          const targetFiles = plan.steps.flatMap(s => s.expectedFiles ?? []);
          preExecutionState = await this.executionStateTracker.capturePreExecutionState(
            sessionId ?? 'unknown',
            options.task,
            targetFiles,
          );
          ExecutionLogger.log('STATE', '-', '-', `Pre-execution state captured: ${preExecutionState.fileStates.length} files`);
        } catch (e: any) {
          console.warn(`[Workflow] Pre-execution state capture failed (non-fatal): ${e.message}`);
        }
      }
      
      {
        let impactTargetFiles: ReadonlyArray<string> = options.targetFiles ?? [];
        if (impactTargetFiles.length === 0) {
          const sess = await this.sessionManager.getSession(sessionId);
          impactTargetFiles = sess?.modifiedFiles ?? [];
        }
        if (impactTargetFiles.length === 0 && plan?.todoPlan?.affectedFiles) {
          impactTargetFiles = plan.todoPlan.affectedFiles;
        }
        if (impactTargetFiles.length > 0) {
          try {
            impactReport = await this.impactAnalyzer.analyze(impactTargetFiles, {
              todoPlan: plan?.todoPlan,
              skills: plannerContext?.resolvedSkills.skills,
              workspaceRoot: this.workspacePath,
            });
            ExecutionLogger.log('IMPACT_ANALYSIS', '-', '-', impactReport.analysis?.summary ?? `Impact analysis complete`, {
              confidence: impactReport.analysis?.confidence ?? 'UNKNOWN',
              directImpacts: impactReport.directImpacts?.length ?? 0,
              indirectImpacts: impactReport.indirectImpacts?.length ?? 0,
              boundariesCrossed: impactReport.architecturalBoundariesCrossed?.length ?? 0,
              relations: impactReport.analysis?.relations?.length ?? 0,
              unknowns: impactReport.analysis?.unknowns?.length ?? 0,
              limitsReached: impactReport.analysis?.limitsReached ?? false,
            });

            // F2 / F3: Select deterministic risk-based regression
            regressionPlan = await this.regressionSelector.selectRegression({
              todoPlan: plan?.todoPlan,
              impactAnalysis: impactReport.analysis,
              impactReport,
              changedFiles: impactTargetFiles,
              skills: plannerContext?.resolvedSkills.skills,
              versionIntelligence: plannerContext?.versionIntelligence,
            });

            ExecutionLogger.log('VERIFICATION_EXPANSION', '-', '-', `Expanded ${regressionPlan.expandedChecks.length} verification checks for ${regressionPlan.risk} risk change`, {
              risk: regressionPlan.risk,
              directChecks: regressionPlan.directChecks,
              expandedChecks: regressionPlan.expandedChecks,
              selectedChecks: regressionPlan.selectedChecks,
              skippedChecks: regressionPlan.skippedChecks.length,
            });

            ExecutionLogger.log('REGRESSION_PLAN', '-', '-', `Policy: ${regressionPlan.policy}, selected: ${regressionPlan.selectedChecks.join(', ')}`, {
              policy: regressionPlan.policy,
              selectedChecks: regressionPlan.selectedChecks,
              reasons: regressionPlan.reasons,
              unverifiedArtifacts: regressionPlan.unverifiedArtifacts,
            });
          } catch (error: any) {
            console.warn('[Workflow] Impact analysis failed (non-fatal): ' + error.message);
          }
        }
      }

      // Step 5: Deterministic Review
      ExecutionLogger.log('WORKFLOW', 'reviewer', '-', 'Starting deterministic review');
      if (!options.patchRequest) {
        // Sparrow mode: review changed files from session (git already committed)
        try {
          const sess = await this.sessionManager.getSession(sessionId);
          let changedFiles: ReadonlyArray<string> = sess?.modifiedFiles ?? [];
          // Fallback to git status if session has no modified files
          if (changedFiles.length === 0) {
            const gitStatus = await this.gitManager.status().catch(() => null);
            changedFiles = selectTaskChangedFiles(gitStatus?.changedFiles ?? [], preexistingDirtyFiles);
          }
          if (changedFiles.length > 0) {
            const patchInfo: PatchInfo = {
              modifiedFiles: changedFiles,
              plannedScope: options.plannedScope,
            };
            reviewReport = await this.reviewer.review(patchInfo, impactReport || undefined);
            ExecutionLogger.log('REVIEW', 'reviewer', '-', `Sparrow review complete`, {
              passed: reviewReport?.passedCount ?? 0,
              failed: reviewReport?.failedCount ?? 0,
              warnings: reviewReport?.warningCount ?? 0,
              files: changedFiles.length,
            });
          }
        } catch (e: any) {
          console.warn('[Workflow] Sparrow review failed (non-fatal): ' + e.message);
        }
      } else if (options.patchRequest) {
        const patchInfo: PatchInfo = {
          modifiedFiles: options.patchRequest.operations.map(op => op.path),
          plannedScope: options.plannedScope,
        };

        try {
          reviewReport = await this.reviewer.review(patchInfo, impactReport || undefined);
          ExecutionLogger.log('REVIEW', 'reviewer', '-', `Review complete`, {
            passed: reviewReport?.passedCount ?? 0,
            failed: reviewReport?.failedCount ?? 0,
            warnings: reviewReport?.warningCount ?? 0,
          });
          
          if (reviewReport.failedCount > 0) {
            abortedAt = 'review';
            abortReason = `Review failed with ${reviewReport.failedCount} error(s)`;
            await this.sessionManager.recordDecision(
              sessionId,
              'PATCH_ABORTED_DUE_TO_REVIEW_FAILURE',
              abortReason
            );
            await this.sessionManager.failSession(sessionId, abortReason);
            reflection = await this.generateReflectionSafely(sessionId);
            return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, null, reflection, abortedAt, abortReason, { plannerContext, qualityProfile, productAnalysis });
          }
        } catch (error: any) {
          abortedAt = 'review';
          abortReason = `Review failed: ${error.message}`;
          await this.sessionManager.failSession(sessionId, abortReason);
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, null, reflection, abortedAt, abortReason, { plannerContext, qualityProfile, productAnalysis });
        }

        // Step 5.5: Runtime Protection Check (R4.14)
        const governor = this.executionGovernor;
        const healthProvider = this.runtimeHealthProvider;
        if (governor && healthProvider) {
          try {
            const health = await healthProvider.collect();
            const decision = governor.evaluate(health);
            if (decision.action === 'pause') {
              await this.sessionManager.pauseSession(sessionId, decision.reason);
              const policy = governor.getPolicy();
              await new Promise(resolve => setTimeout(resolve, policy.pauseDurationMs));
              await this.sessionManager.resumeSession(sessionId);
            }
          } catch (error: any) {
            console.warn(`[Workflow] Runtime protection check failed (non-fatal): ${error.message}`);
          }
        }

        // Step 6: Safe Patch Execution (includes Verification, Retry, Rollback)
        ExecutionLogger.log('PATCH', '-', '-', 'Starting safe patch execution');
        await this.sessionManager.recordStepStarted(sessionId, 'patch-execution', 'Executing patch with verification');
        try {
          const changedFiles = options.patchRequest?.operations.map(op => op.path) || [];
          const strategy = await this.verificationStrategyEngine.generate(plan, impactReport, changedFiles);

          const execResult = await this.safePatchExecutor.executeWithVerification(
            sessionId,
            options.patchRequest,
            strategy
          );

          patchResult = {
            success: execResult.success,
            changedFiles: options.patchRequest.operations.map(op => op.path),
            failedFiles: [],
            rollbackPerformed: !execResult.success,
            validationPassed: execResult.success,
            testsPassed: execResult.success,
            error: execResult.finalError,
          } as any;

          if (!execResult.success) {
            abortedAt = 'patch-execution';
            abortReason = `Patch execution failed after ${execResult.attempts} attempt(s): ${execResult.finalError}`;
            await this.sessionManager.recordStepFailed(sessionId, 'patch-execution', abortReason);
            await this.sessionManager.failSession(sessionId, abortReason);
            reflection = await this.generateReflectionSafely(sessionId);
            
            return {
              sessionId,
              success: false,
              plan,
              impactReport,
              reviewReport,
              patchResult,
              reflection,
              abortedAt,
              abortReason,
            };
          }
          await this.sessionManager.recordStepCompleted(sessionId, 'patch-execution', 'Patch executed successfully');

          workspaceComparison = await this.compareWorkspaceAfterExecution(
            workspaceSnapshotBefore,
            plan,
            options,
            preexistingDirtyFiles,
          );

          
          // Phase 2-B: Capture post-execution state and compare
          if (this.executionStateTracker && preExecutionState) {
            try {
              const modifiedFiles = patchResult?.changedFiles ?? [];
              const postExecutionState = await this.executionStateTracker.capturePostExecutionState(
                sessionId ?? 'unknown',
                preExecutionState,
                modifiedFiles,
              );
              stateComparison = this.executionStateTracker.compareStates(preExecutionState, postExecutionState);
              if (stateComparison.hasUnexpectedChanges) {
                ExecutionLogger.log('STATE', '-', '-', `⚠️ Unexpected changes detected: ${stateComparison.unexpectedChanges.join(', ')}`);
              } else {
                ExecutionLogger.log('STATE', '-', '-', `State comparison clean: ${stateComparison.filesModified.length} modified, ${stateComparison.filesCreated.length} created`);
              }
            } catch (e: any) {
              console.warn(`[Workflow] Post-execution state comparison failed (non-fatal): ${e.message}`);
              stateComparison = undefined;
            }
          }
        } catch (error: any) {
          abortedAt = 'patch-execution';
          abortReason = `Patch execution error: ${error.message}`;
          await this.sessionManager.failSession(sessionId, abortReason);
          reflection = await this.generateReflectionSafely(sessionId);
          
          return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection, abortedAt, abortReason, { plannerContext, qualityProfile, productAnalysis });
        }

        // Step 7: Git Commit (only if patch succeeded)
        ExecutionLogger.log('GIT', '-', '-', 'Starting git commit');
        try {
          const isRepo = allowsGitMutation(executionMode) && await this.gitManager.isRepository();
          if (isRepo) {
            const commitMessage = `feat: ${options.task}`;
            await this.gitManager.commit({
              sessionId,
              message: commitMessage,
              changedFiles: options.patchRequest.operations.map(op => op.path),
            });
          }
        } catch (error: any) {
          console.warn(`[Workflow] Git commit failed: ${error.message}`);
        }
      }

      const touchedFiles = await this.collectTouchedFiles(options.previouslyTouchedFiles);

      if (acceptanceContract && this.workspacePath && !options.skipVv) {
        const scope = uniqueSortedPaths([
          ...extractFilePaths(options.task),
          ...(plan?.steps.flatMap(s => s.expectedFiles ?? []) ?? []),
          ...touchedFiles,
        ]);
        if (scope.length > 0) {
          const contents = await readScopedFiles(this.workspacePath, scope);
          const localChecks = evaluateAcceptanceContract({
            contents,
            contract: acceptanceContract,
            preserve: acceptanceContract.preserve,
            allowedToChange: allowedChangeFromFailure(failureContract),
          });
          const localFailed = localChecks.filter(c => !c.passed);
          if (localFailed.length > 0) {
            ExecutionLogger.log('VERIFICATION', '-', '-', 'Acceptance contract unsatisfied before V&V', {
              failed: localFailed.length,
              testIds: acceptanceContract.requiredTestIds,
            });
            failureContract = buildFailureContract({
              profile: qualityProfile,
              checks: localChecks,
              acceptanceCriteria: acceptanceContract.criteria,
              attempt: options.repairAttempt ?? 1,
              workspacePath: this.workspacePath,
            });
            if (failureContract) {
              const finalized = this.finalizeRepairFailure(failureContract, plan, stepResults, verificationReport, options.repairAttempt);
              failureContract = finalized.failureContract;
              todoVerification = finalized.todoVerification;
              repairOutcome = 'PROCEED';
            }
            abortReason = 'Acceptance contract unsatisfied: ' + localFailed.map(c => c.evidence).join(' | ');
            abortedAt = 'verification';
            if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
            reflection = await this.generateReflectionSafely(sessionId);
            return this.createFailedResult(
              sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection,
              abortedAt, abortReason,
              {
                qualityProfile, productAnalysis, failureContract, touchedFiles, plannerContext,
                stepResults, todoVerification, repairAttemptHistory: repairHistory, repairOutcome,
                stateComparison, regressionPlan, executionMode, workspaceComparison, mutationLedger,
                todoVerificationReport, verificationSideEffects, repairExpansion,
              },
            );
          }
        }
      }

      // Post-execution V&V. Does not repair production code.
      // PHASE-09: prefer RunChangeSet / mutation ledger over dirty-tree-only.
      if (this.vvAgent && !options.skipVv) {
        try {
          if (this.sessionManager && sessionId) {
            await this.sessionManager.recordEvent(sessionId, 'VERIFICATION_STARTED', 'V&V execution started', {
              qualityProfile,
              executionMode,
            });
          }
          const ledgerFiles = (mutationLedger?.results ?? [])
            .filter((r) => r.status === 'APPLIED' && r.changed !== false && !r.rolledBack)
            .map((r) => r.path.replace(/\\/g, '/'));
          const pendingFiles = this.stepExecutionEngine?.peekPendingAcceptanceFiles?.() ?? [];
          const changeSetFiles = [...new Set([...ledgerFiles, ...pendingFiles])];
          let changedFiles = changeSetFiles.length > 0
            ? changeSetFiles
            : (options.targetFiles || []);
          if (changedFiles.length === 0) {
            try {
              const gitStatus = await this.gitManager.status();
              if (gitStatus && gitStatus.changedFiles && gitStatus.changedFiles.length > 0) {
                changedFiles = selectTaskChangedFiles(gitStatus.changedFiles, preexistingDirtyFiles);
              }
            } catch { /* ignore */ }
          }
          const { emptyRunChangeSet, mergeRunChangeSet } = await import('../../domain/run-change-set');
          let runChangeSet = emptyRunChangeSet(correlationContext.runId || sessionId || 'run');
          runChangeSet = mergeRunChangeSet(runChangeSet, { files: changedFiles, source: 'mutation-ledger' });
          verificationReport = await this.vvAgent.verify({
            task: options.task,
            qualityProfile,
            workspacePath: this.workspacePath || process.cwd(),
            changedFiles,
            runChangeSet,
            acceptanceCriteria: acceptanceContract?.criteria ?? productAnalysis?.acceptanceCriteria,
            intentContract: productAnalysis,
            repairAttempt: options.repairAttempt ?? 1,
            todoPlan: plan?.todoPlan,
            skills: plannerContext?.resolvedSkills.skills,
            executionMode,
            sideEffectPolicy: executionMode === 'READ_ONLY' ? 'READ_ONLY' : 'CONTROLLED_MUTATION',
          });
          verificationSideEffects = buildSideEffectLedger({
            policy: verificationReport.sideEffects?.policy
              ?? (executionMode === 'READ_ONLY' ? 'READ_ONLY' : 'CONTROLLED_MUTATION'),
            effects: [...preVerificationSideEffects, ...(verificationReport.sideEffects?.effects ?? [])],
          });
          todoVerificationReport = buildTodoVerificationReport({
            plan,
            report: verificationReport,
            stepResults,
          });
          this.logTodoVerification(todoVerificationReport);
          ExecutionLogger.log('VERIFICATION', '-', '-', 'V&V completed', {
            passed: verificationReport.passed,
            checks: verificationReport.checks.length,
            profile: qualityProfile,
          });
          if (this.sessionManager && sessionId) {
            await this.sessionManager.recordEvent(
              sessionId,
              verificationReport.passed ? 'VERIFICATION_COMPLETED' : 'VERIFICATION_FAILED',
              verificationReport.passed ? 'V&V passed' : 'V&V failed',
              {
                passed: verificationReport.passed,
                checks: verificationReport.checks.length,
              },
            );
          }
          if (!verificationReport.passed) {
            failureContract = verificationReport.failureContract;
            if (failureContract) {
              const finalized = this.finalizeRepairFailure(failureContract, plan, stepResults, verificationReport, options.repairAttempt);
              failureContract = finalized.failureContract;
              todoVerification = finalized.todoVerification;
              repairOutcome = 'PROCEED';
            }
            abortReason = 'V&V failed: ' + (failureContract ? failureContract.summary : 'verification checks failed');
            abortedAt = 'verification';
            if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
            reflection = await this.generateReflectionSafely(sessionId);
            return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection, abortedAt, abortReason, {
              qualityProfile, productAnalysis, verificationReport, failureContract, touchedFiles, plannerContext,
              stepResults, todoVerification, repairAttemptHistory: repairHistory, repairOutcome, regressionPlan,
              stateComparison, executionMode, workspaceComparison, mutationLedger, todoVerificationReport, verificationSideEffects,
              repairExpansion,
            });
          }
        } catch (error: any) {
          console.warn('[Workflow] V&V failed (non-fatal unless PRODUCTION): ' + (error && error.message));
          if (qualityProfile === 'PRODUCTION') {
            abortReason = 'V&V threw in PRODUCTION: ' + (error && error.message);
            abortedAt = 'verification';
            if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
            return this.createFailedResult(sessionId, abortReason, plan, impactReport, reviewReport, patchResult, null, abortedAt, abortReason, { qualityProfile, productAnalysis, plannerContext });
          }
        }
      }

      // PHASE-09 acceptance commit: only after verification passed.
      if (verificationReport?.passed && allowsGitMutation(executionMode)) {
        try {
          const pending = this.stepExecutionEngine?.drainPendingAcceptanceFiles?.() ?? [];
          const status = await this.gitManager.status().catch(() => null);
          const dirty = selectTaskChangedFiles(status?.changedFiles ?? [], preexistingDirtyFiles);
          const toCommit = [...new Set([...pending, ...dirty])];
          if (toCommit.length > 0 && await this.gitManager.isRepository()) {
            const commitMsg = 'feat: ' + options.task.substring(0, 72);
            await this.gitManager.commit({
              sessionId,
              message: commitMsg,
              changedFiles: toCommit,
            });
            ExecutionLogger.log('GIT', '-', '-', 'Acceptance commit: ' + commitMsg, { changedFiles: toCommit });
          }
        } catch (e: any) {
          console.warn('[Workflow] Acceptance commit failed (non-fatal): ' + e.message);
        }
      } else if (verificationReport && !verificationReport.passed) {
        // Leave deferred changes uncommitted; FinalTruth marks PARTIAL_FAILURE.
        ExecutionLogger.log('GIT', '-', '-', 'Acceptance commit skipped: verification did not pass');
      }

      // Step 7.9 (R4.28): verification has passed, which is one term of repair
      // success and not the verdict. Before this run can be called a repair,
      // the mutation and workspace evidence has to show the failure stopped
      // occurring because the code was fixed rather than because it was
      // removed, emptied or switched off.
      if (repairObjective) {
        const outcomeFindings = analyzeRepairOutcome({
          objective: repairObjective,
          mutationLedger,
          deletedFiles: workspaceComparison?.deletedFiles,
          unintendedChangedFiles: workspaceComparison?.unintendedChangedFiles,
        });
        const allFindings = [...(repairTarget?.findings ?? []), ...outcomeFindings];
        const completion = evaluateRepairCompletion({
          objective: repairObjective,
          primaryResolved: verificationReport ? verificationReport.passed : undefined,
          verificationPassed: verificationReport ? verificationReport.passed : undefined,
          scopeRespected: !allFindings.some(item => item.kind === 'SCOPE_ESCAPE'),
          findings: allFindings,
        });
        repairTarget = Object.freeze({
          ...(repairTarget ?? emptyRepairTargetRecord(repairObjective, options)),
          findings: Object.freeze(allFindings),
          completion,
        });
        ExecutionLogger.log(
          'REPAIR_COMPLETION',
          'repair',
          '-',
          `state=${completion.state} succeeded=${completion.succeeded} ${completion.reason}`,
          {
            attemptId: repairTarget.attemptId,
            state: completion.state,
            primaryResolved: completion.primaryResolved,
            acceptancePreserved: completion.acceptancePreserved,
            scopeRespected: completion.scopeRespected,
            findings: completion.findings.map(item => `${item.kind}:${item.subject}`),
          },
        );
        for (const finding of outcomeFindings) {
          ExecutionLogger.log(
            'REPAIR_SAFETY_FINDING',
            'repair',
            '-',
            `${finding.kind}[${finding.severity}] ${finding.subject}: ${finding.reason}`,
            {
              attemptId: repairTarget.attemptId,
              kind: finding.kind,
              severity: finding.severity,
              subject: finding.subject,
              evidenceRef: finding.evidenceRef,
            },
          );
        }
        if (completion.state === 'ACCEPTANCE_CHASING_DETECTED' || !completion.succeeded) {
          repairOutcome = completion.state === 'ACCEPTANCE_CHASING_DETECTED'
            ? 'REPAIR_ACCEPTANCE_CHASING'
            : 'REPAIR_TARGET_REJECTED';
          abortReason = completion.reason;
          abortedAt = 'repair-completion';
          if (sessionId) await this.sessionManager.failSession(sessionId, abortReason);
          reflection = await this.generateReflectionSafely(sessionId);
          return this.createFailedResult(
            sessionId, abortReason, plan, impactReport, reviewReport, patchResult, reflection,
            abortedAt, abortReason,
            {
              qualityProfile, productAnalysis, verificationReport, failureContract, touchedFiles,
              plannerContext, stepResults, todoVerification, repairAttemptHistory: repairHistory,
              repairOutcome, regressionPlan, stateComparison, executionMode, workspaceComparison,
              mutationLedger, todoVerificationReport, verificationSideEffects, repairExpansion,
              repairTarget,
            },
          );
        }
      }

      // Step 8: Reflection (always execute)
      ExecutionLogger.log('REFLECTION', '-', '-', 'Generating reflection');
      reflection = await this.generateReflectionSafely(sessionId);

      // Step 9: Post Execution Pipeline (R3.8)
      if (this.postExecutionPipeline) {
        const workflowResult = {
          sessionId: sessionId || '',
          success: true,
          plan,
          impactReport,
          reviewReport,
          patchResult,
          reflection,
          stateComparison,
        };
        await this.postExecutionPipeline.execute(workflowResult);
      }

      // Step 10: Complete Session
      ExecutionLogger.log('WORKFLOW', '-', '-', `Workflow completed successfully`, { sessionId });
      await this.sessionManager.completeSession(sessionId, `Workflow completed successfully`);

      if (!verificationSideEffects && preVerificationSideEffects.length > 0) {
        verificationSideEffects = buildSideEffectLedger({
          policy: executionMode === 'READ_ONLY' ? 'READ_ONLY' : 'CONTROLLED_MUTATION',
          effects: preVerificationSideEffects,
        });
      }

      return {
        sessionId,
        runId: correlationContext.runId,
        taskId: correlationContext.taskId,
        correlationContext,
        success: true,
        plan,
        impactReport,
        regressionPlan,
        reviewReport,
        patchResult,
        reflection,
        stateComparison,
        qualityProfile,
        productAnalysis,
        verificationReport,
        failureContract,
        touchedFiles,
        plannerContext,
        stepResults,
        todoVerification: mapVerificationToTodos({ plan, report: verificationReport }),
        repairAttemptHistory: repairHistory,
        executionMode,
        workspaceComparison,
        mutationLedger,
        todoVerificationReport,
        verificationSideEffects,
        repairExpansion,
        repairTarget,
        executedTodoPlan: plan?.todoPlan,
        acceptanceCriteria:
          options.originalAcceptanceCriteria ?? productAnalysis?.acceptanceCriteria,
      };

    } catch (error: any) {
      // Final Fail-Safe
      if (sessionId) {
        await this.sessionManager.failSession(sessionId, `Unexpected workflow error: ${error.message}`);
        reflection = await this.generateReflectionSafely(sessionId);
      }
      
      return {
        sessionId: sessionId || '',
        runId: correlationContext?.runId ?? ExecutionLogger.getRunId() ?? undefined,
        taskId: correlationContext?.taskId ?? ExecutionLogger.getTaskId() ?? undefined,
        correlationContext: correlationContext ?? ExecutionLogger.getContext() ?? undefined,
        success: false,
        plan,
        impactReport,
        regressionPlan,
        reviewReport,
        patchResult,
        reflection,
        abortedAt: abortedAt || 'unexpected',
        abortReason: error.message,
      };
    }
  }

  private async prepareEvidenceForContract(
    existing: any,
    intakeResult: any,
    preflightResult: any,
    plan: ExecutionPlan | null,
    extraScopeFiles: ReadonlyArray<string> = [],
  ): Promise<{ evidence: Evidence[]; hypothesesUpdated: any[]; stillMissing: any[] }> {
    let evidence: Evidence[] = Array.isArray(existing?.evidence) ? [...existing.evidence] : [];

    if (preflightResult?.inspection) {
      const inspectionEvidence = createInspectionEvidence(preflightResult.inspection);
      const seen = new Set(evidence.map(item => item.id));
      for (const item of inspectionEvidence) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        evidence.push(item);
      }
    }

    if (this.evidenceBuilder && plan && intakeResult?.intent) {
      const intentWithScope = {
        ...intakeResult.intent,
        initialScope: [
          ...(intakeResult.intent.initialScope ?? []),
          ...extraScopeFiles,
        ],
      };
      const scopeFiles = collectContractScopeFiles(intentWithScope, plan);
      const alreadyTargeted = new Set<string>();
      for (const item of evidence) {
        if (item.source) alreadyTargeted.add(item.source);
      }
      if (existing?.evidence?.length > 0 && Array.isArray(intakeResult.intent.initialScope)) {
        for (const file of intakeResult.intent.initialScope) alreadyTargeted.add(file);
      }
      const newTargets = scopeFiles.filter(file => !alreadyTargeted.has(file));
      if (newTargets.length > 0) {
        try {
          const extra = await this.evidenceBuilder.collect({
            evidenceTypes: ['FILE_EXISTS', 'FILE_CONTENT'] as ReadonlyArray<EvidenceType>,
            targets: newTargets,
          });
          evidence = [...evidence, ...extra.evidence];
          const confirmedCount = extra.evidence.filter((item: Evidence) => item.status === 'CONFIRMED').length;
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `EvidenceBuilder: plan-scope collected=${extra.evidence.length}, confirmed=${confirmedCount}`,
            { targets: newTargets, confirmedCount },
          );
        } catch (evidenceError: any) {
          ExecutionLogger.log(
            'PRE_EXECUTION',
            '-',
            '-',
            `EvidenceBuilder plan-scope collection failed (non-fatal): ${evidenceError?.message || String(evidenceError)}`,
            { error: evidenceError?.message },
          );
        }
      }
    }

    return {
      evidence,
      hypothesesUpdated: existing?.hypothesesUpdated ?? [],
      stillMissing: existing?.stillMissing ?? [],
    };
  }

  private async evaluateExecutionGateStage6(
    sessionId: string | null,
    plan: ExecutionPlan | null,
    executionContract: ExecutionContract | null,
    intakeResult: any,
    riskAssessment: RiskAssessment | null,
    evidenceResult: any,
    options: WorkflowOptions,
  ): Promise<string | null> {
    const fail = async (reasons: string[], evaluation?: GateEvaluation): Promise<string> => {
      if (sessionId) {
        try {
          await this.sessionManager.recordEvent(
            sessionId,
            'EXECUTION_BLOCKED',
            'Execution blocked: ' + reasons.join('; '),
            {
              contractId: executionContract?.id ?? null,
              planId: plan?.id ?? null,
              blockedReasons: reasons,
              severity: 'CRITICAL',
              gateDecision: evaluation?.decision ?? null,
            },
          );
        } catch (eventError: any) {
          // Event recording failure must not mask gate block.
        }
      }
      return 'Execution blocked: ' + reasons.join('; ');
    };

    const gate = this.executionGate;
    if (!gate) {
      return fail(['ContractBuilder active but ExecutionGate missing']);
    }

    if (!plan) {
      return fail(['ExecutionPlan missing']);
    }

    if (!executionContract) {
      return fail(['ExecutionContract missing']);
    }

    if (!executionContract.planId) {
      return fail(['ExecutionContract.planId missing']);
    }

    if (executionContract.planId !== plan.id) {
      return fail(['ExecutionContract.planId does not match ExecutionPlan.id']);
    }

    if (!executionContract.validated) {
      return fail(['ExecutionContract is not validated']);
    }

    if (!intakeResult?.intent) {
      return fail(['TaskIntent missing for gate evaluation']);
    }

    if (!riskAssessment) {
      return fail(['RiskAssessment missing for gate evaluation']);
    }

    if (!evidenceResult?.evidence) {
      return fail(['Evidence missing for gate evaluation']);
    }

    let userConfirmed = false;
    if (options.confirmationRequestId && this.confirmationService) {
      const val = await this.confirmationService.validateDecision(options.confirmationRequestId, {
        taskId: sessionId ?? 'task',
        runId: sessionId ?? undefined,
        type: 'CONFIRMATION_REQUIRED',
        risk: riskAssessment.level,
        requestedAction: 'EXECUTE_PLAN',
        affectedFiles: executionContract.filesInScope,
      });
      if (val.valid) {
        userConfirmed = true;
      }
    }

    const buildGateInput = (confirmed: boolean): GateCheckInput =>
      Object.freeze({
        contract: Object.freeze({ ...executionContract }),
        intent: Object.freeze({ ...intakeResult.intent }),
        riskAssessment: Object.freeze({ ...riskAssessment }),
        evidence: Object.freeze([...evidenceResult.evidence]),
        critiqueResult: undefined,
        userConfirmed: confirmed,
      });

    let evaluation: GateEvaluation;
    try {
      evaluation = await gate.evaluate(buildGateInput(userConfirmed));
    } catch (gateError: any) {
      return fail(['ExecutionGate failed: ' + (gateError?.message || String(gateError))]);
    }

    if (sessionId) {
      try {
        await this.sessionManager.recordEvent(
          sessionId,
          'EXECUTION_GATE_EVALUATED',
          'Execution gate evaluated: decision=' + evaluation.decision,
          {
            contractId: executionContract.id,
            planId: plan.id,
            decision: evaluation.decision,
            riskLevel: evaluation.riskLevel,
            checksCount: evaluation.checks.length,
            blockedReasons: evaluation.blockedReasons,
            requiresConfirmation: evaluation.requiresConfirmation,
          },
        );
      } catch (eventError: any) {
        // Event recording failure is non-fatal here.
      }
    }

    if (evaluation.decision === 'PROCEED_WITH_CONFIRMATION' || (!userConfirmed && evaluation.requiresConfirmation)) {
      let reqId = options.confirmationRequestId;
      if (!reqId && this.confirmationService) {
        try {
          const gateCorr = options.correlationContext ?? ExecutionLogger.getContext();
          const req = await this.confirmationService.createRequest({
            taskId: options.taskId ?? gateCorr?.taskId ?? (sessionId ? `task-${sessionId}` : 'task-unknown'),
            runId: options.runId ?? gateCorr?.runId ?? (sessionId ?? 'run-unknown'),
            type: 'CONFIRMATION_REQUIRED',
            reason: evaluation.blockedReasons.join('; ') || 'Execution gate requires user confirmation',
            risk: riskAssessment.level,
            requestedAction: 'EXECUTE_PLAN',
            affectedFiles: executionContract.filesInScope,
          });
          reqId = req.id;
        } catch {
          // If policy says hard block, it will fail below
        }
      }

      if (options.onConfirmationRequested && reqId && this.confirmationService) {
        const req = await this.confirmationService.getRequest(reqId);
        if (req) {
          const approved = await options.onConfirmationRequested(req);
          if (approved) {
            await this.confirmationService.approve(reqId, { actor: 'cli-user' });
            userConfirmed = true;
          } else {
            await this.confirmationService.reject(reqId, { actor: 'cli-user', reason: 'User rejected execution in prompt' });
            return fail(['CONFIRMATION_REJECTED: User rejected execution in prompt'], evaluation);
          }
        }
      }

      if (!userConfirmed) {
        return fail(['CONFIRMATION_REQUIRED: User confirmation required' + (reqId ? ` (request ${reqId})` : '')], evaluation);
      }

      // The gate was evaluated before the human answered, so its verdict still
      // carries the CONFIRMATION_REQUIRED reason. Re-evaluate with the approval in
      // hand; otherwise the stale evaluation blocks the run at the isBlocked check
      // below and the approval has no effect.
      try {
        evaluation = await gate.evaluate(buildGateInput(true));
      } catch (gateError: any) {
        return fail(
          ['ExecutionGate re-evaluation after confirmation failed: ' + (gateError?.message || String(gateError))],
          evaluation,
        );
      }
    }

    if (evaluation.decision === 'BLOCKED' || gate.isBlocked(evaluation)) {
      const reasons = evaluation.blockedReasons.length > 0
        ? [...evaluation.blockedReasons]
        : ['ExecutionGate decision is BLOCKED'];
      return fail(reasons, evaluation);
    }

    if (evaluation.decision === 'REQUIRES_SAFE_EXPERIMENT') {
      const experiment = this.safeExperiment;
      if (!experiment) {
        return fail(['SafeExperiment required but SafeExperiment missing'], evaluation);
      }

      const operations = options.patchRequest?.operations ?? [];
      if (operations.length === 0) {
        return fail(['SafeExperiment required but no authoritative patch operations are available'], evaluation);
      }

      try {
        const report = await experiment.run(executionContract, operations);
        if (report.recommendation !== 'APPLY') {
          return fail(['SafeExperiment recommendation: ' + report.recommendation], evaluation);
        }
      } catch (experimentError: any) {
        return fail(['SafeExperiment failed: ' + (experimentError?.message || String(experimentError))], evaluation);
      }
    }

    if (sessionId) {
      try {
        await this.sessionManager.recordEvent(
          sessionId,
          'EXECUTION_ALLOWED',
          'Execution allowed: decision=' + evaluation.decision,
          {
            contractId: executionContract.id,
            planId: plan.id,
            decision: evaluation.decision,
          },
        );
      } catch (eventError: any) {
        // Event recording failure is non-fatal here.
      }
    }

    return null;
  }

  private unionRepairFiles(
    plan: ExecutionPlan,
    failureContract: FailureContract,
    originalTask: string,
    previousAttemptFiles?: ReadonlyArray<string>,
  ): ExecutionPlan {
    const scope = collectEffectiveRepairScope({
      originalTask,
      failureContract,
      plannerFiles: plan.steps.flatMap(step => step.expectedFiles ?? []),
      previousAttemptFiles,
    });
    return applyRepairScopeToPlan(plan, scope);
  }

  private finalizeRepairFailure(
    contract: FailureContract,
    plan: ExecutionPlan | null,
    stepResults: ReadonlyArray<StepResult> | undefined,
    verificationReport: VerificationReport | undefined,
    repairAttempt?: number,
  ): { failureContract: FailureContract; todoVerification: TodoVerificationTrace } {
    const enriched = enrichFailureContract({
      contract,
      plan,
      stepResults,
      attemptId: contract.attemptId ?? `attempt-${Math.max(1, repairAttempt || contract.attempt || 1)}`,
    });
    const prioritized = prioritizeFailures(enriched.failedChecks, enriched.acceptanceCriteria);
    ExecutionLogger.log(
      'FAILURE_PRIORITIZATION',
      'repair',
      '-',
      prioritized.map(item => `${item.order}:${item.classification}:${item.check.id}:rank=${item.rank}`).join(' | ') || '(none)',
      {
        attemptId: enriched.attemptId,
        failedTodoId: enriched.failedTodoId,
        failedStepId: enriched.failedStepId,
        failureIds: prioritized.map(item => item.check.id),
      },
    );
    const todoVerification = mapVerificationToTodos({
      plan,
      report: verificationReport,
      checks: enriched.failedChecks,
    });
    ExecutionLogger.log(
      'REPAIR_RESULT',
      'repair',
      '-',
      `verification=${todoVerification.scope} failedTodoId=${enriched.failedTodoId ?? '(unknown)'}`,
      {
        attemptId: enriched.attemptId,
        failedTodoId: enriched.failedTodoId,
        todoIds: todoVerification.verdicts.map(item => item.todoId),
        failureIds: enriched.failedChecks.map(check => check.id),
        verificationScope: todoVerification.scope,
        verdicts: todoVerification.verdicts,
      },
    );
    return { failureContract: enriched, todoVerification };
  }

  private async generateReflectionSafely(sessionId: string | null): Promise<any> {
    if (!sessionId) return null;
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (session) {
        const reflection = this.reflectionEngine.generate(session);
        await this.sessionManager.recordReflection(sessionId, reflection);
        return reflection;
      }
    } catch (error: any) {
      console.warn(`[Workflow] Reflection generation failed: ${error.message}`);
    }
    return null;
  }

  private createFailedResult(
    sessionId: string | null,
    reason: string,
    plan: ExecutionPlan | null = null,
    impactReport: any = null,
    reviewReport: any = null,
    patchResult: any = null,
    reflection: any = null,
    abortedAt: string = 'workflow',
    abortReason: string = '',
    extras?: {
      qualityProfile?: QualityProfile;
      productAnalysis?: ProductAnalysis;
      verificationReport?: VerificationReport;
      failureContract?: FailureContract;
      touchedFiles?: ReadonlyArray<string>;
      plannerContext?: PlannerContext;
      stepResults?: ReadonlyArray<StepResult>;
      todoVerification?: TodoVerificationTrace;
      repairAttemptHistory?: RepairAttemptHistory;
      repairOutcome?: RepairSafetyState;
      regressionPlan?: RegressionPlan | null;
      stateComparison?: StateComparison;
      executionMode?: ExecutionMode;
      workspaceComparison?: WorkspaceComparison;
      mutationLedger?: MutationLedger;
      todoVerificationReport?: TodoVerificationReport;
      verificationSideEffects?: VerificationSideEffectLedger;
      repairExpansion?: RepairExpansionRecord;
      repairTarget?: RepairTargetRecord;
      executedTodoPlan?: TodoPlan;
      acceptanceCriteria?: ReadonlyArray<string>;
      confirmationRequestId?: string;
      correlationContext?: CorrelationContext;
      runId?: string;
      taskId?: string;
    }
  ): WorkflowResult {
    return {
      sessionId: sessionId || '',
      runId: extras?.runId ?? extras?.correlationContext?.runId ?? ExecutionLogger.getRunId() ?? undefined,
      taskId: extras?.taskId ?? extras?.correlationContext?.taskId ?? ExecutionLogger.getTaskId() ?? undefined,
      correlationContext: extras?.correlationContext ?? ExecutionLogger.getContext() ?? undefined,
      success: false,
      plan,
      impactReport,
      regressionPlan: extras?.regressionPlan ?? (impactReport?.analysis ? null : undefined),
      reviewReport,
      patchResult,
      reflection,
      // A failed run is exactly where wrong-file evidence matters most, so the
      // workspace comparison must survive the failure path (G.17).
      stateComparison: extras?.stateComparison,
      abortedAt,
      abortReason: abortReason || reason,
      qualityProfile: extras?.qualityProfile,
      productAnalysis: extras?.productAnalysis,
      verificationReport: extras?.verificationReport,
      failureContract: extras?.failureContract,
      touchedFiles: extras?.touchedFiles,
      plannerContext: extras?.plannerContext,
      stepResults: extras?.stepResults,
      todoVerification: extras?.todoVerification,
      repairAttemptHistory: extras?.repairAttemptHistory,
      repairOutcome: extras?.repairOutcome,
      executionMode: extras?.executionMode,
      workspaceComparison: extras?.workspaceComparison,
      mutationLedger: extras?.mutationLedger,
      todoVerificationReport: extras?.todoVerificationReport,
      verificationSideEffects: extras?.verificationSideEffects,
      repairExpansion: extras?.repairExpansion,
      repairTarget: extras?.repairTarget,
      executedTodoPlan: extras?.executedTodoPlan ?? plan?.todoPlan,
      acceptanceCriteria: extras?.acceptanceCriteria,
      confirmationRequestId: extras?.confirmationRequestId,
    };
  }

  /**
   * R1.11: baseline for the run. Candidates are the planned files plus what
   * git already reports, which keeps the snapshot bounded and makes both
   * "intended file never changed" and "unrelated file changed" observable.
   */
  private async captureWorkspaceBaseline(
    executionMode: ExecutionMode,
    plan: ExecutionPlan | null,
    options: WorkflowOptions,
    preexistingDirtyFiles: ReadonlyArray<string>,
  ): Promise<WorkspaceSnapshot | undefined> {
    if (!this.workspacePath) return undefined;
    try {
      const snapshot = await this.workspaceSnapshotService.capture({
        phase: 'PRE',
        workspaceRoot: this.workspacePath,
        candidatePaths: await this.workspaceCandidatePaths(plan, options, preexistingDirtyFiles),
      });
      ExecutionLogger.log('WORKSPACE_SNAPSHOT', '-', '-', `Pre-execution snapshot: ${snapshot.files.length} files`, {
        executionMode,
        complete: snapshot.complete,
        skipped: snapshot.skippedPaths.length,
        hashAlgorithm: snapshot.budget.hashAlgorithm,
      });
      return snapshot;
    } catch (error: any) {
      ExecutionLogger.log('WORKSPACE_SNAPSHOT', '-', '-', `Pre-execution snapshot failed: ${error?.message}`, {
        executionMode,
      });
      return undefined;
    }
  }

  /** R1.12-R1.15: the after side of the comparison, for every execution path. */
  private async compareWorkspaceAfterExecution(
    before: WorkspaceSnapshot | undefined,
    plan: ExecutionPlan | null,
    options: WorkflowOptions,
    preexistingDirtyFiles: ReadonlyArray<string>,
  ): Promise<WorkspaceComparison | undefined> {
    if (!this.workspacePath) return undefined;
    const intendedFiles = this.intendedFiles(plan, options);
    if (!before) {
      return insufficientWorkspaceComparison(
        'no pre-execution workspace snapshot was captured',
        DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
        intendedFiles,
      );
    }
    try {
      const candidatePaths = [
        ...before.files.map(file => file.path),
        ...await this.workspaceCandidatePaths(plan, options, preexistingDirtyFiles),
      ];
      const after = await this.workspaceSnapshotService.capture({
        phase: 'POST',
        workspaceRoot: this.workspacePath,
        candidatePaths,
        budget: before.budget,
      });
      const comparison = compareWorkspaceSnapshots({
        before,
        after,
        intendedFiles,
        preExistingDirtyFiles: preexistingDirtyFiles,
      });
      ExecutionLogger.log('WORKSPACE_COMPARISON', '-', '-', `Workspace comparison: ${comparison.state}`, {
        intendedFiles: comparison.intendedFiles,
        actualChangedFiles: comparison.actualChangedFiles,
        unintendedChangedFiles: comparison.unintendedChangedFiles,
        missingExpectedChanges: comparison.missingExpectedChanges,
        preExistingDirtyFiles: comparison.preExistingDirtyFiles,
        wrongFileModification: comparison.wrongFileModification,
      });
      return comparison;
    } catch (error: any) {
      return insufficientWorkspaceComparison(
        `post-execution snapshot failed: ${error?.message}`,
        before.budget,
        intendedFiles,
      );
    }
  }

  private intendedFiles(plan: ExecutionPlan | null, options: WorkflowOptions): string[] {
    return uniqueSortedPaths([
      ...(plan?.steps.flatMap(step => step.expectedFiles ?? []) ?? []),
      ...(plan?.todoPlan?.todos.flatMap(todo => [...todo.files]) ?? []),
      ...(options.patchRequest?.operations.map(operation => operation.path) ?? []),
    ]);
  }

  private async workspaceCandidatePaths(
    plan: ExecutionPlan | null,
    options: WorkflowOptions,
    preexistingDirtyFiles: ReadonlyArray<string>,
  ): Promise<string[]> {
    let gitChanged: ReadonlyArray<string> = [];
    try {
      const status = await this.gitManager.status();
      gitChanged = status?.changedFiles ?? [];
    } catch {
      gitChanged = [];
    }
    return uniqueSortedPaths([
      ...this.intendedFiles(plan, options),
      ...(plan?.todoPlan?.affectedFiles ?? []),
      ...(options.targetFiles ?? []),
      ...preexistingDirtyFiles,
      ...gitChanged,
    ]);
  }

  private logTodoVerification(report: TodoVerificationReport): void {
    for (const verdict of report.verdicts) {
      ExecutionLogger.log('TODO_VERIFICATION', '-', '-', `${verdict.todoId} = ${verdict.verdict}`, {
        todoId: verdict.todoId,
        scope: verdict.scope,
        verdict: verdict.verdict,
        requiredChecks: verdict.requiredChecks,
        executedChecks: verdict.executedChecks,
        missingChecks: verdict.missingChecks,
        reason: verdict.reason,
      });
    }
  }

  private async collectTouchedFiles(previous?: ReadonlyArray<string>): Promise<string[]> {
    try {
      const status = await this.gitManager.status();
      return uniqueSortedPaths([...(previous ?? []), ...(status?.changedFiles ?? [])]);
    } catch {
      return uniqueSortedPaths(previous ?? []);
    }
  }
}

/**
 * Keeps the pre-R1 StateComparison consumers working while the richer
 * WorkspaceComparison becomes the source of truth. Only proven comparisons
 * produce a StateComparison, so an unproven run stays evidence-free.
 */
/**
 * The context reader throws on paths outside the workspace. A candidate that
 * tries to escape is simply not found, which keeps the expansion policy free
 * of error handling.
 */
/**
 * A repair whose plan validated cleanly has no findings and therefore no
 * record yet, but its completion verdict still has to be reported. This
 * supplies the objective-derived fields so outcome analysis is never dropped
 * for want of a prior finding.
 */
function emptyRepairTargetRecord(
  objective: RepairObjective,
  options: { readonly repairAttempt?: number },
): RepairTargetRecord {
  return Object.freeze({
    attemptId: `attempt-${(options.repairAttempt ?? 0) + 1}`,
    attemptNumber: (options.repairAttempt ?? 0) + 1,
    originalTask: objective.originalTask,
    acceptanceCriteria: objective.acceptanceCriteria,
    intent: objective.intent,
    intentConfidence: objective.intentConfidence,
    intentEvidence: objective.intentEvidence,
    originalTodoId: objective.originalTodoId,
    originalFiles: objective.originalFiles,
    primaryFailure: objective.primaryFailure,
    allowedFiles: objective.allowedFiles,
    allowedOperations: objective.allowedOperations,
    proposedFiles: Object.freeze([]),
    proposedOperations: Object.freeze([]),
    disallowedFiles: Object.freeze([]),
    decision: 'ALLOW' as const,
    decisionReason: 'Repair plan passed target validation',
    findings: Object.freeze([]),
  });
}

function safeProbe<T>(probe: () => T, fallback: T): T {
  try {
    return probe();
  } catch {
    return fallback;
  }
}

function toStateComparison(comparison: WorkspaceComparison): StateComparison | undefined {
  if (comparison.state !== 'PROVEN') return undefined;
  return Object.freeze({
    filesModified: Object.freeze(
      comparison.changes.filter(change => change.kind === 'MODIFIED').map(change => change.path),
    ),
    filesCreated: Object.freeze([...comparison.createdFiles]),
    filesDeleted: Object.freeze([...comparison.deletedFiles]),
    unexpectedChanges: Object.freeze([...comparison.unintendedChangedFiles]),
    hasUnexpectedChanges: comparison.unintendedChangedFiles.length > 0,
  });
}
