import { WorkflowResult } from '../contracts/workflow-orchestrator';
import { FailureContract, IncidentalFailure, SecondaryFailure } from '../domain/failure-contract';
import { GatheredContext } from '../domain/gathered-context';
import { ImpactReport } from '../domain/impact-analysis';
import { RegressionPlan } from '../domain/regression-plan';
import { PlannerContext, formatPlannerContextSummary } from '../domain/planner-context';
import { RepairLimits, TodoVerificationTrace } from '../domain/repair-intelligence';
import { RepairExpansionRecord } from '../domain/repair/repair-expansion-record';
import { RepairTargetRecord } from '../domain/repair/repair-target-record';
import {
  TaskRunConfirmationView,
  TaskRunContextContent,
  TaskRunContextItem,
  TaskRunFailure,
  TaskRunFailureItem,
  TaskRunImpactAnalysis,
  TaskRunRegressionPlan,
  TaskRunExpansionView,
  TaskRunRepairTargetView,
  TaskRunRepair,
  TaskRunSideEffects,
  TaskRunSkill,
  TaskRunSnapshot,
  TaskRunTodoVerification,
  TaskRunWorkspaceComparison,
  TaskRunMutationSafety,
  TaskRunStatus,
  TaskRunStep,
  TaskRunTodoVerdict,
  TaskRunVerification,
  TaskRunWorkspaceIntegrity,
  repairAttemptToView,
} from '../domain/task-run';
import { redactText, redactValue } from './secret-redaction';
import { ExecutionMode } from '../domain/execution-mode';
import { computeRunFingerprint } from '../domain/correlation';
import { buildTaskOutcomeSummary } from './outcome-summary-builder';
import { FinalTruth, mapFinalTruthToTaskRunStatus } from '../domain/final-truth';

const MAX_CONTEXT_PREVIEW_BYTES = 64 * 1024;

export interface TaskRunProjectionInput {
  readonly taskId: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly fingerprint?: string;
  readonly logFileName?: string;
  readonly logFilePath?: string;
  readonly task: string;
  readonly roleId: string;
  readonly workspaceRoot: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly logSessionId?: string;
  readonly success: boolean;
  readonly error?: string;
  readonly workflowResult?: WorkflowResult | null;
  readonly repairLimits?: RepairLimits;
  /** Known before the workflow returns, so an in-flight run already shows its mode. */
  readonly executionMode?: ExecutionMode;
  /** PHASE-09 single authority */
  readonly finalTruth?: FinalTruth;
}

/**
 * Projects the Core's workflow result into the observer read model.
 *
 * Nothing here reinterprets a verdict: `repairOutcome`, verification scope and
 * failure classification are copied as the Core reported them, and anything the
 * Core does not know is left undefined rather than guessed.
 */
