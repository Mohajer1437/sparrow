import * as path from 'path';
import * as fs from 'fs/promises';
import { TaskRunStore } from '../contracts/task-run-store';
import {
  TaskRunSnapshot,
  TaskRunStatus,
  isTerminalTaskRunStatus,
  TaskOutcomeSummary,
} from '../domain/task-run';
import { buildTaskOutcomeSummary } from './outcome-summary-builder';
import { isValidTaskId } from './file-task-run-store';
import { PipelineEvent, PipelineEventReader, derivePhaseFromEvents } from './pipeline-event-reader';
import { LEGACY_UNKNOWN_RUN_ID } from '../domain/correlation';

export type QueryErrorCode =
  | 'INVALID_TASK_ID'
  | 'INVALID_RUN_ID'
  | 'TASK_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'TASK_RUN_MISMATCH'
  | 'CONTEXT_ITEM_NOT_FOUND';

export class TaskQueryError extends Error {
  constructor(readonly code: QueryErrorCode, message: string) {
    super(message);
    this.name = 'TaskQueryError';
  }
}

export interface TaskSummaryView {
  readonly taskId: string;
  /**
   * Authoritative identifier for one workflow execution (R6.16).
   */
  readonly runId: string;
  readonly task: string;
  readonly status: TaskRunStatus;
  readonly recordedStatus: TaskRunStatus;
  readonly phase: TaskRunStatus;
  readonly domain?: string;
  readonly skillIds: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly sessionId?: string;
  readonly fingerprint?: string;
  readonly attemptCount?: number;
  readonly repairOutcome?: string;
  readonly abortReason?: string;
  /** UX-OUTCOME.1: concise deterministic outcome explanation */
  readonly outcomeSummary?: TaskOutcomeSummary;
}

export type TimelineStageStatus = 'RECORDED' | 'ATTENTION' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'UNKNOWN';

export interface TaskTimelineStage {
  readonly stage: string;
  readonly status: TimelineStageStatus;
  readonly detail: string;
  readonly at?: string;
}

export interface TaskTimelineView {
  readonly taskId: string;
  readonly runId: string;
  readonly recordedStatus: TaskRunStatus;
  readonly liveStatus: TaskRunStatus;
  readonly stages: ReadonlyArray<TaskTimelineStage>;
}

export interface WorkspaceView {
  readonly workspaceRoot: string;
  readonly readOnly: true;
}

/**
 * Read-only projection of recorded runs for observers (R6.28).
 *
 * The Core is authoritative: once a run recorded a terminal status, live events
 * can no longer change it (R6.23). Live events only sharpen the current phase of a run
 * that is still in progress.
 */
export class TaskQueryService {
  constructor(
    private readonly store: TaskRunStore,
    private readonly events: PipelineEventReader,
    private readonly workspaceRoot: string,
  ) {}

  workspace(): WorkspaceView {
    return { workspaceRoot: this.workspaceRoot, readOnly: true };
  }

  async listTasks(limit = 50): Promise<ReadonlyArray<TaskSummaryView>> {
    const snapshots = await this.store.list(limit);
    const views: TaskSummaryView[] = [];
    for (const snapshot of snapshots) {
      views.push(await this.toSummary(snapshot));
    }
    return views;
  }

  async listRuns(taskId: string): Promise<ReadonlyArray<TaskSummaryView>> {
    if (!isValidTaskId(taskId)) {
      throw new TaskQueryError('INVALID_TASK_ID', `Invalid task id: ${taskId}`);
    }
    const snapshots = await this.store.listRuns(taskId);
    const views: TaskSummaryView[] = [];
    for (const snapshot of snapshots) {
      views.push(await this.toSummary(snapshot));
    }
    return views;
  }

  async getTask(taskId: string): Promise<TaskRunSnapshot & { readonly liveStatus: TaskRunStatus }> {
    const snapshot = await this.requireSnapshot(taskId);
    return { ...snapshot, liveStatus: await this.resolveStatus(snapshot) };
  }

  async getRun(runId: string): Promise<TaskRunSnapshot & { readonly liveStatus: TaskRunStatus }> {
    const snapshot = await this.requireRunSnapshot(runId);
    return { ...snapshot, liveStatus: await this.resolveStatus(snapshot) };
  }

