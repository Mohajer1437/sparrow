import * as crypto from 'crypto';

/**
 * Milestone R6 — First-Class Run Correlation & Observability Hardening.
 *
 * Establishes typed domain contracts for correlation identifiers:
 * - taskId: represents the logical user task.
 * - runId: represents exactly one execution of the workflow.
 * - sessionId: represents the adapter/application session (REPL, CLI, Web).
 * - attemptId: represents one execution/repair attempt inside a run.
 *
 * Invariants:
 * 1. sessionId !== runId semantically.
 * 2. One run -> one runId.
 * 3. All events in a run -> same runId.
 * 4. Repair attempts in a run -> same runId, distinct attemptId.
 * 5. UNKNOWN / missing correlation must be explicit, never guessed.
 */

export const LEGACY_UNKNOWN_RUN_ID = 'LEGACY_UNKNOWN';
export const UNKNOWN_IDENTIFIER = 'UNKNOWN';

export const RUN_LIFECYCLE_STATES = [
  'CREATED',
  'STARTED',
  'RUNNING',
  'TERMINAL',
] as const;
export type RunLifecycleState = (typeof RUN_LIFECYCLE_STATES)[number];

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export function isValidIdentifier(id: unknown): id is string {
  return typeof id === 'string' && IDENTIFIER_PATTERN.test(id) && !id.includes('..');
}

export interface CorrelationContext {
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly attemptId?: string;
}

export interface CorrelationValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
}

export function validateCorrelationContext(context: unknown): CorrelationValidationResult {
  const errors: string[] = [];
  if (!context || typeof context !== 'object') {
    return { valid: false, errors: ['CorrelationContext must be a non-null object'] };
  }

  const candidate = context as Partial<CorrelationContext>;

  if (!candidate.taskId || typeof candidate.taskId !== 'string') {
    errors.push('taskId is required and must be a non-empty string');
  } else if (!isValidIdentifier(candidate.taskId)) {
    errors.push(`taskId '${candidate.taskId}' contains invalid characters or escapes boundary`);
  }

  if (!candidate.runId || typeof candidate.runId !== 'string') {
    errors.push('runId is required and must be a non-empty string');
  } else if (!isValidIdentifier(candidate.runId)) {
    errors.push(`runId '${candidate.runId}' contains invalid characters or escapes boundary`);
  }

  if (!candidate.sessionId || typeof candidate.sessionId !== 'string') {
    errors.push('sessionId is required and must be a non-empty string');
  } else if (!isValidIdentifier(candidate.sessionId)) {
    errors.push(`sessionId '${candidate.sessionId}' contains invalid characters or escapes boundary`);
  }

  if (candidate.attemptId !== undefined) {
    if (typeof candidate.attemptId !== 'string' || !candidate.attemptId.trim()) {
      errors.push('attemptId, when provided, must be a non-empty string');
    } else if (!isValidIdentifier(candidate.attemptId)) {
      errors.push(`attemptId '${candidate.attemptId}' contains invalid characters or escapes boundary`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  };
}

export function assertValidCorrelationContext(context: unknown): asserts context is CorrelationContext {
  const result = validateCorrelationContext(context);
  if (!result.valid) {
    throw new Error(`Invalid correlation context: ${result.errors.join('; ')}`);
  }
}

export function buildTaskId(startedAt?: string, suffix?: string): string {
  const ts = (startedAt ? new Date(startedAt) : new Date())
    .toISOString()
    .replace(/[:.]/g, '-');
  const rand = suffix ?? crypto.randomBytes(3).toString('hex');
  return `task-${ts}-${rand}`;
}

export function buildRunId(startedAt?: string, suffix?: string): string {
  const ts = (startedAt ? new Date(startedAt) : new Date())
    .toISOString()
    .replace(/[:.]/g, '-');
  const rand = suffix ?? crypto.randomBytes(3).toString('hex');
  return `run-${ts}-${rand}`;
}

export function buildSessionId(prefix = 'session'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

export function buildAttemptId(attemptNumber: number): string {
  const num = Math.max(1, Math.floor(attemptNumber));
  return `attempt-${num}`;
}

export function buildEventId(runId: string, seq: number): string {
  const rand = crypto.randomBytes(2).toString('hex');
  return `evt-${runId}-${seq}-${rand}`;
}

/**
 * Deterministic audit fingerprint for run identity (R6.42).
 * Computed from immutable fields: taskId, runId, startedAt.
 */
export function computeRunFingerprint(taskId: string, runId: string, startedAt: string): string {
  return crypto
    .createHash('sha256')
    .update(`${taskId}:${runId}:${startedAt}`, 'utf8')
    .digest('hex')
    .substring(0, 16);
}