export function projectTaskRun(input: TaskRunProjectionInput): TaskRunSnapshot {
  const wf = input.workflowResult ?? undefined;
  const plannerContext = wf?.plannerContext;
  const finalTruth = input.finalTruth;
  const status = finalTruth
    ? (mapFinalTruthToTaskRunStatus(finalTruth.status) as TaskRunStatus)
    : deriveTerminalStatus(input.success, wf);
  const runId = input.runId
    ?? wf?.runId
    ?? wf?.correlationContext?.runId
    ?? wf?.sessionId
    ?? input.sessionId
    ?? input.logSessionId
    ?? 'LEGACY_UNKNOWN';
  const sessionId = input.sessionId
    ?? wf?.correlationContext?.sessionId
    ?? wf?.sessionId
    ?? input.logSessionId;
  const fingerprint = input.fingerprint
    ?? computeRunFingerprint(input.taskId, runId, input.startedAt);
  const attemptCount = wf?.repairAttemptHistory?.attempts.length ?? 1;

  const snapshot: TaskRunSnapshot = {
    taskId: input.taskId,
    runId,
    sessionId,
    logSessionId: input.logSessionId ?? sessionId,
    logFileName: input.logFileName,
    logFilePath: input.logFilePath,
    fingerprint,
    attemptCount,
    task: redactText(input.task),
    roleId: input.roleId,
    workspaceRoot: input.workspaceRoot,
    status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    domain: plannerContext?.projectProfile.projectType,
    project: plannerContext
      ? {
        workspaceRoot: plannerContext.projectProfile.workspaceRoot,
        projectType: plannerContext.projectProfile.projectType,
        detectedFrameworks: [...plannerContext.projectProfile.detectedFrameworks],
        languages: [...plannerContext.projectProfile.languages],
        packageManager: plannerContext.projectProfile.packageManager,
        availableTestingTools: [...plannerContext.projectProfile.availableTestingTools],
        detectedDomains: [...plannerContext.projectProfile.detectedDomains],
        capabilities: [...plannerContext.projectProfile.capabilities],
      }
      : undefined,
    executionDirective: plannerContext
      ? {
        explicitSkillIds: [...(plannerContext.executionDirective.explicitSkillIds ?? [])],
        requestedDomains: [...(plannerContext.executionDirective.requestedDomains ?? [])],
      }
      : undefined,
    skills: plannerContext ? projectSkills(plannerContext) : [],
    contextStrategy: plannerContext
      ? {
        repairMode: plannerContext.strategy.repairMode,
        selectedSources: [...plannerContext.strategy.selectedSources],
        requiredSources: [...plannerContext.strategy.requiredSources],
        optionalSources: [...plannerContext.strategy.optionalSources],
        excludedSources: [...plannerContext.strategy.excludedSources],
        deferredSources: [...plannerContext.strategy.deferredSources],
        missingRequired: [...plannerContext.strategy.missingRequired],
        missingOptional: [...plannerContext.strategy.missingOptional],
        reasoning: [...plannerContext.strategy.reasoning],
      }
      : undefined,
    versionIntelligence: plannerContext?.versionIntelligence
      ? {
        summary: plannerContext.versionIntelligence.summary,
        dependenciesCount: plannerContext.versionIntelligence.dependencies.length,
        effectiveKnowledgeCount: plannerContext.versionIntelligence.effectiveKnowledge.length,
        items: plannerContext.versionIntelligence.effectiveKnowledge.map(ek => ({
          technology: ek.technology,
          declaredVersion: ek.declaredVersion,
          resolvedVersion: ek.resolvedVersion,
          normalizedVersion: ek.normalizedVersion,
          versionSource: ek.versionSource,
          status: ek.status,
          effectiveSource: ek.effectiveSource,
          summary: ek.summary,
          provenance: ek.provenance,
          overridePath: ek.overridePath,
          staleReason: ek.staleReason,
          conflictReason: ek.conflictReason,
        })),
        staleCount: plannerContext.versionIntelligence.staleItems.length,
        conflictCount: plannerContext.versionIntelligence.conflicts.length,
      }
      : undefined,
    contextTotals: plannerContext
      ? {
        records: plannerContext.gathered.records.length,
        fileCount: plannerContext.gathered.fileCount,
        totalBytes: plannerContext.gathered.totalBytes,
        truncatedCount: plannerContext.gathered.truncatedCount,
        limitReached: plannerContext.gathered.limitReached,
      }
      : undefined,
    context: plannerContext ? projectContextItems(plannerContext.gathered) : [],
    plannerContextSummary: plannerContext ? formatPlannerContextSummary(plannerContext) : undefined,
    todoPlan: wf?.plan?.todoPlan ? redactValue(wf.plan.todoPlan) : undefined,
    impactAnalysis: projectImpactAnalysis(wf?.impactReport ?? undefined),
    regressionPlan: projectRegressionPlan(wf?.regressionPlan ?? undefined),
    execution: projectExecution(wf),
    touchedFiles: [...(wf?.touchedFiles ?? [])],
    workspaceIntegrity: projectWorkspaceIntegrity(wf),
    executionMode: wf?.executionMode ?? input.executionMode,
    workspaceComparison: projectWorkspaceComparison(wf),
    mutationSafety: projectMutationSafety(wf),
    todoVerification: projectTodoVerification(wf),
    verificationSideEffects: projectSideEffects(wf),
    verification: projectVerification(wf),
    failure: wf?.failureContract ? projectFailure(wf.failureContract) : undefined,
    repair: projectRepair(wf, input.repairLimits),
    confirmation: projectConfirmation(wf),
    abortedAt: wf?.abortedAt,
    abortReason: wf?.abortReason,
    error: input.error ? redactText(input.error) : undefined,
    finalTruth: input.finalTruth,
  };

  const outcomeSummary = buildTaskOutcomeSummary(snapshot);
  const finalSnapshot: TaskRunSnapshot = {
    ...snapshot,
    outcomeSummary,
  };

  return redactValue(finalSnapshot);
}

