/**
 * Milestone G — normalizes one recorded task run into a ReliabilityRecord.
 *
 * This module is pure and deterministic: same snapshot in, byte-identical
 * record out. It only reads evidence the pipeline already persisted, and it
 * never upgrades an absent or unknown state into a positive one. No LLM is
 * involved in any classification here.
 */

import {
  CoverageMetric,
  EndpointCoverage,
  EvidenceCompleteness,
  EvidencePresence,
  EvidenceState,
  ImpactCoverage,
  PlannerOutputStatus,
  RELIABILITY_SCHEMA_VERSION,
  RegressionCoverage,
  ReliabilityDimensions,
  ReliabilityExecution,
  ReliabilityFailure,
  ReliabilityPlanning,
  ReliabilityRecord,
  ReliabilityRepair,
  ReliabilitySuspicion,
  ReliabilityVerification,
  ReliabilityConfirmation,
  RepairStatus,
  RunOutcome,
  RunPopulation,
  ReliabilitySideEffects,
  ReliabilityMutationSafety,
  ReliabilityWorkspaceComparison,
  SuspicionFinding,
  TodoCoverage,
  ExecutionStatus,
  VerificationStatus,
} from '../../domain/reliability';
import { isTodoAttributableRequirement } from '../../domain/todo-verification';
import {
  TaskRunSnapshot,
  TaskRunVerificationCheck,
  TaskRunRepairTargetView,
  isTerminalTaskRunStatus,
  isTaskRunStatus,
} from '../../domain/task-run';

const ENDPOINT_CHECK_PREFIX = 'endpoint:';

export function buildReliabilityRecord(snapshot: TaskRunSnapshot): ReliabilityRecord {
  const planning = derivePlanning(snapshot);
  const execution = deriveExecution(snapshot);
  const verification = deriveVerification(snapshot);
  const todoCoverage = deriveTodoCoverage(snapshot);
  const impactCoverage = deriveImpactCoverage(snapshot);
  const endpointCoverage = deriveEndpointCoverage(snapshot);
  const regression = deriveRegression(snapshot);
  const repair = deriveRepair(snapshot);
  const failure = deriveFailure(snapshot);
  const populations = derivePopulations(snapshot, execution, repair);
  const classification = classifyOutcome({
    snapshot,
    execution,
    verification,
    repair,
  });
  const suspicion = deriveSuspicion({
    snapshot,
    classification,
    verification,
    execution,
    impactCoverage,
  });
  const evidenceCompleteness = deriveEvidenceCompleteness(snapshot, execution, repair);

  const outcome = classification.outcome;
  // A run the pipeline entered in repair mode is answering an earlier
  // failure, so it can never be a first attempt even when its own repair
  // history is empty (G.4).
  // R1.24: a read-only inspection is never a successful modification.
  const firstPassSuccess = outcome === 'SUCCESS'
    && snapshot.executionMode !== 'READ_ONLY'
    && repair.repairAttempts === 0
    && !repair.repairMode
    && verification.status === 'PASSED'
    && populations.includes('EXECUTION_RUNS');

  return Object.freeze({
    schemaVersion: RELIABILITY_SCHEMA_VERSION,
    taskId: snapshot.taskId,
    runId: snapshot.runId ?? snapshot.sessionId ?? snapshot.logSessionId ?? snapshot.taskId,
    sessionId: snapshot.sessionId ?? snapshot.logSessionId,
    attemptCount: snapshot.repair ? snapshot.repair.attempts.length : 1,
    task: snapshot.task,
    roleId: snapshot.roleId,
    workspaceRoot: snapshot.workspaceRoot,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    durationMs: computeDuration(snapshot.startedAt, snapshot.completedAt),
    recordedStatus: snapshot.status,
    outcome,
    outcomeReason: classification.reason,
    firstPassSuccess,
    successAfterRepair: outcome === 'SUCCESS_AFTER_REPAIR',
    finalFailure: outcome === 'FAILED',
    blocked: outcome === 'BLOCKED',
    populations,
    executionMode: snapshot.executionMode,
    readOnly: snapshot.executionMode === 'READ_ONLY',
    workspaceComparison: deriveWorkspaceComparison(snapshot),
    mutationSafety: deriveMutationSafety(snapshot),
    verificationSideEffects: deriveSideEffects(snapshot),
    planning,
    execution,
    verification,
    todoCoverage,
    impactCoverage,
    endpointCoverage,
    regression,
    repair,
    failure,
    suspicion,
    evidenceCompleteness,
    dimensions: deriveDimensions(snapshot),
    confirmation: deriveConfirmation(snapshot),
  });
}

function deriveConfirmation(snapshot: TaskRunSnapshot): ReliabilityConfirmation {
  const conf = snapshot.confirmation;
  const abort = snapshot.abortReason ?? '';
  const repairOutcome = snapshot.repair?.outcome;

  const confirmationRequired = Boolean(
    conf ||
    repairOutcome === 'NEEDS_CONFIRMATION' ||
    repairOutcome === 'REPAIR_NEEDS_CONFIRMATION' ||
    abort.includes('CONFIRMATION_REQUIRED') ||
    abort.includes('REQUIRES_TEST_CREDENTIAL') ||
    abort.includes('CONFIRMATION_REJECTED')
  );

  const confirmationApproved = conf?.status === 'APPROVED' || conf?.decision?.decision === 'APPROVE' || conf?.decision?.decision === 'PROVIDE';
  const confirmationRejected = conf?.status === 'REJECTED' || conf?.decision?.decision === 'REJECT' || abort.includes('CONFIRMATION_REJECTED');
  const confirmationExpired = conf?.status === 'EXPIRED' || abort.includes('EXPIRED');
  const confirmationInvalidated = abort.includes('FINGERPRINT_MISMATCH') || abort.includes('CONFIRMATION_INVALIDATED');
  const credentialRequested = conf?.type === 'REQUIRES_TEST_CREDENTIAL' || abort.includes('REQUIRES_TEST_CREDENTIAL');
  const credentialProvided = Boolean(conf?.decision?.decision === 'PROVIDE' || (credentialRequested && confirmationApproved));

  return Object.freeze({
    confirmationRequired,
    confirmationApproved,
    confirmationRejected,
    confirmationExpired,
    confirmationInvalidated,
    credentialRequested,
    credentialProvided,
    requestId: conf?.requestId,
    type: conf?.type,
    status: conf?.status,
  });
}

