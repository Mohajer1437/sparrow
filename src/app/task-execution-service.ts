import * as path from 'path';
import { AgentOrchestrator } from '../contracts/agent-orchestrator';
import { TaskRunStore } from '../contracts/task-run-store';
import { WorkflowResult } from '../contracts/workflow-orchestrator';
import { AgentExecutionResult } from '../domain/agent-execution';
import { RepairLimits } from '../domain/repair-intelligence';
import { TaskRunSnapshot, TaskOutcomeSummary } from '../domain/task-run';
import { buildTaskOutcomeSummary } from './outcome-summary-builder';
import { ExecutionMode, resolveAuthoritativeExecutionMode } from '../domain/execution-mode';
import { ExecutionLogger } from '../core/observability/execution-logger';
import {
  CorrelationContext,
  buildRunId,
  buildSessionId,
  buildTaskId,
  computeRunFingerprint,
} from '../domain/correlation';
import { projectContextContent, projectTaskRun } from './task-run-projection';
import {
  FinalTruth,
  canDeclareCompleted,
  createInitialFinalTruth,
  mapFinalTruthToTaskRunStatus,
  transitionFinalTruth,
} from '../domain/final-truth';
import { runChangeSetFromMutationLedger } from '../domain/run-change-set';
import { InterruptDetectionService } from '../core/recovery/interrupt-detection-service';

export interface TaskExecutionRequest {
  readonly task: string;
  readonly roleId?: string;
  readonly targetFiles?: ReadonlyArray<string>;
  /** R1.18: explicit execution mode. Defaults to STANDARD, never inferred from the task text. */
  readonly executionMode?: ExecutionMode;
  /** R5: optional confirmation request id to resume or validate */
  readonly confirmationRequestId?: string;
  /** R5: optional interactive callback for CLI / REPL */
  readonly onConfirmationRequested?: (request: import('../domain/confirmation').ConfirmationRequest) => Promise<boolean>;
  /** R6: optional explicit correlation identifiers */
  readonly taskId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  /** UI-2: optional callback invoked immediately after the initial PLANNING snapshot is persisted */
  readonly onRunStarted?: (run: { taskId: string; runId: string; sessionId: string }) => void;
  /** PHASE-09: resume metadata */
  readonly resumedFromRunId?: string;
  readonly resumedFromCheckpointId?: string;
  readonly resumeFromStepIndex?: number;
}

export interface TaskExecutionOutcome {
  readonly taskId: string;
  readonly runId: string;
  readonly snapshot: TaskRunSnapshot;
  readonly result: AgentExecutionResult;
  /** UX-OUTCOME.1: concise deterministic outcome explanation — view of FinalTruth */
  readonly outcomeSummary?: TaskOutcomeSummary;
}

/**
 * The single application-level entry point for running a task through the
 * pipeline (R6.3). PHASE-09: FinalTruth is the durable authority.
 */