/**
 * Context bodies live outside the snapshot so list and detail views can stay
 * cheap; only the explicit context-item view reads this file.
 */
export function projectContextContent(
  taskId: string,
  gathered: GatheredContext | undefined,
): TaskRunContextContent {
  const items: TaskRunContextContent['items'] = (gathered?.records ?? [])
    .map((record, index) => ({ record, index }))
    .filter(entry => typeof entry.record.content === 'string')
    .map(entry => {
      const raw = entry.record.content as string;
      const capped = raw.length > MAX_CONTEXT_PREVIEW_BYTES;
      return {
        index: entry.index,
        reference: entry.record.reference,
        content: redactText(capped ? raw.slice(0, MAX_CONTEXT_PREVIEW_BYTES) : raw),
        truncatedForDisplay: capped,
      };
    });
  return { taskId, items };
}

export function deriveTerminalStatus(
  success: boolean,
  wf: WorkflowResult | undefined,
  finalTruth?: FinalTruth,
): TaskRunStatus {
  // PHASE-09: FinalTruth is authoritative when present.
  if (finalTruth) {
    return mapFinalTruthToTaskRunStatus(finalTruth.status) as TaskRunStatus;
  }
  if (success) return 'COMPLETED';
  const outcome = wf?.repairOutcome;
  if (outcome === 'BLOCKED' || outcome === 'NEEDS_CONTEXT' || outcome === 'NEEDS_CONFIRMATION') {
    return 'BLOCKED';
  }
  const reason = (wf?.abortReason || '').toUpperCase();
  if (
    reason.includes('BLOCKED') ||
    reason.includes('PLANNER_UNGROUNDED_TARGET') ||
    reason.includes('TARGET_NOT_FOUND') ||
    reason.includes('CONFIRMATION_REQUIRED') ||
    reason.includes('CLARIFICATION') ||
    reason.includes('WORKSPACE_MISMATCH')
  ) {
    return 'BLOCKED';
  }
  return 'FAILED';
}

function projectSkills(context: PlannerContext): ReadonlyArray<TaskRunSkill> {
  const reasonById = new Map(context.resolvedSkills.reasons.map(reason => [reason.skillId, reason]));
  return context.resolvedSkills.skills.map(skill => {
    const reason = reasonById.get(skill.id);
    return {
      id: skill.id,
      name: skill.name,
      domain: skill.domain,
      domains: [...skill.applicability.domains],
      frameworks: [...(skill.applicability.frameworks ?? [])],
      requiredChecks: [...skill.verificationRules.requiredChecks],
      planningConstraints: [...skill.planningRules.constraints],
      resolutionSource: reason?.source,
      resolutionDetail: reason?.detail,
    };
  });
}

function projectContextItems(gathered: GatheredContext): ReadonlyArray<TaskRunContextItem> {
  return gathered.records.map((record, index) => ({
    index,
    source: record.source,
    reference: record.reference,
    status: record.status,
    reason: record.reason,
    collectionMethod: record.collectionMethod,
    priority: record.priority,
    sizeBytes: record.sizeBytes,
    truncated: record.truncated,
    hasContent: typeof record.content === 'string',
    error: record.error,
    failureRole: record.metadata?.failureRole,
    cacheHit: record.metadata?.cacheHit,
  }));
}

