/**
 * PHASE-09: FinalTruth - single durable execution authority.
 * No component may independently declare success; COMPLETED requires canDeclareCompleted.
 */

export type FinalTruthStatus =
  | 'RUNNING'
  | 'PLANNING'
  | 'CONTEXT'
  | 'EXECUTION'
  | 'VERIFICATION'
  | 'ACCEPTANCE'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'INTERRUPTED';

export type FinalTruthVerificationStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN' | 'UNKNOWN';
export type FinalTruthMutationStatus = 'NONE' | 'PARTIAL' | 'APPLIED' | 'FAILED' | 'ROLLED_BACK';
export type FinalTruthRepositoryStatus = 'CLEAN' | 'DIRTY' | 'COMMITTED' | 'PARTIAL_FAILURE' | 'UNKNOWN';
export type FinalTruthRecoveryStatus = 'NONE' | 'DETECTED' | 'RESUMABLE' | 'RESUMED' | 'NOT_RESUMABLE';

export interface FinalTruthTransition {
  readonly from: FinalTruthStatus;
  readonly to: FinalTruthStatus;
  readonly at: string;
  readonly reason?: string;
}

export interface FinalTruth {
  readonly runId: string;
  readonly taskId: string;
  readonly sessionId?: string;
  readonly planId?: string;
  readonly status: FinalTruthStatus;
  readonly reason?: string;
  readonly verificationStatus: FinalTruthVerificationStatus;
  readonly mutationStatus: FinalTruthMutationStatus;
  readonly repositoryStatus: FinalTruthRepositoryStatus;
  readonly recoveryStatus: FinalTruthRecoveryStatus;
  readonly transitionHistory: ReadonlyArray<FinalTruthTransition>;
  readonly lastHeartbeat: string;
  readonly currentStep?: string;
  readonly currentOperation?: string;
  readonly changeSetFiles?: ReadonlyArray<string>;
  readonly baselineCommit?: string;
  readonly resumedFromRunId?: string;
  readonly resumedFromCheckpointId?: string;
  readonly processPid?: number;
  readonly timestamp: string;
}

export const DEFAULT_HEARTBEAT_EXPIRY_MS = 15 * 60 * 1000;

const HAPPY_PATH: ReadonlyArray<FinalTruthStatus> = Object.freeze([
  'PLANNING',
  'CONTEXT',
  'EXECUTION',
  'VERIFICATION',
  'ACCEPTANCE',
  'COMPLETED',
]);

const TERMINAL: ReadonlyArray<FinalTruthStatus> = Object.freeze([
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'INTERRUPTED',
]);

export class IllegalExecutionTransitionError extends Error {
  readonly from: FinalTruthStatus;
  readonly to: FinalTruthStatus;

  constructor(from: FinalTruthStatus, to: FinalTruthStatus) {
    super(`Illegal FinalTruth transition: ${from} -> ${to}`);
    this.name = 'IllegalExecutionTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function isTerminalFinalTruth(status: FinalTruthStatus): boolean {
  return TERMINAL.includes(status);
}

export function isNonTerminalFinalTruth(status: FinalTruthStatus): boolean {
  return !isTerminalFinalTruth(status);
}

export function canTransition(from: FinalTruthStatus, to: FinalTruthStatus): boolean {
  if (from === to) return true;
  if (from === 'RUNNING') return true;

  if (from === 'COMPLETED' || from === 'FAILED' || from === 'BLOCKED') {
    return false;
  }

  if (to === 'FAILED' || to === 'BLOCKED' || to === 'INTERRUPTED') {
    return isNonTerminalFinalTruth(from) || from === 'INTERRUPTED';
  }

  if (from === 'INTERRUPTED') {
    return to === 'EXECUTION';
  }

  const fromIdx = HAPPY_PATH.indexOf(from);
  const toIdx = HAPPY_PATH.indexOf(to);
  if (fromIdx >= 0 && toIdx >= 0) {
    return toIdx > fromIdx;
  }

  return false;
}

export function assertTransition(from: FinalTruthStatus, to: FinalTruthStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalExecutionTransitionError(from, to);
  }
}

export function createInitialFinalTruth(input: {
  readonly runId: string;
  readonly taskId: string;
  readonly sessionId?: string;
  readonly planId?: string;
  readonly now?: string;
  readonly baselineCommit?: string;
  readonly processPid?: number;
}): FinalTruth {
  const now = input.now ?? new Date().toISOString();
  return Object.freeze({
    runId: input.runId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    planId: input.planId,
    status: 'PLANNING',
    verificationStatus: 'NOT_RUN',
    mutationStatus: 'NONE',
    repositoryStatus: 'UNKNOWN',
    recoveryStatus: 'NONE',
    transitionHistory: Object.freeze([]),
    lastHeartbeat: now,
    baselineCommit: input.baselineCommit,
    processPid: Object.prototype.hasOwnProperty.call(input, 'processPid')
      ? input.processPid
      : (typeof process !== 'undefined' ? process.pid : undefined),
    timestamp: now,
  });
}