/* -------------------------------------------------------------- planning */

function derivePlanning(snapshot: TaskRunSnapshot): ReliabilityPlanning {
  const todos = snapshot.todoPlan?.todos ?? [];
  const hasTodoPlan = Boolean(snapshot.todoPlan) && todos.length > 0;
  const abortedInPlanning = snapshot.abortedAt === 'planning' || snapshot.abortedAt === 'plan-validation';
  const reason = snapshot.abortReason ?? snapshot.error;

  let status: PlannerOutputStatus;
  if (hasTodoPlan) {
    status = 'VALID_TODO_PLAN';
  } else if (snapshot.execution.length > 0) {
    status = 'PLAN_WITHOUT_TODO_PLAN';
  } else if (abortedInPlanning) {
    status = classifyPlannerFailure(reason);
  } else if (reason && classifyPlannerFailure(reason) !== 'UNKNOWN') {
    status = classifyPlannerFailure(reason);
  } else if (!reason) {
    status = 'NOT_ATTEMPTED';
  } else {
    status = 'UNKNOWN';
  }

  return Object.freeze({
    plannerOutputStatus: status,
    todoPlanPresent: hasTodoPlan,
    todoCount: todos.length,
    plannerFailureReason: status === 'VALID_TODO_PLAN' ? undefined : reason,
  });
}

/**
 * A provider outage and a malformed plan are different reliability problems,
 * so they are never merged (G.13).
 */
function classifyPlannerFailure(reason: string | undefined): PlannerOutputStatus {
  if (!reason) return 'UNKNOWN';
  const text = reason.toLowerCase();
  if (/timed out|timeout|etimedout/.test(text)) return 'TIMEOUT';
  if (/provider|econnrefused|connection|network|fetch failed|socket|unavailable|model not found/.test(text)) {
    return 'PROVIDER_FAILURE';
  }
  if (/rejected|invalid|malformed|parse|schema|validation/.test(text)) return 'OUTPUT_REJECTED';
  return 'UNKNOWN';
}

/* ------------------------------------------------------------- execution */

function deriveExecution(snapshot: TaskRunSnapshot): ReliabilityExecution {
  const steps = snapshot.execution;
  const succeeded = steps.filter(step => step.status === 'SUCCEEDED').length;
  const failed = steps.filter(step => step.status === 'FAILED').length;
  const pending = steps.filter(step => step.status === 'PENDING').length;

  let status: ExecutionStatus;
  if (steps.length === 0) {
    status = 'NOT_ATTEMPTED';
  } else if (failed > 0) {
    status = 'FAILED';
  } else if (pending > 0) {
    status = 'PARTIAL';
  } else {
    status = 'COMPLETED';
  }

  const intendedFiles = uniqueSorted([
    ...(snapshot.todoPlan?.affectedFiles ?? []),
    ...steps.flatMap(step => step.files),
  ].map(normalizePath));

  // R1.31: the R1 comparison is the authoritative workspace evidence; the
  // pre-R1 integrity record remains a fallback for older snapshots.
  const comparison = snapshot.workspaceComparison;
  if (comparison) {
    const unintended = uniqueSorted(comparison.unintendedChangedFiles.map(normalizePath));
    return Object.freeze({
      status,
      totalSteps: steps.length,
      succeededSteps: succeeded,
      failedSteps: failed,
      pendingSteps: pending,
      intendedFiles: intendedFiles.length > 0
        ? intendedFiles
        : uniqueSorted(comparison.intendedFiles.map(normalizePath)),
      actualChangedFiles: uniqueSorted(comparison.actualChangedFiles.map(normalizePath)),
      unintendedChangedFiles: unintended,
      wrongFileModification: comparison.state !== 'PROVEN'
        ? 'INSUFFICIENT_EVIDENCE'
        : comparison.wrongFileModification === 'PROVEN' ? 'PROVEN' : 'NOT_PROVEN',
      wrongFileBasis: comparison.basis,
    });
  }

  const integrity = snapshot.workspaceIntegrity;
  if (!integrity) {
    // `touchedFiles` merges git status with previously dirty files, so it
    // cannot separate this run's writes from pre-existing dirt (G.17).
    return Object.freeze({
      status,
      totalSteps: steps.length,
      succeededSteps: succeeded,
      failedSteps: failed,
      pendingSteps: pending,
      intendedFiles,
      actualChangedFiles: uniqueSorted(snapshot.touchedFiles.map(normalizePath)),
      unintendedChangedFiles: Object.freeze([]),
      wrongFileModification: steps.length === 0 ? 'NOT_APPLICABLE' : 'INSUFFICIENT_EVIDENCE',
      wrongFileBasis: 'no workspace state comparison recorded; touched files may include pre-existing dirty files',
    });
  }

  const actualChangedFiles = uniqueSorted([
    ...integrity.filesModified,
    ...integrity.filesCreated,
    ...integrity.filesDeleted,
  ].map(normalizePath));
  const intendedSet = new Set(intendedFiles);
  const unintended = uniqueSorted(
    integrity.unexpectedChanges.map(normalizePath).filter(file => !intendedSet.has(file)),
  );

  return Object.freeze({
    status,
    totalSteps: steps.length,
    succeededSteps: succeeded,
    failedSteps: failed,
    pendingSteps: pending,
    intendedFiles,
    actualChangedFiles,
    unintendedChangedFiles: unintended,
    wrongFileModification: unintended.length > 0 ? 'PROVEN' : 'NOT_PROVEN',
    wrongFileBasis: 'workspace state comparison between pre-execution and post-execution snapshots',
  });
}

