import { TaskExecutionService, TaskExecutionRequest, TaskExecutionOutcome } from './task-execution-service';
import { TaskQueryService, TaskSummaryView } from './task-query-service';
import { ConfirmationService } from './confirmation-service';
import { ReliabilityService, ReliabilityAggregationOptions } from './reliability-service';
import { ConfirmationRequest, ConfirmationStatus } from '../domain/confirmation';
import { ExecutionMode, DEFAULT_EXECUTION_MODE, resolveAuthoritativeExecutionMode } from '../domain/execution-mode';
import { RuntimeSecretHolder } from '../core/backend/runtime-secrets';
import { buildRunId, buildSessionId, buildTaskId, computeRunFingerprint } from '../domain/correlation';
import { isTerminalTaskRunStatus, TaskRunSnapshot, TaskRunStatus } from '../domain/task-run';
import { buildCapabilityCatalog, CapabilityCatalog } from './platform-capabilities';
import { ExecutionLogger } from '../core/observability/execution-logger';

export interface ExecuteTaskCommand {
  readonly task: string;
  readonly roleId?: string;
  readonly targetFiles?: ReadonlyArray<string>;
  readonly executionMode?: ExecutionMode;
  readonly requestedCapabilities?: ReadonlyArray<string>;
  readonly confirmationContext?: {
    readonly confirmationRequestId?: string;
  };
  readonly taskId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly idempotencyKey?: string;
  readonly waitForCompletion?: boolean;
}

export interface StartedTaskView {
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly status: TaskRunStatus;
  readonly executionMode: ExecutionMode;
  readonly createdAt: string;
  readonly startedAt: string;
}

export interface CancelTaskCommand {
  readonly taskId: string;
  readonly runId?: string;
  readonly reason?: string;
  readonly actor?: string;
}

export interface CancelTaskOutcome {
  readonly taskId: string;
  readonly runId?: string;
  readonly status: 'CANCELLED' | 'BLOCKED';
  readonly message: string;
}

export interface ApproveConfirmationCommand {
  readonly requestId: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly fingerprint?: string;
  readonly runId?: string;
  readonly taskId?: string;
}

export interface RejectConfirmationCommand {
  readonly requestId: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly fingerprint?: string;
  readonly runId?: string;
  readonly taskId?: string;
}

export interface ProvideCredentialCommand {
  readonly requestId: string;
  readonly token: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly fingerprint?: string;
  readonly runId?: string;
  readonly taskId?: string;
}

interface ActiveRunHandle {
  readonly taskId: string;
  readonly runId: string;
  readonly promise: Promise<TaskExecutionOutcome>;
  cancel(reason: string): void;
}

/**
 * The unified Application Command & Query Layer (UI-2.1).
 *
 * Exposes a structured command & query interface for all adapters (CLI, REPL,
 * Web UI, and future API clients) ensuring that business rules, safety checks,
 * idempotency, and run lifecycle governance are identical across every window.
 */
export class ApplicationCommandService {
  private readonly activeRuns = new Map<string, ActiveRunHandle>();
  private readonly idempotencyCache = new Map<string, StartedTaskView | TaskExecutionOutcome>();
  private readonly secrets?: RuntimeSecretHolder;

  constructor(
    private readonly executionService: TaskExecutionService,
    private readonly queryService: TaskQueryService,
    private readonly confirmationService?: ConfirmationService,
    private readonly reliabilityService?: ReliabilityService,
    private readonly workspaceRoot: string = process.cwd(),
    secrets?: RuntimeSecretHolder,
  ) {
    this.secrets = secrets;
  }

