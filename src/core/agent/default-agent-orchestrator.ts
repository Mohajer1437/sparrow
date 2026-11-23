import { AgentOrchestrator } from '../../contracts/agent-orchestrator';
import { RoleRegistry } from '../../contracts/role-registry';
import { WorkflowOrchestrator } from '../../contracts/workflow-orchestrator';
import { AgentExecutionRequest, AgentExecutionResult } from '../../domain/agent-execution';
import { ConfigurationSnapshot } from '../../domain/configuration-snapshot';
import { RoleAssignmentRegistry } from '../../contracts/role-assignment-registry';
import { ModelRegistry } from '../../contracts/model-registry';
import { ProviderRegistry } from '../../contracts/provider-registry';
import { ExecutionLogger } from '../observability/execution-logger';
import { QualityPolicy } from '../../contracts/quality-policy';
import {
  RepairAttemptHistory,
  emptyRepairHistory,
  fingerprintRepairPlan,
  nextAttemptId,
} from '../../domain/repair-intelligence';
import { appendRepairAttempt } from '../repair/repair-attempt-history';
import { resolveRepairLimits } from '../repair/repair-limits';
import { contextRefsFromPlannerContext } from '../repair/context-refs';
import { ContextRef } from '../../domain/repair/context-expansion';
import { summarizeRepairExpansion } from '../../domain/repair/repair-expansion-record';
import { summarizeRepairTarget } from '../../domain/repair/repair-target-record';
import { TodoPlan } from '../../domain/todo-plan';
import { ImpactAnalysis } from '../../domain/impact-analysis';
import { MutationLedger } from '../../domain/execution/mutation-safety';

export class DefaultAgentOrchestrator implements AgentOrchestrator {
  constructor(
    private readonly roleRegistry: RoleRegistry,
    private readonly roleAssignmentRegistry: RoleAssignmentRegistry,
    private readonly modelRegistry: ModelRegistry,
    private readonly providerRegistry: ProviderRegistry,
    private readonly workflowOrchestrator: WorkflowOrchestrator,
    private readonly qualityPolicy?: QualityPolicy,
  ) {}

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const role = this.roleRegistry.get(request.roleId);
    