function projectExecution(wf: WorkflowResult | undefined): ReadonlyArray<TaskRunStep> {
  const steps = wf?.plan?.steps ?? [];
  const resultById = new Map((wf?.stepResults ?? []).map(result => [result.stepId, result]));
  const projected: TaskRunStep[] = steps.map(step => {
    const result = resultById.get(step.id);
    return {
      stepId: step.id,
      sourceTodoId: step.sourceTodoId,
      type: step.type,
      description: step.description,
      expectedOutcome: step.expectedOutcome,
      requiredTools: [...step.requiredTools],
      files: [...(step.expectedFiles ?? [])],
      status: result ? (result.success ? 'SUCCEEDED' : 'FAILED') : 'PENDING',
      completedAt: result?.completedAt,
      error: result?.error,
    };
  });

  // Step results without a matching plan step still belong in the timeline.
  const knownIds = new Set(steps.map(step => step.id));
  for (const result of wf?.stepResults ?? []) {
    if (knownIds.has(result.stepId)) continue;
    projected.push({
      stepId: result.stepId,
      requiredTools: [],
      files: [],
      status: result.success ? 'SUCCEEDED' : 'FAILED',
      completedAt: result.completedAt,
      error: result.error,
    });
  }
  return projected;
}

function projectWorkspaceIntegrity(
  wf: WorkflowResult | undefined,
): TaskRunWorkspaceIntegrity | undefined {
  const comparison = wf?.stateComparison;
  if (!comparison) return undefined;
  return {
    filesModified: [...comparison.filesModified],
    filesCreated: [...comparison.filesCreated],
    filesDeleted: [...comparison.filesDeleted],
    unexpectedChanges: [...comparison.unexpectedChanges],
    hasUnexpectedChanges: comparison.hasUnexpectedChanges,
  };
}

function projectVerification(wf: WorkflowResult | undefined): TaskRunVerification | undefined {
  const report = wf?.verificationReport;
  if (!report) return undefined;
  const trace = wf?.todoVerification;
  return {
    id: report.id,
    qualityProfile: report.qualityProfile,
    passed: report.passed,
    scope: trace?.scope ?? 'WHOLE_RUN',
    checks: (report.checks ?? []).map(check => ({
      id: check.id,
      name: check.name,
      category: check.category,
      severity: check.severity,
      passed: check.passed,
      evidence: check.evidence,
      acceptanceCriterion: check.acceptanceCriterion,
    })),
    evidence: report.evidence ? [...report.evidence] : [],
    todoVerdicts: projectTodoVerdicts(trace, wf),
  };
}

/** Copies the comparison verbatim; an absent comparison stays absent (R1.12). */
function projectWorkspaceComparison(
  wf: WorkflowResult | undefined,
): TaskRunWorkspaceComparison | undefined {
  const comparison = wf?.workspaceComparison;
  if (!comparison) return undefined;
  return {
    state: comparison.state,
    basis: comparison.basis,
    intendedFiles: [...comparison.intendedFiles],
    intendedChangedFiles: [...comparison.intendedChangedFiles],
    actualChangedFiles: [...comparison.actualChangedFiles],
    unintendedChangedFiles: [...comparison.unintendedChangedFiles],
    missingExpectedChanges: [...comparison.missingExpectedChanges],
    preExistingDirtyFiles: [...comparison.preExistingDirtyFiles],
    createdFiles: [...comparison.createdFiles],
    deletedFiles: [...comparison.deletedFiles],
    wrongFileModification: comparison.wrongFileModification,
  };
}

/**
 * R2.18/R2.23: copies mutation evidence verbatim. An absent ledger stays
 * absent so a pre-R2 run is never read as "zero mutation problems".
 */