  /**
   * Authoritative task execution command handler (UI-2.2, UI-2.3).
   * Validates command parameters, enforces idempotency, initiates the run
   * through TaskExecutionService, and tracks active runs for cancellation.
   */
  async executeTask(command: ExecuteTaskCommand): Promise<StartedTaskView | TaskExecutionOutcome> {
    const taskText = command.task?.trim();
    if (!taskText) {
      throw new Error('Task prompt cannot be empty');
    }

    const modeResolution = resolveAuthoritativeExecutionMode({
      executionMode: command.executionMode,
      task: taskText,
    });
    const executionMode = modeResolution.mode;

    if (command.idempotencyKey) {
      const cached = this.idempotencyCache.get(command.idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const startedAt = new Date().toISOString();
    const taskId = command.taskId ?? buildTaskId(startedAt);
    const runId = command.runId ?? buildRunId(startedAt);
    const sessionId = command.sessionId ?? ExecutionLogger.getSessionId() ?? buildSessionId('web');

    let resolveStarted: () => void = () => {};
    const startedPromise = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const executionRequest: TaskExecutionRequest = {
      task: taskText,
      roleId: command.roleId ?? 'coder',
      targetFiles: command.targetFiles,
      executionMode,
      confirmationRequestId: command.confirmationContext?.confirmationRequestId,
      taskId,
      runId,
      sessionId,
      onRunStarted: () => resolveStarted(),
    };

    const startedView: StartedTaskView = Object.freeze({
      taskId,
      runId,
      sessionId,
      attemptId: 'attempt-1',
      status: 'PLANNING',
      executionMode,
      createdAt: startedAt,
      startedAt,
    });

    if (command.idempotencyKey) {
      this.idempotencyCache.set(command.idempotencyKey, startedView);
    }

    if (command.waitForCompletion) {
      const outcome = await this.executionService.execute(executionRequest);
      if (command.idempotencyKey) {
        this.idempotencyCache.set(command.idempotencyKey, outcome);
      }
      return outcome;
    }

    // Asynchronous operator execution: track in-flight run and wait for initial snapshot persistence
    let isCancelled = false;
    let cancelReason = '';

    const executionPromise = (async () => {
      try {
        const outcome = await this.executionService.execute(executionRequest);
        return outcome;
      } catch (err: any) {
        resolveStarted();
        if (isCancelled) {
          ExecutionLogger.log('WORKFLOW', command.roleId ?? 'coder', '-', 'Execution stopped by operator cancel', {
            taskId,
            runId,
            reason: cancelReason,
          });
        }
        throw err;
      } finally {
        this.activeRuns.delete(runId);
        this.activeRuns.delete(taskId);
      }
    })();

    const handle: ActiveRunHandle = {
      taskId,
      runId,
      promise: executionPromise,
      cancel: (reason: string) => {
        isCancelled = true;
        cancelReason = reason;
      },
    };

    this.activeRuns.set(runId, handle);
    this.activeRuns.set(taskId, handle);

    await startedPromise;

    // Unhandled background errors are logged via logger and saved to TaskRunStore
    executionPromise.catch(() => {
      // Background execution failure is captured in TaskRunSnapshot
    });

    return startedView;
  }

  /**
   * Safe task cancellation command handler (UI-2.39).
   */
  async cancelTask(command: CancelTaskCommand): Promise<CancelTaskOutcome> {
    const { taskId, runId, reason } = command;
    const cancelReason = reason ?? 'Cancelled by local operator';

    const handle = (runId ? this.activeRuns.get(runId) : undefined) ?? this.activeRuns.get(taskId);
    if (handle) {
      handle.cancel(cancelReason);
      this.activeRuns.delete(handle.runId);
      this.activeRuns.delete(handle.taskId);
      return {
        taskId: handle.taskId,
        runId: handle.runId,
        status: 'CANCELLED',
        message: `Task run '${handle.runId}' cancelled by operator`,
      };
    }

    // Check if task exists in store
    try {
      const snapshot = runId
        ? await this.queryService.getTaskRun(taskId, runId)
        : await this.queryService.getTask(taskId);

      if (isTerminalTaskRunStatus(snapshot.status)) {
        return {
          taskId,
          runId: snapshot.runId,
          status: 'BLOCKED',
          message: `Cannot cancel task '${taskId}': already in terminal state '${snapshot.status}'`,
        };
      }
    } catch {
      // not found
    }

    return {
      taskId,
      runId,
      status: 'BLOCKED',
      message: `No active run found for task '${taskId}'`,
    };
  }

  /**
   * Revalidates and approves a human confirmation request (UI-2.26).
   */
  async approveConfirmation(command: ApproveConfirmationCommand): Promise<ConfirmationRequest> {
    if (!this.confirmationService) {
      throw new Error('Confirmation service is not configured');
    }

    const request = await this.confirmationService.getRequest(command.requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${command.requestId}`);
    }

    if (command.fingerprint && command.fingerprint !== request.fingerprint) {
      throw new Error(`Confirmation fingerprint mismatch: expected ${request.fingerprint}, received ${command.fingerprint}`);
    }

    if (command.taskId && command.taskId !== request.taskId) {
      throw new Error(`Confirmation task mismatch: request belongs to '${request.taskId}', not '${command.taskId}'`);
    }

    if (command.runId && request.runId && command.runId !== request.runId) {
      throw new Error(`Confirmation run mismatch: request belongs to '${request.runId}', not '${command.runId}'`);
    }

    return this.confirmationService.approve(command.requestId, {
      actor: command.actor ?? 'web-operator',
      reason: command.reason,
    });
  }

  /**
   * Revalidates and rejects a human confirmation request (UI-2.26).
   */
  async rejectConfirmation(command: RejectConfirmationCommand): Promise<ConfirmationRequest> {
    if (!this.confirmationService) {
      throw new Error('Confirmation service is not configured');
    }

    const request = await this.confirmationService.getRequest(command.requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${command.requestId}`);
    }

    if (command.fingerprint && command.fingerprint !== request.fingerprint) {
      throw new Error(`Confirmation fingerprint mismatch: expected ${request.fingerprint}, received ${command.fingerprint}`);
    }

    if (command.taskId && command.taskId !== request.taskId) {
      throw new Error(`Confirmation task mismatch: request belongs to '${request.taskId}', not '${command.taskId}'`);
    }

    if (command.runId && request.runId && command.runId !== request.runId) {
      throw new Error(`Confirmation run mismatch: request belongs to '${request.runId}', not '${command.runId}'`);
    }

    return this.confirmationService.reject(command.requestId, {
      actor: command.actor ?? 'web-operator',
      reason: command.reason,
    });
  }

  /**
   * Provides an ephemeral runtime test credential for backend verification (UI-2.27).
   */
  async provideCredential(command: ProvideCredentialCommand): Promise<ConfirmationRequest> {
    if (!this.confirmationService) {
      throw new Error('Confirmation service is not configured');
    }

    const token = command.token?.trim();
    if (!token) {
      throw new Error('Credential token is required');
    }

    const request = await this.confirmationService.getRequest(command.requestId);
    if (!request) {
      throw new Error(`Confirmation request not found: ${command.requestId}`);
    }

    if (command.fingerprint && command.fingerprint !== request.fingerprint) {
      throw new Error(`Confirmation fingerprint mismatch: expected ${request.fingerprint}, received ${command.fingerprint}`);
    }

    if (command.taskId && command.taskId !== request.taskId) {
      throw new Error(`Confirmation task mismatch: request belongs to '${request.taskId}', not '${command.taskId}'`);
    }

    if (command.runId && request.runId && command.runId !== request.runId) {
      throw new Error(`Confirmation run mismatch: request belongs to '${request.runId}', not '${command.runId}'`);
    }

    return this.confirmationService.provideCredential(command.requestId, token, {
      actor: command.actor ?? 'web-operator',
      reason: command.reason,
      secrets: this.secrets,
    });
  }

  // --- Query Forwarders ---

  getQueries(): TaskQueryService {
    return this.queryService;
  }

  getConfirmationService(): ConfirmationService | undefined {
    return this.confirmationService;
  }

  getReliabilityService(): ReliabilityService | undefined {
    return this.reliabilityService;
  }

  getCapabilities(): CapabilityCatalog {
    return buildCapabilityCatalog();
  }
}