  /**
   * Secure task-run lookup validating ownership boundary (R6.40).
   * Verifies that the requested runId actually belongs to the taskId.
   */
  async getTaskRun(taskId: string, runId: string): Promise<TaskRunSnapshot & { readonly liveStatus: TaskRunStatus }> {
    if (!isValidTaskId(taskId)) {
      throw new TaskQueryError('INVALID_TASK_ID', `Invalid task id: ${taskId}`);
    }
    if (!isValidTaskId(runId)) {
      throw new TaskQueryError('INVALID_RUN_ID', `Invalid run id: ${runId}`);
    }
    const snapshot = await this.store.getRun(runId);
    if (!snapshot) {
      throw new TaskQueryError('RUN_NOT_FOUND', `Run not found: ${runId}`);
    }
    if (snapshot.taskId !== taskId) {
      throw new TaskQueryError(
        'TASK_RUN_MISMATCH',
        `Run '${runId}' does not belong to task '${taskId}'`,
      );
    }
    return { ...snapshot, liveStatus: await this.resolveStatus(snapshot) };
  }

  private async resolveSnapshot(taskId: string, runId?: string): Promise<TaskRunSnapshot> {
    if (runId) {
      return this.getTaskRun(taskId, runId);
    }
    return this.requireSnapshot(taskId);
  }