function projectMutationSafety(
  wf: WorkflowResult | undefined,
): TaskRunMutationSafety | undefined {
  const ledger = wf?.mutationLedger;
  if (!ledger) return undefined;
  return {
    mutationAttempts: ledger.mutationAttempts,
    successfulMutations: ledger.successfulMutations,
    rejectedMutations: ledger.rejectedMutations,
    blockedMutations: ledger.blockedMutations,
    rolledBackMutations: ledger.rolledBackMutations,
    failedMutations: ledger.failedMutations,
    syntaxFailures: ledger.syntaxFailures,
    unexpectedDiffs: ledger.unexpectedDiffs,
    expectedChangeFailures: ledger.expectedChangeFailures,
    rollbackFailures: ledger.rollbackFailures,
    outOfScopeAttempts: ledger.outOfScopeAttempts,
    mutations: ledger.results.map(result => ({
      path: result.path,
      operation: result.operation,
      toolName: result.toolName,
      status: result.status,
      decision: result.decision,
      beforeHash: result.beforeHash,
      afterHash: result.afterHash,
      changed: result.changed,
      syntaxValid: result.syntaxValid,
      expectedChangePresent: result.expectedChangePresent,
      suspicious: result.suspicious,
      rolledBack: result.rolledBack,
      rollbackVerified: result.rollbackVerified,
      afterRollbackHash: result.afterRollbackHash,
      linesAdded: result.diffSummary.linesAdded,
      linesRemoved: result.diffSummary.linesRemoved,
      bytesBefore: result.diffSummary.bytesBefore,
      bytesAfter: result.diffSummary.bytesAfter,
      failureCodes: result.findings.map(finding => finding.code),
      detail: result.findings.map(finding => finding.detail).join('; ') || undefined,
    })),
  };
}

function projectTodoVerification(
  wf: WorkflowResult | undefined,
): TaskRunTodoVerification | undefined {
  const report = wf?.todoVerificationReport;
  if (!report) return undefined;
  return {
    scope: report.scope,
    todosTotal: report.todosTotal,
    todosVerified: report.todosVerified,
    todosFailed: report.todosFailed,
    todosBlocked: report.todosBlocked,
    todosUnknown: report.todosUnknown,
    todosNotTested: report.todosNotTested,
    wholeRunCheckCount: report.wholeRunChecks.length,
    verdicts: report.verdicts.map(verdict => ({
      todoId: verdict.todoId,
      scope: verdict.scope,
      verdict: verdict.verdict,
      requiredChecks: [...verdict.requiredChecks],
      executedChecks: [...verdict.executedChecks],
      missingChecks: [...verdict.missingChecks],
      reason: verdict.reason,
    })),
  };
}

function projectSideEffects(wf: WorkflowResult | undefined): TaskRunSideEffects | undefined {
  const ledger = wf?.verificationSideEffects;
  if (!ledger) return undefined;
  return {
    policy: ledger.policy,
    performedCount: ledger.performedCount,
    blockedCount: ledger.blockedCount,
    undeclaredCount: ledger.undeclaredCount,
    effects: ledger.effects.map(effect => ({
      id: effect.id,
      source: effect.source,
      kind: effect.kind,
      target: effect.target,
      policy: effect.policy,
      status: effect.status,
      declared: effect.declared,
      reversible: effect.reversible,
      detail: effect.detail,
    })),
  };
}

function projectTodoVerdicts(
  trace: TodoVerificationTrace | undefined,
  wf: WorkflowResult | undefined,
): ReadonlyArray<TaskRunTodoVerdict> {
  const todoIds = wf?.plan?.todoPlan?.todos.map(todo => todo.id) ?? [];
  const byTodoId = new Map((trace?.verdicts ?? []).map(verdict => [verdict.todoId, verdict]));
  return todoIds.map(todoId => {
    const verdict = byTodoId.get(todoId);
    if (!verdict) {
      return {
        todoId,
        scope: 'WHOLE_RUN' as const,
        verdict: 'UNKNOWN' as const,
        reason: 'verification evidence is whole-run',
      };
    }
    return {
      todoId,
      scope: verdict.scope,
      verdict: verdict.verdict,
      reason: verdict.verdict === 'UNKNOWN'
        ? 'verification evidence is whole-run'
        : `verification evidence is ${verdict.scope.toLowerCase().replace('_', '-')}`,
    };
  });
}