export interface FinalTruthPatch {
  readonly reason?: string;
  readonly now?: string;
  readonly verificationStatus?: FinalTruthVerificationStatus;
  readonly mutationStatus?: FinalTruthMutationStatus;
  readonly repositoryStatus?: FinalTruthRepositoryStatus;
  readonly recoveryStatus?: FinalTruthRecoveryStatus;
  readonly currentStep?: string;
  readonly currentOperation?: string;
  readonly changeSetFiles?: ReadonlyArray<string>;
  readonly baselineCommit?: string;
  readonly planId?: string;
  readonly resumedFromRunId?: string;
  readonly resumedFromCheckpointId?: string;
  readonly processPid?: number;
}

export function transitionFinalTruth(
  current: FinalTruth,
  to: FinalTruthStatus,
  patch: FinalTruthPatch = {},
): FinalTruth {
  assertTransition(current.status, to);
  const now = patch.now ?? new Date().toISOString();
  const entry: FinalTruthTransition = Object.freeze({
    from: current.status,
    to,
    at: now,
    reason: patch.reason,
  });
  return Object.freeze({
    ...current,
    status: to,
    reason: patch.reason ?? current.reason,
    verificationStatus: patch.verificationStatus ?? current.verificationStatus,
    mutationStatus: patch.mutationStatus ?? current.mutationStatus,
    repositoryStatus: patch.repositoryStatus ?? current.repositoryStatus,
    recoveryStatus: patch.recoveryStatus ?? current.recoveryStatus,
    transitionHistory: Object.freeze([...current.transitionHistory, entry]),
    lastHeartbeat: now,
    currentStep: patch.currentStep ?? current.currentStep,
    currentOperation: patch.currentOperation ?? current.currentOperation,
    changeSetFiles: patch.changeSetFiles ?? current.changeSetFiles,
    baselineCommit: patch.baselineCommit ?? current.baselineCommit,
    planId: patch.planId ?? current.planId,
    resumedFromRunId: patch.resumedFromRunId ?? current.resumedFromRunId,
    resumedFromCheckpointId: patch.resumedFromCheckpointId ?? current.resumedFromCheckpointId,
    processPid: patch.processPid ?? current.processPid,
    timestamp: now,
  });
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid === null || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function heartbeatFinalTruth(
  current: FinalTruth,
  patch: {
    readonly now?: string;
    readonly currentStep?: string;
    readonly currentOperation?: string;
  } = {},
): FinalTruth {
  const now = patch.now ?? new Date().toISOString();
  return Object.freeze({
    ...current,
    lastHeartbeat: now,
    currentStep: patch.currentStep ?? current.currentStep,
    currentOperation: patch.currentOperation ?? current.currentOperation,
    timestamp: now,
  });
}

export function isHeartbeatExpired(
  truth: FinalTruth,
  nowMs: number,
  expiryMs: number = DEFAULT_HEARTBEAT_EXPIRY_MS,
): boolean {
  const last = Date.parse(truth.lastHeartbeat);
  if (Number.isNaN(last)) return true;
  return nowMs - last > expiryMs;
}

/**
 * COMPLETED requires acceptance-phase readiness, PASSED verification,
 * and no PARTIAL_FAILURE repository state. SKIPPED/NOT_RUN forbid COMPLETED.
 */
export function canDeclareCompleted(truth: FinalTruth): boolean {
  if (truth.repositoryStatus === 'PARTIAL_FAILURE') return false;
  if (truth.verificationStatus !== 'PASSED') return false;
  if (truth.mutationStatus === 'FAILED' || truth.mutationStatus === 'ROLLED_BACK') return false;
  if (truth.status !== 'ACCEPTANCE' && truth.status !== 'COMPLETED') return false;
  return true;
}

/** Map FinalTruth status onto TaskRunSnapshot.status compat values. */
export function mapFinalTruthToTaskRunStatus(status: FinalTruthStatus): string {
  switch (status) {
    case 'RUNNING':
      return 'RUNNING';
    case 'PLANNING':
      return 'PLANNING';
    case 'CONTEXT':
      return 'CONTEXT';
    case 'EXECUTION':
      return 'EXECUTION';
    case 'VERIFICATION':
      return 'VERIFICATION';
    case 'ACCEPTANCE':
      return 'ACCEPTANCE';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'INTERRUPTED':
      return 'INTERRUPTED';
    default:
      return 'RUNNING';
  }
}