export class TaskExecutionService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly store: TaskRunStore,
    private readonly workspaceRoot: string,
    private readonly repairLimits?: RepairLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(request: TaskExecutionRequest): Promise<TaskExecutionOutcome> {
    // Detect stale runs before starting a new one.
    try {
      await new InterruptDetectionService(this.store).detectAndMarkInterrupted();
    } catch {
      /* non-fatal */
    }

    const roleId = request.roleId ?? 'coder';
    const startedAt = this.now().toISOString();
    const taskId = request.taskId ?? buildTaskId(startedAt);
    const runId = request.runId ?? buildRunId(startedAt);
    const explicitSession = request.sessionId ?? ExecutionLogger.getSessionId();
    const sessionId = explicitSession ?? buildSessionId('cli');
    const fingerprint = computeRunFingerprint(taskId, runId, startedAt);

    if (!ExecutionLogger.getLogFile()) {
      ExecutionLogger.init(this.workspaceRoot, sessionId);
    }

    const correlationContext: CorrelationContext = Object.freeze({
      taskId,
      runId,
      sessionId,
      attemptId: 'attempt-1',
    });

    const modeResolution = resolveAuthoritativeExecutionMode({
      executionMode: request.executionMode,
      task: request.task,
    });
    const executionMode = modeResolution.mode;

    ExecutionLogger.setContext(correlationContext);

    const logFile = ExecutionLogger.getLogFile();
    const logFileName = logFile ? path.basename(logFile) : undefined;
    const logFilePath = logFile ? path.relative(this.workspaceRoot, logFile).replace(/\\/g, '/') : undefined;

    let finalTruth = createInitialFinalTruth({
      runId,
      taskId,
      sessionId,
      now: startedAt,
      processPid: process.pid,
    });
    if (request.resumedFromRunId || request.resumedFromCheckpointId) {
      finalTruth = transitionFinalTruth(finalTruth, 'EXECUTION', {
        reason: 'Resumed interrupted execution',
        now: startedAt,
        recoveryStatus: 'RESUMED',
        resumedFromRunId: request.resumedFromRunId,
        resumedFromCheckpointId: request.resumedFromCheckpointId,
        currentStep: request.resumeFromStepIndex !== undefined
          ? `step-index-${request.resumeFromStepIndex}`
          : undefined,
        currentOperation: 'resume',
        processPid: process.pid,
      });
    }

    // Persist PLANNING first so UI/run.json never invent a terminal FAILED seed.
    await this.record({
      taskId,
      runId,
      sessionId,
      logSessionId: sessionId,
      logFileName,
      logFilePath,
      fingerprint,
      task: request.task,
      roleId,
      workspaceRoot: this.workspaceRoot,
      startedAt,
      success: false,
      workflowResult: null,
      repairLimits: this.repairLimits,
      executionMode,
      finalTruth,
    }, mapFinalTruthToTaskRunStatus(finalTruth.status) as TaskRunSnapshot['status']);

    request.onRunStarted?.({ taskId, runId, sessionId });

    // Advance durable phases before entering the orchestrator so crashes mid-run
    // are not stuck forever at PLANNING (PHASE-08 SM-07 / PHASE-09 Req 1+9).
    if (!request.resumedFromRunId && !request.resumedFromCheckpointId) {
      finalTruth = transitionFinalTruth(finalTruth, 'CONTEXT', {
        now: this.now().toISOString(),
        currentOperation: 'context',
        processPid: process.pid,
      });
      finalTruth = transitionFinalTruth(finalTruth, 'EXECUTION', {
        now: this.now().toISOString(),
        currentOperation: 'orchestrator.execute',
        processPid: process.pid,
      });
      await this.record({
        taskId,
        runId,
        sessionId,
        logSessionId: sessionId,
        logFileName,
        logFilePath,
        fingerprint,
        task: request.task,
        roleId,
        workspaceRoot: this.workspaceRoot,
        startedAt,
        success: false,
        workflowResult: null,
        repairLimits: this.repairLimits,
        executionMode,
        finalTruth,
      }, mapFinalTruthToTaskRunStatus(finalTruth.status) as TaskRunSnapshot['status']);
    }

    let result: AgentExecutionResult;
    try {
      result = await this.orchestrator.execute({
        roleId,
        task: request.task,
        targetFiles: request.targetFiles,
        executionMode,
        confirmationRequestId: request.confirmationRequestId,
        onConfirmationRequested: request.onConfirmationRequested,
        correlationContext,
        taskId,
        runId,
        sessionId,
      });
    } catch (error: any) {
      const activeLog = ExecutionLogger.getLogFile();
      const currentLogName = activeLog ? path.basename(activeLog) : logFileName;
      const currentLogRelPath = activeLog ? path.relative(this.workspaceRoot, activeLog).replace(/\\/g, '/') : logFilePath;
      finalTruth = transitionFinalTruth(finalTruth, 'FAILED', {
        reason: error?.message ?? String(error),
        now: this.now().toISOString(),
      });
      const snapshot = await this.record({
        taskId,
        runId,
        sessionId,
        logSessionId: sessionId,
        logFileName: currentLogName,
        logFilePath: currentLogRelPath,
        fingerprint,
        task: request.task,
        roleId,
        workspaceRoot: this.workspaceRoot,
        startedAt,
        completedAt: this.now().toISOString(),
        success: false,
        error: error?.message ?? String(error),
        workflowResult: null,
        repairLimits: this.repairLimits,
        executionMode,
        finalTruth,
      });
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        taskId: snapshot.taskId,
        runId: snapshot.runId ?? runId,
      });
    }

    const workflowResult = (result.workflowResult ?? null) as WorkflowResult | null;
    finalTruth = this.deriveTerminalTruth(finalTruth, result, workflowResult);

    const recordedSessionId = explicitSession ?? workflowResult?.sessionId ?? sessionId;
    const logSessionId = explicitSession ?? workflowResult?.sessionId ?? recordedSessionId;
    const activeLog = ExecutionLogger.getLogFile();
    const currentLogName = activeLog ? path.basename(activeLog) : logFileName;
    const currentLogRelPath = activeLog ? path.relative(this.workspaceRoot, activeLog).replace(/\\/g, '/') : logFilePath;

    // Pipeline boolean is demoted: result.success alone cannot force COMPLETED.
    const authoritativeSuccess = finalTruth.status === 'COMPLETED';
    if (authoritativeSuccess !== result.success) {
      result = { ...result, success: authoritativeSuccess };
    }

    const snapshot = await this.record({
      taskId,
      runId,
      sessionId: recordedSessionId,
      logSessionId,
      logFileName: currentLogName,
      logFilePath: currentLogRelPath,
      fingerprint,
      task: request.task,
      roleId,
      workspaceRoot: this.workspaceRoot,
      startedAt,
      completedAt: this.now().toISOString(),
      success: authoritativeSuccess,
      error: result.error,
      workflowResult,
      repairLimits: this.repairLimits,
      executionMode,
      finalTruth,
    });

    try {
      await this.store.saveContextContent(
        projectContextContent(taskId, workflowResult?.plannerContext?.gathered),
      );
    } catch (error: any) {
      ExecutionLogger.log('WORKFLOW', roleId, '-', 'Failed to record run context content', {
        taskId,
        runId,
        error: error?.message,
      });
    }

    const outcomeSummary = snapshot.outcomeSummary ?? buildTaskOutcomeSummary(snapshot);
    return { taskId, runId, snapshot, result, outcomeSummary };
  }

  /**
   * Build terminal FinalTruth from workflow evidence. COMPLETED requires canDeclareCompleted.
   */
  private deriveTerminalTruth(
    current: FinalTruth,
    result: AgentExecutionResult,
    wf: WorkflowResult | null,
  ): FinalTruth {
    const now = this.now().toISOString();
    const ledger = wf?.mutationLedger;
    const changeSet = ledger
      ? runChangeSetFromMutationLedger(
        current.runId,
        ledger.results.map((r) => ({
          path: r.path,
          status: r.status,
          changed: r.changed,
          rolledBack: r.rolledBack,
        })),
        current.baselineCommit,
      )
      : undefined;
    const changeSetFiles = changeSet?.files;

    let mutationStatus: FinalTruth['mutationStatus'] = current.mutationStatus;
    if (ledger) {
      if (ledger.successfulMutations > 0 && (ledger.rejectedMutations > 0 || ledger.rolledBackMutations > 0)) {
        mutationStatus = 'PARTIAL';
      } else if (ledger.successfulMutations > 0) {
        mutationStatus = 'APPLIED';
      } else if (ledger.rolledBackMutations > 0) {
        mutationStatus = 'ROLLED_BACK';
      } else if (ledger.rejectedMutations > 0 || ledger.blockedMutations > 0) {
        mutationStatus = 'FAILED';
      } else {
        mutationStatus = 'NONE';
      }
    }

    let verificationStatus: FinalTruth['verificationStatus'] = 'NOT_RUN';
    if (wf?.verificationReport) {
      if (wf.verificationReport.passed) {
        verificationStatus = 'PASSED';
      } else {
        const checks = wf.verificationReport.checks ?? [];
        const skipped = checks.some((c: any) => c.resultStatus === 'SKIPPED' || c.resultStatus === 'NOT_RUN');
        verificationStatus = skipped ? 'SKIPPED' : 'FAILED';
      }
    }

    const abort = (wf?.abortReason || result.error || '').toUpperCase();
    const blocked = abort.includes('CLARIFICATION')
      || abort.includes('BLOCKED')
      || abort.includes('CONFIRMATION')
      || wf?.repairOutcome === 'BLOCKED'
      || wf?.repairOutcome === 'NEEDS_CONTEXT'
      || wf?.repairOutcome === 'NEEDS_CONFIRMATION';

    if (blocked) {
      return transitionFinalTruth(current, 'BLOCKED', {
        reason: wf?.abortReason || result.error || 'Blocked',
        now,
        mutationStatus,
        verificationStatus,
        changeSetFiles,
        repositoryStatus: (changeSetFiles && changeSetFiles.length > 0) ? 'DIRTY' : current.repositoryStatus,
      });
    }

    const mutationFailed = mutationStatus === 'FAILED' || mutationStatus === 'ROLLED_BACK'
      || (mutationStatus === 'PARTIAL' && !result.success);
    const verificationFailed = verificationStatus === 'FAILED' || verificationStatus === 'SKIPPED';

    if (!result.success || mutationFailed || verificationFailed) {
      const repoStatus = (changeSetFiles && changeSetFiles.length > 0)
        ? (mutationFailed ? 'PARTIAL_FAILURE' : 'DIRTY')
        : current.repositoryStatus;
      return transitionFinalTruth(current, 'FAILED', {
        reason: wf?.abortReason
          || result.error
          || (mutationFailed ? 'Mutation failure' : undefined)
          || (verificationFailed ? 'Verification did not pass (failed or skipped)' : undefined)
          || 'Execution failed',
        now,
        mutationStatus,
        verificationStatus,
        changeSetFiles,
        repositoryStatus: repoStatus,
      });
    }

    // Candidate success from pipeline — walk durable phases then COMPLETED only if allowed.
    let candidate = current;
    const phasePath: Array<FinalTruth['status']> = ['CONTEXT', 'EXECUTION', 'VERIFICATION', 'ACCEPTANCE'];
    for (const phase of phasePath) {
      if (candidate.status === phase || ['COMPLETED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(candidate.status)) {
        continue;
      }
      const order = ['PLANNING', 'CONTEXT', 'EXECUTION', 'VERIFICATION', 'ACCEPTANCE', 'COMPLETED'];
      const fromIdx = order.indexOf(candidate.status);
      const toIdx = order.indexOf(phase);
      if (fromIdx >= 0 && toIdx > fromIdx) {
        candidate = transitionFinalTruth(candidate, phase, {
          now,
          mutationStatus,
          verificationStatus,
          changeSetFiles,
          repositoryStatus: (changeSetFiles && changeSetFiles.length > 0) ? 'DIRTY' : 'CLEAN',
        });
      }
    }

    if (!canDeclareCompleted({ ...candidate, mutationStatus, verificationStatus })) {
      return transitionFinalTruth(candidate, 'FAILED', {
        reason: 'Cannot declare COMPLETED: verification not PASSED or repository PARTIAL_FAILURE',
        now,
        mutationStatus,
        verificationStatus: verificationStatus === 'PASSED' ? verificationStatus : (verificationStatus || 'NOT_RUN'),
        changeSetFiles,
        repositoryStatus: candidate.repositoryStatus === 'PARTIAL_FAILURE'
          ? 'PARTIAL_FAILURE'
          : (changeSetFiles && changeSetFiles.length > 0 ? 'PARTIAL_FAILURE' : candidate.repositoryStatus),
      });
    }

    return transitionFinalTruth(candidate, 'COMPLETED', {
      reason: 'FinalTruth accepted',
      now,
      mutationStatus,
      verificationStatus,
      changeSetFiles,
      repositoryStatus: (changeSetFiles && changeSetFiles.length > 0) ? 'COMMITTED' : 'CLEAN',
    });
  }

  private async record(
    input: Parameters<typeof projectTaskRun>[0],
    forcedStatus?: TaskRunSnapshot['status'],
  ): Promise<TaskRunSnapshot> {
    const projected = projectTaskRun(input);
    const snapshot = forcedStatus
      ? { ...projected, status: forcedStatus, completedAt: forcedStatus === 'PLANNING' || forcedStatus === 'EXECUTION' || forcedStatus === 'RUNNING' ? undefined : projected.completedAt }
      : projected;
    try {
      await this.store.save(snapshot);
    } catch (error: any) {
      ExecutionLogger.log('WORKFLOW', input.roleId, '-', 'Failed to record run snapshot', {
        taskId: input.taskId,
        runId: input.runId,
        error: error?.message,
      });
    }
    return snapshot;
  }
}