function projectFailure(contract: FailureContract): TaskRunFailure {
  return {
    id: contract.id,
    createdAt: contract.createdAt,
    summary: contract.summary,
    attempt: contract.attempt,
    attemptId: contract.attemptId,
    classification: contract.classification,
    failureType: contract.failureType,
    failedTodoId: contract.failedTodoId,
    failedTodoReason: contract.failedTodoId
      ? undefined
      : 'no reliable mapping from failure evidence to a todo',
    failedStepId: contract.failedStepId,
    expected: contract.expectation?.expectedBehavior ?? contract.primaryFailure?.expectedBehavior,
    actual: contract.actual?.actualBehavior ?? contract.primaryFailure?.actualBehavior,
    primary: contract.primaryFailure
      ? {
        checkId: contract.primaryFailure.check.id,
        name: contract.primaryFailure.check.name,
        category: contract.primaryFailure.category,
        severity: contract.primaryFailure.check.severity,
        evidence: contract.primaryFailure.check.evidence,
        acceptanceCriterion: contract.primaryFailure.acceptanceCriterion,
        requiredOutcome: contract.primaryFailure.requiredOutcome,
      }
      : undefined,
    secondary: (contract.secondaryFailures ?? []).map(toFailureItem),
    incidental: (contract.incidentalFailures ?? []).map(toFailureItem),
    evidenceRefs: [...(contract.evidenceRefs ?? [])],
    implicatedFiles: [...(contract.implicatedFiles ?? [])],
  };
}

function toFailureItem(item: SecondaryFailure | IncidentalFailure): TaskRunFailureItem {
  return {
    checkId: item.check.id,
    name: item.check.name,
    category: item.category,
    severity: item.severity,
    evidence: item.evidence,
    acceptanceCriterion: item.acceptanceCriterion,
  };
}

function projectRepair(
  wf: WorkflowResult | undefined,
  limits: RepairLimits | undefined,
): TaskRunRepair | undefined {
  const attempts = wf?.repairAttemptHistory?.attempts ?? [];
  if (
    attempts.length === 0
    && !wf?.repairOutcome
    && !wf?.repairExpansion
    && !wf?.repairTarget
  ) return undefined;
  return {
    outcome: wf?.repairOutcome,
    attempts: attempts.map(repairAttemptToView),
    limits: limits
      ? {
        maxRepairAttempts: limits.maxRepairAttempts,
        maxContextExpansion: limits.maxContextExpansion,
        maxRepairFiles: limits.maxRepairFiles,
      }
      : undefined,
    expansion: projectExpansion(wf?.repairExpansion),
    target: projectRepairTarget(wf?.repairTarget),
  };
}

/** R4.36: one projection of repair-targeting evidence for every interface. */
function projectRepairTarget(
  record: RepairTargetRecord | undefined,
): TaskRunRepairTargetView | undefined {
  if (!record) return undefined;
  return {
    attemptId: record.attemptId,
    attemptNumber: record.attemptNumber,
    originalTask: record.originalTask,
    acceptanceCriteria: [...record.acceptanceCriteria],
    intent: record.intent,
    intentConfidence: record.intentConfidence,
    intentEvidence: record.intentEvidence,
    originalTodoId: record.originalTodoId,
    originalFiles: [...record.originalFiles],
    primaryFailure: record.primaryFailure,
    allowedFiles: [...record.allowedFiles],
    allowedOperations: [...record.allowedOperations],
    proposedFiles: [...record.proposedFiles],
    proposedOperations: [...record.proposedOperations],
    disallowedFiles: [...record.disallowedFiles],
    decision: record.decision,
    decisionReason: record.decisionReason,
    findings: record.findings.map(item => ({
      kind: item.kind,
      severity: item.severity,
      subject: item.subject,
      reason: item.reason,
      evidenceRef: item.evidenceRef,
    })),
    completion: record.completion
      ? {
        state: record.completion.state,
        succeeded: record.completion.succeeded,
        primaryResolved: record.completion.primaryResolved,
        acceptancePreserved: record.completion.acceptancePreserved,
        verificationPassed: record.completion.verificationPassed,
        scopeRespected: record.completion.scopeRespected,
        reason: record.completion.reason,
      }
      : undefined,
  };
}