/* ---------------------------------------------------------- verification */

function deriveVerification(snapshot: TaskRunSnapshot): ReliabilityVerification {
  const report = snapshot.verification;
  const status: VerificationStatus = !report
    ? 'NOT_RUN'
    : report.passed ? 'PASSED' : 'FAILED';

  const required = requiredCheckNames(snapshot);
  const checks = report?.checks ?? [];
  const executedNames: string[] = [];
  const passedNames: string[] = [];
  const failedNames: string[] = [];

  for (const name of required) {
    const matching = checks.filter(check => checkMatchesRequirement(check, name));
    if (matching.length === 0) continue;
    executedNames.push(name);
    if (matching.every(check => check.passed)) passedNames.push(name);
    else failedNames.push(name);
  }

  const unknown = required.length - executedNames.length;
  const hasDenominator = required.length > 0;
  const ratio = hasDenominator ? executedNames.length / required.length : null;
  const state: EvidenceState = hasDenominator
    ? 'PROVEN'
    : report
      ? 'INSUFFICIENT_EVIDENCE'
      : 'UNKNOWN';

  const coverage: CoverageMetric = Object.freeze({
    required: required.length,
    selected: required.length,
    executed: executedNames.length,
    passed: passedNames.length,
    failed: failedNames.length,
    skipped: 0,
    unknown: Math.max(0, unknown),
    ratio,
    state,
    basis: hasDenominator
      ? 'required checks declared by resolved skills and todo verification requirements'
      : 'no run declared required verification checks; denominator unknown',
  });

  return Object.freeze({
    status,
    scope: report?.scope ?? 'WHOLE_RUN',
    qualityProfile: report?.qualityProfile,
    coverage,
  });
}

/** Required checks come from resolved skills and the todo plan, never from prose. */
function requiredCheckNames(snapshot: TaskRunSnapshot): ReadonlyArray<string> {
  const names = [
    ...snapshot.skills.flatMap(skill => skill.requiredChecks),
    ...(snapshot.todoPlan?.todos ?? []).flatMap(todo => todo.verificationRequirements ?? []),
  ];
  return uniqueSorted(names.map(name => name.trim().toLowerCase()).filter(Boolean));
}

function checkMatchesRequirement(check: TaskRunVerificationCheck, requirement: string): boolean {
  const id = check.id.toLowerCase();
  const category = check.category.toLowerCase();
  const name = check.name.toLowerCase();
  return category === requirement
    || id === requirement
    || id.startsWith(`${requirement}-`)
    || name === requirement;
}

/* ----------------------------------------------------------- todo coverage */

function deriveTodoCoverage(snapshot: TaskRunSnapshot): TodoCoverage {
  const todos = snapshot.todoPlan?.todos ?? [];
  if (todos.length === 0) {
    return Object.freeze({
      total: 0,
      executed: 0,
      verified: 0,
      failed: 0,
      unknown: 0,
      notTested: 0,
      blocked: 0,
      scope: snapshot.verification?.scope ?? 'WHOLE_RUN',
      state: 'NOT_APPLICABLE',
    });
  }

  // R1.30: prefer the R1 report, which only counts TODO_SPECIFIC evidence.
  const r1 = snapshot.todoVerification;
  if (r1) {
    const executedFromSteps = countExecutedTodos(snapshot);
    return Object.freeze({
      total: r1.todosTotal,
      executed: executedFromSteps,
      verified: r1.todosVerified,
      failed: r1.todosFailed,
      unknown: r1.todosUnknown,
      notTested: r1.todosNotTested,
      blocked: r1.todosBlocked,
      scope: r1.scope,
      state: r1.scope === 'TODO_SPECIFIC' ? 'PROVEN' : 'UNKNOWN',
    });
  }

  const stepsByTodo = new Map<string, ReadonlyArray<TaskRunSnapshot['execution'][number]>>();
  for (const step of snapshot.execution) {
    if (!step.sourceTodoId) continue;
    stepsByTodo.set(step.sourceTodoId, [...(stepsByTodo.get(step.sourceTodoId) ?? []), step]);
  }
  const verdictByTodo = new Map(
    (snapshot.verification?.todoVerdicts ?? []).map(verdict => [verdict.todoId, verdict]),
  );

  let executed = 0;
  let verified = 0;
  let failed = 0;
  let unknown = 0;
  for (const todo of todos) {
    const steps = stepsByTodo.get(todo.id) ?? [];
    if (steps.some(step => step.status !== 'PENDING')) executed += 1;
    // A whole-run V&V pass says nothing about an individual todo (G.9).
    const verdict = verdictByTodo.get(todo.id)?.verdict ?? 'UNKNOWN';
    if (verdict === 'PASS') verified += 1;
    else if (verdict === 'FAIL') failed += 1;
    else unknown += 1;
  }

  return Object.freeze({
    total: todos.length,
    executed,
    verified,
    failed,
    unknown,
    notTested: 0,
    blocked: 0,
    scope: snapshot.verification?.scope ?? 'WHOLE_RUN',
    state: unknown === todos.length ? 'UNKNOWN' : 'PROVEN',
  });
}

function countExecutedTodos(snapshot: TaskRunSnapshot): number {
  const executed = new Set<string>();
  for (const step of snapshot.execution) {
    if (step.sourceTodoId && step.status !== 'PENDING') executed.add(step.sourceTodoId);
  }
  return executed.size;
}

/* --------------------------------------------------------- impact coverage */