    if (!role) {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: `Role not found: ${request.roleId}`
      };
    }

    // Step 1: Resolve model from assignment or fallback to role configuration
    const assignment = this.roleAssignmentRegistry.get(request.roleId);
    ExecutionLogger.log('AGENT', request.roleId, '-', `Resolving model for role: ${request.roleId}`, { hasAssignment: !!assignment });
    let modelId: string | undefined;
    let providerId: string | undefined;

    if (assignment) {
      modelId = assignment.modelId;
      providerId = assignment.providerId;
    } else {
      // Fallback to RoleConfiguration (backward compatibility)
      modelId = role.modelId;
      providerId = role.providerId;
    }

    // Step 2: Validate model and provider exist
    if (!modelId || !providerId) {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: `No model assigned to role: ${request.roleId}. Either create a RoleAssignment or add modelId/providerId to RoleConfiguration.`
      };
    }

    const model = this.modelRegistry.get(modelId);
    if (!model) {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: `Model not found in registry: ${modelId}`
      };
    }

    if (model.availability !== 'available') {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: `Model not available: ${modelId} (status: ${model.availability})`
      };
    }

    if (!this.providerRegistry.has(providerId as any)) {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: `Provider not found: ${providerId}`
      };
    }

    // Step 3: Build configuration snapshot for traceability
    const configurationSnapshot: ConfigurationSnapshot = Object.freeze({
      roleId: request.roleId,
      modelId: modelId,
      providerId: providerId,
      assignmentSource: assignment ? (assignment.source ?? 'user') : 'fallback',
      toolPolicyId: role.toolPolicy ?? 'default',
      startedAt: new Date().toISOString(),
    });

    ExecutionLogger.log('AGENT', request.roleId, modelId ?? '-', `Starting workflow`, {
      providerId,
      assignmentSource: assignment?.source ?? 'fallback',
      task: request.task?.substring(0, 100),
    });

    // Step 3.5: Resolve planner model (may differ from coder model)
    const plannerAssignment = this.roleAssignmentRegistry.get('planner');
    const plannerModelId = plannerAssignment?.modelId ?? modelId;
    const plannerProviderId = plannerAssignment?.providerId ?? providerId;
    if (plannerAssignment) {
      ExecutionLogger.log('AGENT', 'planner', plannerModelId ?? '-', 'Planner model resolved', {
        providerId: plannerProviderId,
        assignmentSource: plannerAssignment.source ?? 'user',
      });
    }

    // Step 4: Execute workflow with validated model, repairing via Planner on V&V failure.
    try {
      const limits = resolveRepairLimits(this.qualityPolicy);
      const maxRepairs = limits.maxRepairAttempts;
      let repairAttempt = 0;
      let expansionLevel = 0;
      let failureContract = undefined;
      let workflowResult;
      let previouslyTouchedFiles: string[] = [];
      let repairHistory: RepairAttemptHistory = emptyRepairHistory();
      // R3: carried between attempts so the next repair can tell what it
      // already knows from what it still needs.
      let previousImpactAnalysis: ImpactAnalysis | undefined;
      let previousMutationLedger: MutationLedger | undefined;
      let previousContextRefs: ReadonlyArray<ContextRef> = [];
      let previousExpansionYieldedEvidence: boolean | undefined;
      let duplicatePlan = false;
      // R4.2/R4.3: captured from the first attempt and then held constant.
      // Repair is judged against the plan and criteria that actually failed,
      // so a later attempt cannot regenerate a narrower scope or easier
      // criteria for itself to satisfy.
      let originalTodoPlan: TodoPlan | undefined;
      let originalAcceptanceCriteria: ReadonlyArray<string> | undefined;
      let missingExpectedChanges: ReadonlyArray<string> = [];
      let unintendedChangedFiles: ReadonlyArray<string> = [];
      while (true) {
        workflowResult = await this.workflowOrchestrator.execute({
          task: request.task,
          targetFiles: request.targetFiles,
          patchRequest: request.patchRequest,
          providerId: providerId,
          modelId: modelId,
          plannerProviderId: plannerProviderId,
          plannerModelId: plannerModelId,
          memoryContext: role.promptTemplate,
          configurationSnapshot,
          qualityProfile: this.qualityPolicy?.profile,
          failureContract,
          repairAttempt,
          previouslyTouchedFiles,
          repairAttemptHistory: repairHistory,
          repairExpansionLevel: expansionLevel,
          executionMode: request.executionMode,
          // R6: authoritative run correlation context
          correlationContext: request.correlationContext,
          taskId: request.taskId,
          runId: request.runId,
          sessionId: request.sessionId,
          // R3: evidence from the attempt that failed. Expansion is decided
          // inside the run from these, not from a retry counter.
          repairImpactAnalysis: previousImpactAnalysis,
          repairMutationLedger: previousMutationLedger,
          repairPreviousContext: previousContextRefs,
          repairDuplicatePlan: duplicatePlan,
          repairPreviousExpansionYieldedEvidence: previousExpansionYieldedEvidence,
          // R4: the original objective, carried rather than reconstructed.
          originalTodoPlan,
          originalAcceptanceCriteria,
          repairMissingExpectedChanges: missingExpectedChanges,
          repairUnintendedChangedFiles: unintendedChangedFiles,
          // R5: confirmation options
          confirmationRequestId: request.confirmationRequestId,
          onConfirmationRequested: request.onConfirmationRequested,
        });
        // R1 repair integration: reliable workspace mismatch evidence reaches
        // the next attempt's context, so repair sees both the file that should
        // have changed and the file that actually did.
        // R4.3: only the first attempt defines the original scope. Later
        // attempts plan repairs, and a repair plan must never become the
        // yardstick that the next repair is measured against.
        if (originalTodoPlan === undefined && workflowResult.executedTodoPlan) {
          originalTodoPlan = workflowResult.executedTodoPlan;
        }
        if (originalAcceptanceCriteria === undefined) {
          const criteria =
            workflowResult.acceptanceCriteria ?? workflowResult.productAnalysis?.acceptanceCriteria;
          if (criteria) originalAcceptanceCriteria = criteria;
        }

        const comparison = workflowResult.workspaceComparison;
        if (comparison?.state === 'PROVEN') {
          missingExpectedChanges = comparison.missingExpectedChanges;
          unintendedChangedFiles = comparison.unintendedChangedFiles;
        }
        previouslyTouchedFiles = uniqueTouched(
          previouslyTouchedFiles,
          [
            ...(workflowResult.touchedFiles ?? []),
            ...(comparison?.state === 'PROVEN'
              ? [...comparison.unintendedChangedFiles, ...comparison.missingExpectedChanges]
              : []),
          ],
        );
        // R3: the run itself decided whether context could grow, so the loop
        // adopts the level that was actually used rather than guessing one.
        const expansion = workflowResult.repairExpansion;
        if (expansion) {
          expansionLevel = expansion.expansionLevel;
          previousExpansionYieldedEvidence = expansion.contextDelta?.hasNewEvidence;
          ExecutionLogger.log('REPAIR_CONTEXT_EXPANSION', 'planner', plannerModelId ?? '-',
            summarizeRepairExpansion(expansion),
            {
              attemptId: expansion.attemptId,
              decision: expansion.decision,
              expansionLevel: expansion.expansionLevel,
              stopCode: expansion.stopCode,
              selectedFiles: expansion.selectedFiles,
            });
        }
        previousImpactAnalysis = workflowResult.impactReport?.analysis ?? previousImpactAnalysis;
        previousMutationLedger = workflowResult.mutationLedger ?? previousMutationLedger;
        const gatheredRefs = contextRefsFromPlannerContext(workflowResult.plannerContext);
        if (gatheredRefs.length > 0) previousContextRefs = gatheredRefs;

        if (workflowResult.success) {
          return {
            roleId: request.roleId,
            success: true,
            workflowResult,
            correlationContext: request.correlationContext ?? workflowResult.correlationContext,
            runId: request.runId ?? workflowResult.runId,
          };
        }

        const outcome = workflowResult.repairOutcome;
        // R4.11/R4.22/R4.27: a repair the target policy refused is terminal.
        // Retrying it would only invite the model to find another way to make
        // the symptom disappear, so the loop stops and reports why.
        if (
          outcome === 'REPAIR_TARGET_REJECTED'
          || outcome === 'REPAIR_ACCEPTANCE_CHASING'
          || outcome === 'REPAIR_NEEDS_CONFIRMATION'
        ) {
          const target = workflowResult.repairTarget;
          ExecutionLogger.log('REPAIR_STOP', 'planner', plannerModelId ?? '-',
            target ? summarizeRepairTarget(target) : String(outcome), {
              attemptId: target?.attemptId,
              outcome,
              findings: target?.findings.map(item => `${item.kind}:${item.subject}`) ?? [],
              decision: target?.decision,
            });
          return {
            roleId: request.roleId,
            success: false,
            workflowResult,
            error: workflowResult.abortReason || outcome,
            correlationContext: request.correlationContext ?? workflowResult.correlationContext,
            runId: request.runId ?? workflowResult.runId,
          };
        }
        if (outcome === 'BLOCKED' || outcome === 'NEEDS_CONTEXT' || outcome === 'NEEDS_CONFIRMATION') {
          return {
            roleId: request.roleId,
            success: false,
            workflowResult,
            error: workflowResult.abortReason || outcome,
            correlationContext: request.correlationContext ?? workflowResult.correlationContext,
            runId: request.runId ?? workflowResult.runId,
          };
        }

        if (outcome === 'REPAIR_LIMIT_REACHED' || (workflowResult.abortReason || '').includes('REPAIR_LIMIT_REACHED')) {
          return {
            roleId: request.roleId,
            success: false,
            workflowResult: {
              ...workflowResult,
              abortReason: 'REPAIR_LIMIT_REACHED',
              repairOutcome: 'REPAIR_LIMIT_REACHED',
            },
            error: 'REPAIR_LIMIT_REACHED',
            correlationContext: request.correlationContext ?? workflowResult.correlationContext,
            runId: request.runId ?? workflowResult.runId,
          };
        }

        if (outcome === 'DUPLICATE_REPAIR_PLAN') {
          // R3.11/R3.19: a repeated plan buys exactly one bounded retry, and
          // only when the run has somewhere evidence-backed left to look. A
          // second identical plan, or an expansion that changed nothing, is a
          // blind retry and must stop instead.
          const alreadyRetriedForDuplicate = duplicatePlan;
          const canExpandFurther = expansionLevel < limits.maxContextExpansion;
          const lastExpansionHelped = previousExpansionYieldedEvidence !== false;
          if (!alreadyRetriedForDuplicate && canExpandFurther && lastExpansionHelped) {
            duplicatePlan = true;
            ExecutionLogger.log('REPAIR_ATTEMPT', 'planner', plannerModelId ?? '-',
              'Duplicate repair plan; one bounded expansion attempt permitted', {
                attemptId: nextAttemptId(repairHistory),
                failedTodoId: workflowResult.failureContract?.failedTodoId,
                expansionLevel,
              });
            continue;
          }
          ExecutionLogger.log('REPAIR_STOP', 'planner', plannerModelId ?? '-',
            'No blind retry: repair plan repeated with no new evidence to plan from', {
              attemptId: nextAttemptId(repairHistory),
              expansionLevel,
              stopCode: alreadyRetriedForDuplicate ? 'NO_NEW_EVIDENCE' : 'EXPANSION_LIMIT_REACHED',
              previousExpansionYieldedEvidence,
            });
          return {
            roleId: request.roleId,
            success: false,
            workflowResult: {
              ...workflowResult,
              abortReason: 'REPAIR_LIMIT_REACHED',
              repairOutcome: 'REPAIR_LIMIT_REACHED',
            },
            error: 'REPAIR_LIMIT_REACHED',
          };
        }

        if (!workflowResult.failureContract) {
          return {
            roleId: request.roleId,
            success: false,
            workflowResult,
            error: workflowResult.abortReason,
          };
        }

        repairHistory = appendRepairAttempt(repairHistory, {
          kind: repairAttempt > 0 ? 'REPAIR' : 'ORIGINAL',
          failedTodoId: workflowResult.failureContract.failedTodoId,
          failedStepId: workflowResult.failureContract.failedStepId,
          todoIds: workflowResult.plan?.todoPlan?.todos.map(todo => todo.id)
            ?? workflowResult.plan?.steps.map(step => step.id)
            ?? [],
          planFingerprint: fingerprintRepairPlan(workflowResult.plan?.todoPlan ?? workflowResult.plan ?? { affectedFiles: [], todos: [] }),
          expected: workflowResult.failureContract.expectation?.expectedBehavior
            ?? workflowResult.failureContract.primaryFailure?.expectedBehavior,
          actual: workflowResult.failureContract.actual?.actualBehavior
            ?? workflowResult.failureContract.primaryFailure?.actualBehavior,
          filesTouched: workflowResult.touchedFiles ?? [],
          verificationPassed: workflowResult.verificationReport?.passed,
          verificationScope: workflowResult.todoVerification?.scope ?? 'WHOLE_RUN',
          failureContractId: workflowResult.failureContract.id,
          evidenceRefs: workflowResult.failureContract.evidenceRefs
            ?? workflowResult.failureContract.failedChecks.map(check => check.id),
          expansionLevel,
          outcome: 'FAILED',
          contextFingerprint: workflowResult.repairExpansion?.contextFingerprint,
          contextDelta: workflowResult.repairExpansion?.contextDelta,
          expansionReason: workflowResult.repairExpansion?.reason,
        });

        const completedRepairs = repairHistory.attempts.filter(item => item.kind === 'REPAIR').length;
        if (repairAttempt >= maxRepairs || completedRepairs >= maxRepairs) {
          return {
            roleId: request.roleId,
            success: false,
            workflowResult: {
              ...workflowResult,
              abortReason: 'REPAIR_LIMIT_REACHED',
              repairOutcome: 'REPAIR_LIMIT_REACHED',
              repairAttemptHistory: repairHistory,
            },
            error: 'REPAIR_LIMIT_REACHED',
          };
        }

        repairAttempt += 1;
        failureContract = workflowResult.failureContract;
        ExecutionLogger.log('AGENT', 'planner', plannerModelId ?? '-', 'V&V failure contract returned to planner for repair', {
          attempt: repairAttempt,
          attemptId: failureContract.attemptId,
          failedTodoId: failureContract.failedTodoId,
          summary: failureContract.summary,
        });
        ExecutionLogger.log('REPAIR_ATTEMPT', 'planner', plannerModelId ?? '-', `Starting repair attempt ${repairAttempt}`, {
          attemptId: `attempt-${repairHistory.attempts.length + 1}`,
          failedTodoId: failureContract.failedTodoId,
          todoIds: workflowResult.plan?.todoPlan?.todos.map(todo => todo.id) ?? [],
          failureIds: failureContract.failedChecks.map(check => check.id),
        });
      }
    } catch (error: any) {
      return {
        roleId: request.roleId,
        success: false,
        workflowResult: null,
        error: error.message,
      };
    }
  }
}

function uniqueTouched(
  previous: ReadonlyArray<string>,
  extra?: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of [...previous, ...(extra ?? [])]) {
    const normalized = file.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