  async getContext(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      strategy: snapshot.contextStrategy,
      plannerContextSummary: snapshot.plannerContextSummary,
      totals: snapshot.contextTotals,
      items: snapshot.context,
    };
  }

  async getContextItem(taskId: string, index: number, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    const item = snapshot.context.find(entry => entry.index === index);
    if (!item) {
      throw new TaskQueryError('CONTEXT_ITEM_NOT_FOUND', `Context item ${index} not found`);
    }
    const stored = await this.store.getContextContent(taskId);
    const body = stored?.items.find(entry => entry.index === index);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      item,
      content: body?.content,
      truncatedForDisplay: body?.truncatedForDisplay ?? false,
      contentAvailable: Boolean(body),
    };
  }

  async getSkills(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      executionDirective: snapshot.executionDirective,
      resolutionMode: snapshot.executionDirective?.explicitSkillIds.length ? 'explicit' : 'rules',
      skills: snapshot.skills,
    };
  }

  async getTodos(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      todoPlan: snapshot.todoPlan,
      todoStatuses: this.todoStatuses(snapshot),
    };
  }

  async getExecution(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      steps: snapshot.execution,
      touchedFiles: snapshot.touchedFiles,
      abortedAt: snapshot.abortedAt,
      abortReason: snapshot.abortReason,
      error: snapshot.error,
    };
  }

  async getVerification(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      verification: snapshot.verification,
      executionMode: snapshot.executionMode,
      todoVerification: snapshot.todoVerification,
      verificationSideEffects: snapshot.verificationSideEffects,
      available: Boolean(snapshot.verification),
    };
  }

  async getWorkspace(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      executionMode: snapshot.executionMode,
      workspaceComparison: snapshot.workspaceComparison,
      workspaceIntegrity: snapshot.workspaceIntegrity,
      mutationSafety: snapshot.mutationSafety,
      available: Boolean(snapshot.workspaceComparison ?? snapshot.workspaceIntegrity ?? snapshot.mutationSafety),
    };
  }

  async getFailure(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      failure: snapshot.failure,
      available: Boolean(snapshot.failure),
    };
  }

  async getRepair(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      repair: snapshot.repair,
      available: Boolean(snapshot.repair),
    };
  }

  async getVersion(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      recordedAt: snapshot.startedAt,
      versionIntelligence: snapshot.versionIntelligence,
      available: Boolean(snapshot.versionIntelligence),
    };
  }

  async getImpact(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      impactAnalysis: snapshot.impactAnalysis,
      available: Boolean(snapshot.impactAnalysis),
    };
  }

  async getRegression(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      regressionPlan: snapshot.regressionPlan,
      available: Boolean(snapshot.regressionPlan),
    };
  }

  async getBackend(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    const checks = snapshot.verification?.checks.filter(c =>
      c.category === 'backend'
      || c.id.toLowerCase().includes('backend')
      || c.id.toLowerCase().includes('endpoint')
      || c.name.toLowerCase().includes('endpoint'),
    ) ?? [];
    const endpoints = snapshot.confirmation?.credentialRequirement?.endpoints ?? [];
    const affectedEndpoints = snapshot.impactAnalysis?.affectedEndpoints ?? [];
    const hasCredentialReq = snapshot.confirmation?.type === 'REQUIRES_TEST_CREDENTIAL';
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      executionMode: snapshot.executionMode,
      checks,
      endpoints,
      affectedEndpoints,
      requiresTestCredential: hasCredentialReq,
      credentialRequirement: snapshot.confirmation?.credentialRequirement,
      status: checks.length > 0
        ? (checks.every(c => c.passed) ? 'PASSED' : 'FAILED')
        : (hasCredentialReq ? 'REQUIRES_TEST_CREDENTIAL' : 'UNKNOWN'),
      available: checks.length > 0 || endpoints.length > 0 || affectedEndpoints.length > 0 || hasCredentialReq,
    };
  }

  async getDatabase(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    const checks = snapshot.verification?.checks.filter(c =>
      c.category === 'database'
      || c.id.toLowerCase().includes('db')
      || c.id.toLowerCase().includes('database')
      || c.name.toLowerCase().includes('database'),
    ) ?? [];
    const dbVerdicts = snapshot.todoVerification?.verdicts.filter(v =>
      v.todoId.toLowerCase().includes('db') || v.todoId.toLowerCase().includes('database'),
    ) ?? [];
    const failureStatus = snapshot.failure?.failureType?.toLowerCase().includes('database')
      ? snapshot.failure.failureType
      : undefined;
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      executionMode: snapshot.executionMode,
      checks,
      todoVerdicts: dbVerdicts,
      failureStatus,
      status: checks.length > 0
        ? (checks.every(c => c.passed) ? 'PASSED' : 'FAILED')
        : (failureStatus ? 'FAILED' : 'UNKNOWN'),
      readOnly: snapshot.executionMode === 'READ_ONLY',
      available: checks.length > 0 || dbVerdicts.length > 0 || Boolean(failureStatus),
    };
  }

  /**
   * Returns the concise deterministic outcome summary for a task run (UX-OUTCOME.1).
   */
  async getOutcomeSummary(taskId: string, runId?: string): Promise<TaskOutcomeSummary> {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return snapshot.outcomeSummary ?? buildTaskOutcomeSummary(snapshot);
  }

  async getLogInfo(taskId: string, runId?: string) {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    const activeRunId = snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID;

    // 1. Check if snapshot explicitly recorded logFileName/logFilePath
    if (snapshot.logFileName) {
      const absPath = path.resolve(
        this.workspaceRoot,
        snapshot.logFilePath ?? path.join('.ai', 'logs', 'pipeline', snapshot.logFileName),
      );
      try {
        const stat = await fs.stat(absPath);
        const events = await this.readEvents(snapshot, undefined, 500);
        return {
          status: 'FOUND' as const,
          fileName: snapshot.logFileName,
          relativePath: path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/'),
          absolutePath: absPath,
          directory: '.ai/logs/pipeline',
          sessionId: snapshot.sessionId ?? snapshot.logSessionId,
          runId: activeRunId,
          taskId: snapshot.taskId,
          attemptId: snapshot.attemptCount ? `attempt-${snapshot.attemptCount}` : 'attempt-1',
          eventCount: events.length,
          sizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
        };
      } catch {
        // file on disk may differ; fallback to search
      }
    }

    // 2. Search for log file on disk matching runId
    const found = await this.events.findLogFileForRun(
      activeRunId,
      snapshot.taskId,
      [snapshot.logSessionId, snapshot.sessionId].filter((s): s is string => Boolean(s)),
    );

    if (found) {
      try {
        const stat = await fs.stat(found.absolutePath);
        const events = await this.readEvents(snapshot, undefined, 500);
        return {
          status: 'FOUND' as const,
          fileName: found.fileName,
          relativePath: found.relativePath,
          absolutePath: found.absolutePath,
          directory: '.ai/logs/pipeline',
          sessionId: snapshot.sessionId ?? snapshot.logSessionId,
          runId: activeRunId,
          taskId: snapshot.taskId,
          attemptId: snapshot.attemptCount ? `attempt-${snapshot.attemptCount}` : 'attempt-1',
          eventCount: events.length,
          sizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
        };
      } catch {
        // fall through to NOT_CREATED
      }
    }

    return {
      status: 'NOT_CREATED' as const,
      fileName: null,
      relativePath: null,
      absolutePath: null,
      directory: '.ai/logs/pipeline',
      sessionId: snapshot.sessionId ?? snapshot.logSessionId,
      runId: activeRunId,
      taskId: snapshot.taskId,
      attemptId: snapshot.attemptCount ? `attempt-${snapshot.attemptCount}` : 'attempt-1',
      eventCount: 0,
      reason: 'Pipeline logger was not initialized or no log file was produced',
    };
  }

  async getRawLogLines(taskId: string, runId: string, limit = 500) {
    const snapshot = await this.getTaskRun(taskId, runId);
    const logInfo = await this.getLogInfo(taskId, runId);
    if (logInfo.status !== 'FOUND' || !logInfo.absolutePath) {
      throw new TaskQueryError('RUN_NOT_FOUND', `No log file found for run '${runId}'`);
    }
    const raw = await this.events.getRawLogLines(logInfo.absolutePath, runId, taskId, limit);
    return {
      taskId: snapshot.taskId,
      runId,
      fileName: raw.fileName,
      directory: '.ai/logs/pipeline',
      lineCount: raw.lines.length,
      lines: raw.lines,
    };
  }

  async getTimeline(taskId: string, runId?: string): Promise<TaskTimelineView> {
    const snapshot = await this.resolveSnapshot(taskId, runId);
    return this.buildTimeline(snapshot);
  }

  async getTimelineForRun(runId: string): Promise<TaskTimelineView> {
    const snapshot = await this.requireRunSnapshot(runId);
    return this.buildTimeline(snapshot);
  }

  private async buildTimeline(snapshot: TaskRunSnapshot): Promise<TaskTimelineView> {
    const stages: TaskTimelineStage[] = [];
    const add = (
      stage: string,
      status: TimelineStageStatus,
      detail: string,
      at?: string,
    ) => stages.push({ stage, status, detail, at });

    add('TASK', 'RECORDED', snapshot.task, snapshot.startedAt);

    if (snapshot.project) {
      add('PROJECT', 'RECORDED',
        `${snapshot.project.projectType} · frameworks=${snapshot.project.detectedFrameworks.join(', ') || 'none'}`);
    }
    if (snapshot.skills.length > 0) {
      add('SKILLS', 'RECORDED', snapshot.skills.map(skill => skill.id).join(', '));
    }
    if (snapshot.contextStrategy) {
      const missing = snapshot.contextStrategy.missingRequired;
      add('CONTEXT', missing.length > 0 ? 'ATTENTION' : 'RECORDED',
        missing.length > 0
          ? `MISSING_REQUIRED: ${missing.join(', ')}`
          : `selected=${snapshot.contextStrategy.selectedSources.join(', ') || 'none'}`);
    }
    if (snapshot.versionIntelligence) {
      add('VERSION', 'RECORDED', snapshot.versionIntelligence.summary);
    }
    if (snapshot.plannerContextSummary) {
      add('PLANNER', 'RECORDED', 'PlannerContext was assembled and sent to the planner');
    }
    if (snapshot.todoPlan) {
      add('TODO_PLAN', 'RECORDED', `${snapshot.todoPlan.todos.length} todo(s): ${snapshot.todoPlan.goal}`);
    }
    if (snapshot.impactAnalysis) {
      const unknowns = snapshot.impactAnalysis.unknowns.length;
      add('IMPACT', unknowns > 0 ? 'ATTENTION' : 'RECORDED',
        `${snapshot.impactAnalysis.confidence}: ${snapshot.impactAnalysis.summary}`
        + (unknowns > 0 ? ` · ${unknowns} unknown relation(s)` : ''));
    }
    if (snapshot.regressionPlan) {
      add('REGRESSION', 'RECORDED',
        `${snapshot.regressionPlan.policy} · selected=${snapshot.regressionPlan.selectedChecks.join(', ') || 'none'}`);
    }
    if (snapshot.execution.length > 0) {
      const failed = snapshot.execution.filter(step => step.status === 'FAILED').length;
      const succeeded = snapshot.execution.filter(step => step.status === 'SUCCEEDED').length;
      add('EXECUTION', failed > 0 ? 'FAILED' : 'RECORDED',
        `${succeeded}/${snapshot.execution.length} step(s) succeeded`);
    }
    if (snapshot.workspaceIntegrity) {
      add('WORKSPACE', snapshot.workspaceIntegrity.hasUnexpectedChanges ? 'ATTENTION' : 'RECORDED',
        snapshot.workspaceIntegrity.hasUnexpectedChanges
          ? `unexpected changes: ${snapshot.workspaceIntegrity.unexpectedChanges.join(', ')}`
          : `${snapshot.workspaceIntegrity.filesModified.length} modified, ${snapshot.workspaceIntegrity.filesCreated.length} created`);
    }
    if (snapshot.verification) {
      add('VERIFICATION', snapshot.verification.passed ? 'PASSED' : 'FAILED',
        `scope=${snapshot.verification.scope} · ${snapshot.verification.checks.length} check(s)`);
    }
    if (snapshot.failure) {
      add('FAILURE', 'FAILED', snapshot.failure.summary);
    }
    if (snapshot.repair) {
      add('REPAIR', snapshot.repair.outcome === 'PROCEED' ? 'RECORDED' : 'ATTENTION',
        `outcome=${snapshot.repair.outcome ?? 'UNKNOWN'} · attempts=${snapshot.repair.attempts.length}`);
    }
    if (snapshot.confirmation) {
      add('CONFIRMATION', snapshot.confirmation.status === 'APPROVED' ? 'PASSED' : 'ATTENTION',
        `type=${snapshot.confirmation.type ?? 'CONFIRMATION_REQUIRED'} status=${snapshot.confirmation.status ?? 'PENDING'}`);
    }
    if (snapshot.abortReason) {
      add('ABORTED', 'FAILED', `${snapshot.abortedAt ?? 'unknown stage'}: ${snapshot.abortReason}`);
    }

    const liveStatus = await this.resolveStatus(snapshot);
    add('OUTCOME', terminalStageStatus(snapshot.status), `recorded status ${snapshot.status}`, snapshot.completedAt);

    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID,
      recordedStatus: snapshot.status,
      liveStatus,
      stages: Object.freeze(stages),
    };
  }

  async getEvents(taskId: string, sinceSeq?: number, limit?: number) {
    const snapshot = await this.requireSnapshot(taskId);
    const events = await this.readEvents(snapshot, sinceSeq, limit);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID,
      sessionId: snapshot.sessionId,
      logSessionId: snapshot.logSessionId,
      events,
    };
  }

  async getEventsByRun(runId: string, sinceSeq?: number, limit?: number) {
    const snapshot = await this.requireRunSnapshot(runId);
    const events = await this.readEvents(snapshot, sinceSeq, limit);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID,
      sessionId: snapshot.sessionId,
      logSessionId: snapshot.logSessionId,
      events,
    };
  }

  async getEventsForTaskRun(taskId: string, runId: string, sinceSeq?: number, limit?: number) {
    const snapshot = await this.getTaskRun(taskId, runId);
    const events = await this.readEvents(snapshot, sinceSeq, limit);
    return {
      taskId: snapshot.taskId,
      runId: snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID,
      sessionId: snapshot.sessionId,
      logSessionId: snapshot.logSessionId,
      events,
    };
  }

  /** Change token used by the event stream to avoid re-reading unchanged state. */
  async changeToken(): Promise<number> {
    const [runs, logs] = await Promise.all([this.store.lastModified(), this.events.lastModified()]);
    return Math.max(runs, logs);
  }

  private async toSummary(snapshot: TaskRunSnapshot): Promise<TaskSummaryView> {
    const status = await this.resolveStatus(snapshot);
    const runId = snapshot.runId ?? snapshot.sessionId ?? LEGACY_UNKNOWN_RUN_ID;
    return {
      taskId: snapshot.taskId,
      runId,
      task: snapshot.task,
      status,
      recordedStatus: snapshot.status,
      phase: status,
      domain: snapshot.domain,
      skillIds: snapshot.skills.map(skill => skill.id),
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      sessionId: snapshot.sessionId,
      fingerprint: snapshot.fingerprint,
      attemptCount: snapshot.attemptCount ?? (snapshot.repair ? snapshot.repair.attempts.length : 1),
      repairOutcome: snapshot.repair?.outcome,
      abortReason: snapshot.abortReason,
      outcomeSummary: snapshot.outcomeSummary ?? buildTaskOutcomeSummary(snapshot),
    };
  }

  private async resolveStatus(snapshot: TaskRunSnapshot): Promise<TaskRunStatus> {
    if (isTerminalTaskRunStatus(snapshot.status)) return snapshot.status;
    const events = await this.readEvents(snapshot, undefined, 200);
    return derivePhaseFromEvents(events) ?? snapshot.status;
  }

  private async readEvents(
    snapshot: TaskRunSnapshot,
    sinceSeq?: number,
    limit?: number,
  ): Promise<ReadonlyArray<PipelineEvent>> {
    // If runId exists, use primary runId query key (R6.27)
    if (snapshot.runId && snapshot.runId !== LEGACY_UNKNOWN_RUN_ID) {
      const primaryEvents = await this.events.read({
        runId: snapshot.runId,
        taskId: snapshot.taskId,
        sinceSeq,
        limit,
      });
      if (primaryEvents.length > 0) {
        return primaryEvents;
      }
    }

    // For legacy snapshots or fixtures without explicit runId on log entries: fallback to sessionIds and sinceTs (R6.14, R6.15)
    const sessionIds = Array.from(new Set([snapshot.logSessionId, snapshot.sessionId]
      .filter((id): id is string => typeof id === 'string' && id.length > 0)));
    return this.events.read({
      sessionIds,
      sinceSeq,
      limit,
      sinceTs: snapshot.startedAt,
    });
  }

  private todoStatuses(snapshot: TaskRunSnapshot) {
    const todos = snapshot.todoPlan?.todos ?? [];
    const stepsByTodo = new Map<string, typeof snapshot.execution[number][]>();
    for (const step of snapshot.execution) {
      if (!step.sourceTodoId) continue;
      const list = stepsByTodo.get(step.sourceTodoId) ?? [];
      list.push(step);
      stepsByTodo.set(step.sourceTodoId, list);
    }
    const verdictByTodo = new Map(
      (snapshot.verification?.todoVerdicts ?? []).map(verdict => [verdict.todoId, verdict]),
    );
    return todos.map(todo => {
      const steps = stepsByTodo.get(todo.id) ?? [];
      const status = steps.length === 0
        ? 'UNKNOWN'
        : steps.some(step => step.status === 'FAILED')
          ? 'FAILED'
          : steps.every(step => step.status === 'SUCCEEDED')
            ? 'SUCCEEDED'
            : 'PENDING';
      const verdict = verdictByTodo.get(todo.id);
      return {
        todoId: todo.id,
        executionStatus: status,
        stepIds: steps.map(step => step.stepId),
        verificationVerdict: verdict?.verdict ?? 'UNKNOWN',
        verificationScope: verdict?.scope ?? 'WHOLE_RUN',
        verificationReason: verdict?.reason ?? 'verification evidence is whole-run',
      };
    });
  }

  private async requireSnapshot(taskId: string): Promise<TaskRunSnapshot> {
    if (!isValidTaskId(taskId)) {
      throw new TaskQueryError('INVALID_TASK_ID', `Invalid task id: ${taskId}`);
    }
    const snapshot = await this.store.get(taskId);
    if (!snapshot) {
      throw new TaskQueryError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    }
    return snapshot;
  }

  private async requireRunSnapshot(runId: string): Promise<TaskRunSnapshot> {
    if (!isValidTaskId(runId)) {
      throw new TaskQueryError('INVALID_RUN_ID', `Invalid run id: ${runId}`);
    }
    const snapshot = await this.store.getRun(runId);
    if (!snapshot) {
      throw new TaskQueryError('RUN_NOT_FOUND', `Run not found: ${runId}`);
    }
    return snapshot;
  }
}

function terminalStageStatus(status: TaskRunStatus): TimelineStageStatus {
  if (status === 'COMPLETED') return 'PASSED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'BLOCKED') return 'BLOCKED';
  return 'UNKNOWN';
}