function deriveImpactCoverage(snapshot: TaskRunSnapshot): ImpactCoverage {
  const impact = snapshot.impactAnalysis;
  const plan = snapshot.regressionPlan;

  if (!impact) {
    return Object.freeze({
      confidence: 'UNKNOWN',
      affected: 0,
      verified: 0,
      unverified: 0,
      unknown: 0,
      limitsReached: false,
      ratio: null,
      state: 'UNKNOWN',
    });
  }

  const affectedFromPlan = plan?.affectedArtifacts ?? [];
  const affected = affectedFromPlan.length > 0
    ? affectedFromPlan.length
    : uniqueSorted([
      ...impact.directlyAffected,
      ...impact.indirectlyAffected,
      ...impact.affectedEndpoints,
    ]).length;
  const verified = plan?.verifiedArtifacts.length ?? 0;
  const unverified = plan?.unverifiedArtifacts.length ?? 0;
  const hasDenominator = affected > 0;

  // UNKNOWN impact must never be reported as "no impact" (F/G anti-hallucination).
  const state: EvidenceState = impact.confidence === 'UNKNOWN'
    ? 'UNKNOWN'
    : !plan
      ? 'INSUFFICIENT_EVIDENCE'
      : 'PROVEN';

  return Object.freeze({
    confidence: impact.confidence,
    affected,
    verified,
    unverified,
    unknown: impact.unknowns.length,
    limitsReached: impact.limitsReached,
    ratio: hasDenominator && plan ? verified / affected : null,
    state,
  });
}

/* ------------------------------------------------------- endpoint coverage */

function deriveEndpointCoverage(snapshot: TaskRunSnapshot): EndpointCoverage {
  const endpoints = snapshot.impactAnalysis?.affectedEndpoints ?? [];
  const plan = snapshot.regressionPlan;
  const skipped = (plan?.skippedChecks ?? [])
    .filter(entry => entry.check.startsWith(ENDPOINT_CHECK_PREFIX))
    .map(entry => ({
      endpoint: entry.check.slice(ENDPOINT_CHECK_PREFIX.length),
      reason: entry.reason,
    }));
  const selectedEndpointChecks = (plan?.selectedChecks ?? [])
    .filter(check => check.startsWith(ENDPOINT_CHECK_PREFIX));

  if (endpoints.length === 0 && selectedEndpointChecks.length === 0 && skipped.length === 0) {
    return Object.freeze({
      discovered: 0,
      tested: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      skipReasons: Object.freeze([]),
      ratio: null,
      state: 'NOT_APPLICABLE',
    });
  }

  const apiChecks = (snapshot.verification?.checks ?? [])
    .filter(check => check.category.toLowerCase() === 'api');
  let tested = 0;
  let passed = 0;
  let failed = 0;
  for (const endpoint of endpoints) {
    const matching = apiChecks.filter(check => mentionsEndpoint(check, endpoint));
    if (matching.length === 0) continue;
    tested += 1;
    if (matching.every(check => check.passed)) passed += 1;
    else failed += 1;
  }

  // Endpoint checks were selected but no per-endpoint evidence exists: the
  // honest answer is that we cannot tell what was tested.
  const state: EvidenceState = selectedEndpointChecks.length > 0 && apiChecks.length === 0
    ? 'INSUFFICIENT_EVIDENCE'
    : 'PROVEN';

  return Object.freeze({
    discovered: endpoints.length,
    tested,
    passed,
    failed,
    blocked: 0,
    skipped: skipped.length,
    skipReasons: Object.freeze(skipped),
    ratio: endpoints.length > 0 && state === 'PROVEN' ? tested / endpoints.length : null,
    state,
  });
}

function mentionsEndpoint(check: TaskRunVerificationCheck, endpoint: string): boolean {
  const needle = endpoint.toLowerCase();
  return check.id.toLowerCase().includes(needle)
    || check.name.toLowerCase().includes(needle)
    || check.evidence.toLowerCase().includes(needle);
}

/* ----------------------------------------------------- regression coverage */

function deriveRegression(snapshot: TaskRunSnapshot): RegressionCoverage {
  const plan = snapshot.regressionPlan;
  if (!plan) {
    return Object.freeze({
      risk: 'UNKNOWN',
      policy: 'UNKNOWN',
      selected: 0,
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      skipReasons: Object.freeze([]),
      ratio: null,
      state: 'UNKNOWN',
    });
  }

  const checks = snapshot.verification?.checks ?? [];
  let executed = 0;
  let passed = 0;
  let failed = 0;
  for (const selected of plan.selectedChecks) {
    const matching = checks.filter(check => checkMatchesRequirement(check, selected.toLowerCase()));
    if (matching.length === 0) continue;
    executed += 1;
    // A skipped check is never counted as a pass (G.12).
    if (matching.every(check => check.passed)) passed += 1;
    else failed += 1;
  }

  const hasDenominator = plan.selectedChecks.length > 0;
  return Object.freeze({
    risk: plan.risk,
    policy: plan.policy,
    selected: plan.selectedChecks.length,
    executed,
    passed,
    failed,
    skipped: plan.skippedChecks.length,
    skipReasons: Object.freeze(plan.skippedChecks.map(entry => ({
      check: entry.check,
      reason: entry.reason,
    }))),
    ratio: hasDenominator ? executed / plan.selectedChecks.length : null,
    state: hasDenominator ? 'PROVEN' : 'INSUFFICIENT_EVIDENCE',
  });
}

/* ------------------------------------------------------------------ repair */