/** R3.29: one projection of expansion evidence, reused by every interface. */
function projectExpansion(
  record: RepairExpansionRecord | undefined,
): TaskRunExpansionView | undefined {
  if (!record) return undefined;
  const delta = record.contextDelta;
  return {
    attemptId: record.attemptId,
    attemptNumber: record.attemptNumber,
    expansionLevel: record.expansionLevel,
    decision: record.decision,
    reason: record.reason,
    stopCode: record.stopCode,
    selectedFiles: [...record.selectedFiles],
    candidates: record.candidates.map(candidate => ({
      path: candidate.path,
      source: candidate.source,
      rank: candidate.rank,
      confidence: candidate.confidence,
      exists: candidate.exists,
      alreadyInContext: candidate.alreadyInContext,
      reason: candidate.reason,
    })),
    rejected: record.rejected.map(item => ({
      path: item.path,
      rejection: item.rejection,
      reason: item.reason,
    })),
    missingEvidence: record.missingEvidence.map(item => ({
      kind: item.kind,
      reference: item.reference,
      resolved: item.resolved,
    })),
    previousContextFingerprint: record.previousContextFingerprint,
    contextFingerprint: record.contextFingerprint,
    newFiles: [...(delta?.newFiles ?? [])],
    changedFiles: [...(delta?.changedFiles ?? [])],
    unchangedFiles: [...(delta?.unchangedFiles ?? [])],
    hasNewEvidence: delta?.hasNewEvidence ?? false,
    duplicatePlan: record.duplicatePlan,
  };
}

function projectImpactAnalysis(report: ImpactReport | undefined): TaskRunImpactAnalysis | undefined {
  const analysis = report?.analysis;
  if (!analysis) return undefined;
  return {
    confidence: analysis.confidence,
    summary: analysis.summary,
    changedFiles: [...analysis.changedFiles],
    directlyAffected: [...analysis.directlyAffected],
    indirectlyAffected: [...analysis.indirectlyAffected],
    affectedEndpoints: [...analysis.affectedEndpoints],
    affectedTests: [...analysis.affectedTests],
    affectedDomains: [...analysis.affectedDomains],
    relations: analysis.relations.map(r => ({
      source: r.source,
      target: r.target,
      relationType: r.relationType,
      confidence: r.confidence,
      reason: r.reason,
    })),
    unknowns: [...analysis.unknowns],
    limitsReached: analysis.limitsReached,
  };
}

function projectRegressionPlan(plan: RegressionPlan | undefined): TaskRunRegressionPlan | undefined {
  if (!plan) return undefined;
  return {
    risk: plan.risk,
    policy: plan.policy,
    directChecks: [...plan.directChecks],
    expandedChecks: [...plan.expandedChecks],
    selectedChecks: [...plan.selectedChecks],
    skippedChecks: plan.skippedChecks.map(s => ({ check: s.check, reason: s.reason })),
    affectedArtifacts: [...plan.affectedArtifacts],
    verifiedArtifacts: [...plan.verifiedArtifacts],
    unverifiedArtifacts: [...plan.unverifiedArtifacts],
    reasons: [...plan.reasons],
  };
}

function projectConfirmation(wf: WorkflowResult | undefined): TaskRunConfirmationView | undefined {
  if (!wf) return undefined;
  if (wf.confirmationRequestId) {
    return {
      requestId: wf.confirmationRequestId,
      taskId: wf.taskId ?? wf.correlationContext?.taskId,
      runId: wf.runId ?? wf.correlationContext?.runId,
      type: wf.repairOutcome === 'REPAIR_NEEDS_CONFIRMATION'
        ? 'DESTRUCTIVE_REPAIR'
        : (wf.abortReason || '').includes('REQUIRES_TEST_CREDENTIAL')
          ? 'REQUIRES_TEST_CREDENTIAL'
          : 'CONFIRMATION_REQUIRED',
      status: (wf.abortReason || '').includes('CONFIRMATION_REJECTED') ? 'REJECTED' : 'PENDING',
      reason: wf.abortReason ?? 'Confirmation required',
      risk: wf.regressionPlan?.risk ?? 'HIGH',
      requestedAction: wf.repairOutcome === 'REPAIR_NEEDS_CONFIRMATION' ? 'APPLY_REPAIR' : 'EXECUTE_PLAN',
      affectedFiles: wf.touchedFiles ?? [],
      affectedArtifacts: [],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    };
  }
  return undefined;
}