function deriveRepair(snapshot: TaskRunSnapshot): ReliabilityRepair {
  const repair = snapshot.repair;
  const attempts = repair?.attempts ?? [];
  const repairAttempts = attempts.filter(attempt => attempt.kind === 'REPAIR').length;
  const outcome = repair?.outcome;
  // The context strategy records whether the planner was seeded with a
  // failure contract. That is the evidence that this run is a repair of an
  // earlier attempt, even when the repair history was not carried over.
  const repairMode = snapshot.contextStrategy?.repairMode === true;

  const limitReached = outcome === 'REPAIR_LIMIT_REACHED'
    || attempts.some(attempt => attempt.outcome === 'LIMIT_REACHED');
  const blocked = outcome === 'BLOCKED'
    || outcome === 'NEEDS_CONTEXT'
    || outcome === 'NEEDS_CONFIRMATION'
    || attempts.some(attempt => attempt.outcome === 'BLOCKED');
  const duplicateDetected = outcome === 'DUPLICATE_REPAIR_PLAN'
    || attempts.some(attempt => attempt.outcome === 'DUPLICATE');
  const maxExpansionLevel = attempts.reduce(
    (max, attempt) => Math.max(max, attempt.expansionLevel ?? 0),
    0,
  );

  // A generated or executed repair plan is not a repair success: only the
  // final verified state of the run can establish that (G.5).
  const succeeded = (repairAttempts > 0 || repairMode)
    && snapshot.status === 'COMPLETED'
    && snapshot.verification?.passed === true;

  let status: RepairStatus;
  if (repairAttempts === 0 && !repairMode && !outcome) status = 'NOT_REQUIRED';
  else if (succeeded) status = 'SUCCEEDED';
  else if (limitReached) status = 'LIMIT_REACHED';
  else if (blocked) status = 'BLOCKED';
  else if (repairAttempts === 0 && !repairMode) status = 'NOT_REQUIRED';
  else if (isTaskRunStatus(snapshot.status) && !isTerminalTaskRunStatus(snapshot.status)) {
    status = 'IN_PROGRESS';
  } else status = 'FAILED';

  // R3.30: expansion facts come from what the run recorded, never inferred
  // from the fact that a repair happened.
  const expansion = repair?.expansion;
  const expandedFiles = expansion?.selectedFiles.length ?? 0;
  const contextExpansionUsed = maxExpansionLevel > 0
    || expansion?.decision === 'EXPAND_CONTEXT'
    || expandedFiles > 0;

  return Object.freeze({
    status,
    attempts: attempts.length,
    repairAttempts,
    repairMode,
    succeeded,
    limitReached,
    blocked,
    duplicateDetected,
    maxExpansionLevel,
    contextExpansionUsed,
    expandedFiles,
    // Credited only when both are true, so a repair that succeeded on the
    // evidence it already had is not reported as a win for expansion.
    succeededAfterExpansion: succeeded && contextExpansionUsed,
    stoppedForNoNewEvidence: expansion?.stopCode === 'NO_NEW_EVIDENCE'
      || expansion?.stopCode === 'NO_NEW_CANDIDATES',
    stoppedForExpansionLimit: expansion?.stopCode === 'EXPANSION_LIMIT_REACHED',
    needsContext: outcome === 'NEEDS_CONTEXT' || expansion?.decision === 'NEEDS_CONTEXT',
    ...repairTargetMetrics(repair?.target, succeeded, outcome),
  });
}

/**
 * R4.33: separate a repair that fixed the problem from one that made the
 * evidence of the problem disappear.
 *
 * `succeeded` above is derived from run status and verification, which is
 * exactly the signal an acceptance-chasing repair can fake. So the legitimate
 * count is additionally gated on the completion verdict, and any blocking
 * finding invalidates the target regardless of how the run ended.
 */
function repairTargetMetrics(
  target: TaskRunRepairTargetView | undefined,
  succeeded: boolean,
  outcome: string | undefined,
) {
  const findings = target?.findings ?? [];
  const hasBlocking = (kind: string): boolean =>
    findings.some(item => item.kind === kind && item.severity === 'BLOCKING');

  const acceptanceChasingDetected =
    hasBlocking('ACCEPTANCE_CHASING')
    || target?.completion?.state === 'ACCEPTANCE_CHASING_DETECTED'
    || outcome === 'REPAIR_ACCEPTANCE_CHASING';

  const anyBlocking = findings.some(item => item.severity === 'BLOCKING');

  return {
    repairTargetValid: target ? !anyBlocking && target.decision !== 'BLOCK' : true,
    acceptanceChasingDetected,
    scopeEscapeDetected: hasBlocking('SCOPE_ESCAPE'),
    testManipulationDetected: hasBlocking('TEST_MANIPULATION'),
    verificationBypassDetected: hasBlocking('VERIFICATION_BYPASS'),
    configBypassDetected: findings.some(item => item.kind === 'CONFIG_BYPASS'),
    intentMismatchDetected: hasBlocking('INTENT_MISMATCH'),
    legitimateRepairSuccess:
      succeeded
      && !anyBlocking
      && (target?.completion ? target.completion.state === 'PRIMARY_RESOLVED' : true),
    suppressedSymptomRejected: acceptanceChasingDetected && !succeeded,
  };
}

/* ----------------------------------------------------------------- failure */

function deriveFailure(snapshot: TaskRunSnapshot): ReliabilityFailure {
  const failure = snapshot.failure;
  if (!failure) {
    return Object.freeze({
      present: false,
      secondaryCount: 0,
      incidentalCount: 0,
      failedTodoKnown: false,
    });
  }
  return Object.freeze({
    present: true,
    summary: failure.summary,
    classification: failure.classification,
    primaryCheckId: failure.primary?.checkId,
    secondaryCount: failure.secondary.length,
    incidentalCount: failure.incidental.length,
    failedTodoId: failure.failedTodoId,
    // An ambiguous failure-to-todo mapping stays ambiguous (F5/G).
    failedTodoKnown: Boolean(failure.failedTodoId),
  });
}

/* ------------------------------------------------- R1 workspace + side effects */

function deriveWorkspaceComparison(snapshot: TaskRunSnapshot): ReliabilityWorkspaceComparison {
  const comparison = snapshot.workspaceComparison;
  if (!comparison) {
    return Object.freeze({
      present: false,
      state: 'NOT_APPLICABLE' as const,
      intendedFiles: Object.freeze([]),
      intendedChangedFiles: Object.freeze([]),
      actualChangedFiles: Object.freeze([]),
      unintendedChangedFiles: Object.freeze([]),
      missingExpectedChanges: Object.freeze([]),
      preExistingDirtyFiles: Object.freeze([]),
      wrongFileModification: 'UNKNOWN' as const,
      basis: 'no workspace comparison recorded for this run',
    });
  }
  return Object.freeze({
    present: true,
    state: comparison.state,
    intendedFiles: Object.freeze([...comparison.intendedFiles]),
    intendedChangedFiles: Object.freeze([...comparison.intendedChangedFiles]),
    actualChangedFiles: Object.freeze([...comparison.actualChangedFiles]),
    unintendedChangedFiles: Object.freeze([...comparison.unintendedChangedFiles]),
    missingExpectedChanges: Object.freeze([...comparison.missingExpectedChanges]),
    preExistingDirtyFiles: Object.freeze([...comparison.preExistingDirtyFiles]),
    wrongFileModification: comparison.wrongFileModification === 'PROVEN'
      ? 'PROVEN'
      : comparison.wrongFileModification === 'NOT_PROVEN' ? 'NOT_PROVEN' : 'INSUFFICIENT_EVIDENCE',
    basis: comparison.basis,
  });
}

/** R2.23: mutation accounting copied from the ledger, never inferred. */
function deriveMutationSafety(snapshot: TaskRunSnapshot): ReliabilityMutationSafety {
  const ledger = snapshot.mutationSafety;
  if (!ledger) {
    return Object.freeze({
      present: false,
      attempts: 0,
      applied: 0,
      rejected: 0,
      blocked: 0,
      rolledBack: 0,
      failed: 0,
      syntaxFailures: 0,
      suspiciousDiffs: 0,
      expectedChangeFailures: 0,
      rollbackFailures: 0,
      outOfScopeAttempts: 0,
      state: 'UNKNOWN' as const,
      basis: 'no executor mutation evidence recorded for this run',
    });
  }
  return Object.freeze({
    present: true,
    attempts: ledger.mutationAttempts,
    applied: ledger.successfulMutations,
    rejected: ledger.rejectedMutations,
    blocked: ledger.blockedMutations,
    rolledBack: ledger.rolledBackMutations,
    failed: ledger.failedMutations,
    syntaxFailures: ledger.syntaxFailures,
    suspiciousDiffs: ledger.unexpectedDiffs,
    expectedChangeFailures: ledger.expectedChangeFailures,
    rollbackFailures: ledger.rollbackFailures,
    outOfScopeAttempts: ledger.outOfScopeAttempts,
    state: ledger.mutationAttempts > 0 ? ('PROVEN' as const) : ('NOT_APPLICABLE' as const),
    basis: `executor mutation safety boundary recorded ${ledger.mutationAttempts} guarded mutation attempt(s)`,
  });
}

function deriveSideEffects(snapshot: TaskRunSnapshot): ReliabilitySideEffects {
  const ledger = snapshot.verificationSideEffects;
  if (!ledger) {
    return Object.freeze({
      present: false,
      policy: 'UNKNOWN',
      performed: 0,
      blocked: 0,
      undeclared: 0,
    });
  }
  return Object.freeze({
    present: true,
    policy: ledger.policy,
    performed: ledger.performedCount,
    blocked: ledger.blockedCount,
    undeclared: ledger.undeclaredCount,
  });
}

/* -------------------------------------------------------------- population */

function derivePopulations(
  snapshot: TaskRunSnapshot,
  execution: ReliabilityExecution,
  repair: ReliabilityRepair,
): ReadonlyArray<RunPopulation> {
  const populations: RunPopulation[] = ['ALL_RUNS'];
  if (execution.totalSteps > 0) populations.push('EXECUTION_RUNS');
  else populations.push('PLANNING_ONLY');

  // R1.32: a read-only inspection must not dilute mutation success rates,
  // and it is not a mutating execution even when it ran many steps.
  if (snapshot.executionMode === 'READ_ONLY') populations.push('READ_ONLY_INSPECTION');
  else if (execution.totalSteps > 0) populations.push('MUTATING_EXECUTION');

  const skillIds = snapshot.skills.map(skill => skill.id.toLowerCase());
  const domains = [
    ...(snapshot.project?.detectedDomains ?? []),
    snapshot.project?.projectType ?? '',
    snapshot.domain ?? '',
  ].map(value => value.toLowerCase());

  const backend = skillIds.some(id => id.startsWith('backend.'))
    || domains.some(value => value.includes('backend'))
    || (snapshot.impactAnalysis?.affectedEndpoints ?? []).some(ep => !ep.startsWith('PAGE '));
  const frontend = skillIds.some(id => id.startsWith('frontend.'))
    || domains.some(value => value.includes('frontend'));

  if (backend) populations.push('BACKEND_RUNS');
  if (frontend) populations.push('FRONTEND_RUNS');
  if (repair.repairAttempts > 0 || repair.repairMode) populations.push('REPAIR_RUNS');
  return Object.freeze(populations);
}

/* ---------------------------------------------------- outcome classification */

interface OutcomeClassification {
  readonly outcome: RunOutcome;
  readonly reason: string;
}

function classifyOutcome(input: {
  snapshot: TaskRunSnapshot;
  execution: ReliabilityExecution;
  verification: ReliabilityVerification;
  repair: ReliabilityRepair;
}): OutcomeClassification {
  const { snapshot, execution, verification, repair } = input;
  const status = snapshot.status;

  if (!isTaskRunStatus(status)) {
    return { outcome: 'INSUFFICIENT_EVIDENCE', reason: `unrecognized recorded status: ${status}` };
  }
  if (!isTerminalTaskRunStatus(status)) {
    return {
      outcome: 'ABORTED',
      reason: `run never reached a terminal state (last recorded phase: ${status})`,
    };
  }
  // A task stopped by policy or environment did not necessarily fail its
  // implementation, so BLOCKED is never merged into FAILED (G.7).
  if (status === 'BLOCKED') {
    return {
      outcome: 'BLOCKED',
      reason: snapshot.abortReason ?? 'execution was prevented before a verdict could be reached',
    };
  }
  if (status === 'FAILED') {
    if (repair.limitReached) {
      return { outcome: 'FAILED', reason: 'repair limit reached without passing verification' };
    }
    return {
      outcome: 'FAILED',
      reason: snapshot.abortReason ?? snapshot.error ?? 'run reached a terminal failed state',
    };
  }

  // status === 'COMPLETED' from here on.
  if (verification.status === 'FAILED') {
    return {
      outcome: 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
      reason: 'run recorded success while verification evidence reports failed checks',
    };
  }
  if (verification.status === 'NOT_RUN') {
    if (execution.actualChangedFiles.length > 0 || verification.coverage.required > 0) {
      return {
        outcome: 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
        reason: 'run recorded success but no verification evidence was produced',
      };
    }
    return {
      outcome: 'SUCCESS',
      reason: 'run completed with no file changes and no declared verification requirements',
    };
  }

  const missing = verification.coverage.unknown;
  if (missing > 0) {
    return {
      outcome: 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
      reason: `verification passed but ${missing} of ${verification.coverage.required} required check(s) produced no evidence`,
    };
  }
  if (repair.repairAttempts > 0) {
    return {
      outcome: 'SUCCESS_AFTER_REPAIR',
      reason: `verification passed after ${repair.repairAttempts} repair attempt(s)`,
    };
  }
  if (repair.repairMode) {
    return {
      outcome: 'SUCCESS_AFTER_REPAIR',
      reason: 'verification passed on a run the pipeline entered in repair mode',
    };
  }
  return { outcome: 'SUCCESS', reason: 'execution completed and all required verification passed' };
}

/* -------------------------------------------------------------- suspicion */

function deriveSuspicion(input: {
  snapshot: TaskRunSnapshot;
  classification: OutcomeClassification;
  verification: ReliabilityVerification;
  execution: ReliabilityExecution;
  impactCoverage: ImpactCoverage;
}): ReliabilitySuspicion {
  const { snapshot, classification, verification, execution, impactCoverage } = input;
  const findings: SuspicionFinding[] = [];
  const recordedSuccess = snapshot.status === 'COMPLETED';

  if (recordedSuccess && verification.status === 'NOT_RUN') {
    findings.push({
      code: 'VERIFICATION_NOT_RUN',
      detail: 'the run recorded success but no verification report exists',
    });
  }
  if (recordedSuccess && verification.status === 'FAILED') {
    findings.push({
      code: 'SUCCESS_CONTRADICTS_VERIFICATION',
      detail: 'the run recorded success while the verification report reports failed checks',
    });
  }
  if (recordedSuccess && verification.coverage.unknown > 0) {
    findings.push({
      code: 'REQUIRED_CHECKS_MISSING',
      detail: `${verification.coverage.unknown} of ${verification.coverage.required} required check(s) produced no evidence`,
    });
  }
  if (recordedSuccess && impactCoverage.state === 'UNKNOWN' && execution.actualChangedFiles.length > 0) {
    findings.push({
      code: 'IMPACT_UNKNOWN',
      detail: 'files changed but impact analysis produced no confirmed relations',
    });
  }

  // Only unverified artifacts with no recorded skip reason are suspicious: a
  // deliberate, reasoned policy skip is visible but not an accounting defect.
  const skippedTargets = new Set(
    (snapshot.regressionPlan?.skippedChecks ?? []).map(entry =>
      entry.check.includes(':') ? entry.check.slice(entry.check.indexOf(':') + 1) : entry.check),
  );
  const unexplained = (snapshot.regressionPlan?.unverifiedArtifacts ?? [])
    .filter(artifact => !skippedTargets.has(artifact));
  if (recordedSuccess && unexplained.length > 0) {
    findings.push({
      code: 'UNVERIFIED_AFFECTED_ARTIFACTS',
      detail: `${unexplained.length} affected artifact(s) were neither verified nor skipped with a reason: ${unexplained.join(', ')}`,
    });
  }
  if (execution.wrongFileModification === 'PROVEN') {
    findings.push({
      code: 'UNINTENDED_FILE_MODIFICATION',
      detail: `changes outside the planned scope: ${execution.unintendedChangedFiles.join(', ')}`,
    });
  }

  // R1.33: a mutating run that claims success without workspace or todo
  // evidence is exactly the claim this milestone refuses to accept.
  const mutating = snapshot.executionMode !== 'READ_ONLY' && execution.totalSteps > 0;
  if (recordedSuccess && mutating && !snapshot.workspaceComparison && !snapshot.workspaceIntegrity) {
    findings.push({
      code: 'WORKSPACE_EVIDENCE_MISSING',
      detail: 'mutating run reported success without any workspace state comparison',
    });
  }
  if (recordedSuccess && mutating && snapshot.workspaceComparison?.state === 'INSUFFICIENT_EVIDENCE') {
    findings.push({
      code: 'WORKSPACE_EVIDENCE_INSUFFICIENT',
      detail: snapshot.workspaceComparison.basis,
    });
  }
  // A read-only inspection is supposed to leave its files alone, so an
  // unchanged planned file is the expected outcome there, not a missing change.
  if (recordedSuccess && mutating && (snapshot.workspaceComparison?.missingExpectedChanges.length ?? 0) > 0) {
    findings.push({
      code: 'MISSING_EXPECTED_CHANGE',
      detail: `planned files never changed: ${snapshot.workspaceComparison!.missingExpectedChanges.join(', ')}`,
    });
  }
  // Only todos that declared verification requirements can be said to be
  // *missing* verification. A whole-run-only V&V profile (R1.10) is legitimate
  // and must not make every run suspicious.
  const todosRequiringVerification = (snapshot.todoPlan?.todos ?? [])
    .filter(todo => todo.verificationRequirements.some(isTodoAttributableRequirement)).length;
  if (recordedSuccess && mutating && todosRequiringVerification > 0) {
    const todoVerification = snapshot.todoVerification;
    if (!todoVerification || todoVerification.scope !== 'TODO_SPECIFIC') {
      findings.push({
        code: 'TODO_VERIFICATION_MISSING',
        detail: `${todosRequiringVerification} todo(s) declared verification requirements but no todo-specific verification evidence exists`,
      });
    } else if (todoVerification.todosUnknown + todoVerification.todosNotTested > 0) {
      findings.push({
        code: 'TODO_VERIFICATION_INCOMPLETE',
        detail: `${todoVerification.todosUnknown} unknown and ${todoVerification.todosNotTested} untested todo(s)`,
      });
    }
  }
  // R2.16/R2.23: a failed rollback means the workspace state is unknown, and
  // a run that claims success on top of that is exactly what R2 refuses.
  const mutations = snapshot.mutationSafety;
  if (mutations && mutations.rollbackFailures > 0) {
    findings.push({
      code: 'MUTATION_ROLLBACK_FAILED',
      detail: `${mutations.rollbackFailures} mutation(s) could not be rolled back; the workspace may still hold rejected content`,
    });
  }
  if (recordedSuccess && mutations && mutations.rolledBackMutations > 0) {
    findings.push({
      code: 'MUTATION_ROLLED_BACK',
      detail: `${mutations.rolledBackMutations} mutation(s) failed immediate validation and were rolled back`,
    });
  }
  if ((snapshot.verificationSideEffects?.undeclaredCount ?? 0) > 0) {
    findings.push({
      code: 'UNDECLARED_VERIFICATION_SIDE_EFFECT',
      detail: `${snapshot.verificationSideEffects!.undeclaredCount} verification side effect(s) mutated project state without declaration`,
    });
  }

  return Object.freeze({
    suspicious: findings.length > 0 || classification.outcome === 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
    findings: Object.freeze(findings),
  });
}

/* ---------------------------------------------------- evidence completeness */

function deriveEvidenceCompleteness(
  snapshot: TaskRunSnapshot,
  execution: ReliabilityExecution,
  repair: ReliabilityRepair,
): EvidenceCompleteness {
  const planning: EvidencePresence = snapshot.todoPlan
    ? 'COMPLETE'
    : snapshot.execution.length > 0 ? 'PARTIAL' : 'MISSING';
  const todoPlan: EvidencePresence = snapshot.todoPlan ? 'COMPLETE' : 'MISSING';
  const executionPresence: EvidencePresence = execution.totalSteps === 0
    ? 'NOT_APPLICABLE'
    : execution.pendingSteps > 0 ? 'PARTIAL' : 'COMPLETE';
  const verification: EvidencePresence = !snapshot.verification
    ? 'MISSING'
    : snapshot.verification.checks.length === 0 ? 'PARTIAL' : 'COMPLETE';
  const repairPresence: EvidencePresence =
    repair.repairAttempts === 0 && !repair.repairMode && !snapshot.repair
      ? 'NOT_APPLICABLE'
      : 'COMPLETE';
  const impact: EvidencePresence = !snapshot.impactAnalysis
    ? 'MISSING'
    : snapshot.impactAnalysis.limitsReached ? 'PARTIAL' : 'COMPLETE';
  const regression: EvidencePresence = snapshot.regressionPlan ? 'COMPLETE' : 'MISSING';
  const workspace: EvidencePresence = snapshot.workspaceComparison
    ? (snapshot.workspaceComparison.state === 'PROVEN' ? 'COMPLETE' : 'PARTIAL')
    : snapshot.workspaceIntegrity ? 'COMPLETE' : 'MISSING';

  const areas = [
    planning, todoPlan, executionPresence, verification,
    repairPresence, impact, regression, workspace,
  ];
  const overall: EvidencePresence = areas.includes('MISSING')
    ? 'MISSING'
    : areas.includes('PARTIAL') ? 'PARTIAL' : 'COMPLETE';

  return Object.freeze({
    planning,
    todoPlan,
    execution: executionPresence,
    verification,
    repair: repairPresence,
    impact,
    regression,
    workspace,
    overall,
  });
}

/* ------------------------------------------------------------- dimensions */

function deriveDimensions(snapshot: TaskRunSnapshot): ReliabilityDimensions {
  const frameworks = uniqueSorted(snapshot.project?.detectedFrameworks ?? []);

  // Only detected frameworks form the framework/version dimension. Version
  // intelligence covers every dependency, and grouping reliability by, say,
  // `eslint@8.57.1` would produce meaningless buckets (G.24). Versions come
  // from the evidence recorded with this run, never from the project's
  // current state.
  const frameworkKeys = new Set(frameworks.map(normalizeTechnology));
  const frameworkVersions = (snapshot.versionIntelligence?.items ?? [])
    .filter(item => item.normalizedVersion && item.normalizedVersion !== 'unknown')
    .filter(item => frameworkKeys.has(normalizeTechnology(item.technology)))
    .map(item => `${item.technology}@${item.normalizedVersion}`);

  return Object.freeze({
    workspaceRoot: snapshot.workspaceRoot,
    projectType: snapshot.project?.projectType ?? snapshot.domain,
    frameworks,
    frameworkVersions: uniqueSorted(frameworkVersions),
    skillIds: uniqueSorted(snapshot.skills.map(skill => skill.id)),
    qualityProfile: snapshot.verification?.qualityProfile,
    riskLevels: uniqueSorted((snapshot.todoPlan?.todos ?? []).map(todo => todo.risk)),
    impactConfidence: snapshot.impactAnalysis?.confidence,
  });
}

/* ------------------------------------------------------------------ utils */

function computeDuration(startedAt: string, completedAt?: string): number | null {
  if (!completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const delta = end - start;
  return delta >= 0 ? delta : null;
}

/** `@types/react`, `next.js` and `nextjs` all collapse to one comparable key. */
function normalizeTechnology(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/js$/, '');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueSorted(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return Object.freeze([...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)));
}
