/**
 * Reliability Hardening R1 — explicit execution mode (R1.18).
 *
 * The mode is a system-level contract chosen by the caller, never inferred
 * from task wording. READ_ONLY is enforced by deterministic policy in the
 * tool executor and the workflow, so an LLM cannot talk its way past it.
 */

export const EXECUTION_MODES = ['STANDARD', 'READ_ONLY', 'INTERNAL_VALIDATION'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'STANDARD';

/** Reason attached to anything the read-only policy refuses. */
export const READ_ONLY_BLOCK_REASON = 'READ_ONLY';

export const BLOCKED_BY_POLICY = 'BLOCKED_BY_POLICY';

/**
 * Tools that can change project state. Names match the registered workspace
 * tools plus the aliases a provider may emit for the same operation.
 */
export const MUTATING_TOOL_NAMES: ReadonlyArray<string> = Object.freeze([
  'write_file',
  'create_file',
  'delete_file',
  'apply_patch',
  'edit_file',
  'rename_file',
  'move_file',
  'copy_file',
  'git_commit',
  'git_add',
  'git_stage',
  'git_checkout',
  'git_reset',
  'run_migration',
  'db_write',
  'execute_sql',
]);

/** Substrings that identify a mutating operation even for unregistered names. */
const MUTATING_TOKENS: ReadonlyArray<string> = Object.freeze([
  'write', 'create', 'delete', 'remove', 'patch', 'rename', 'move',
  'commit', 'stage', 'reset', 'checkout', 'insert', 'update', 'drop',
  'truncate', 'migrate', 'mkdir', 'chmod',
]);

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && (EXECUTION_MODES as ReadonlyArray<string>).includes(value);
}

/** Modes that forbid any state change. */
export function isNonMutatingMode(mode: ExecutionMode): boolean {
  return mode === 'READ_ONLY' || mode === 'INTERNAL_VALIDATION';
}

export function isMutatingTool(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (MUTATING_TOOL_NAMES.includes(name)) return true;
  return MUTATING_TOKENS.some(token => name.includes(token));
}

export interface ExecutionModeDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly rule?: string;
}

/** Deterministic answer to "may this tool run under this mode?" (R1.20). */
export function evaluateToolAgainstMode(
  mode: ExecutionMode,
  toolName: string,
): ExecutionModeDecision {
  if (!isNonMutatingMode(mode)) return { allowed: true };
  if (!isMutatingTool(toolName)) return { allowed: true };
  return {
    allowed: false,
    rule: 'RULE_READ_ONLY',
    reason: `${BLOCKED_BY_POLICY}: ${toolName} is a mutation operation and the execution mode is ${READ_ONLY_BLOCK_REASON}`,
  };
}

/** Git mutations are blocked wholesale in READ_ONLY (R1.22). */
export function allowsGitMutation(mode: ExecutionMode): boolean {
  return !isNonMutatingMode(mode);
}

/** Only SELECT-style reads survive READ_ONLY (R1.23). */
export function allowsDatabaseMutation(mode: ExecutionMode): boolean {
  return !isNonMutatingMode(mode);
}

/** HTTP verbs a read-only verification probe may issue (R1.21). */
export const READ_ONLY_HTTP_METHODS: ReadonlyArray<string> = Object.freeze(['GET', 'HEAD', 'OPTIONS']);

export function allowsHttpMethod(mode: ExecutionMode, method: string): boolean {
  if (!isNonMutatingMode(mode)) return true;
  return READ_ONLY_HTTP_METHODS.includes(method.trim().toUpperCase());
}

export type ExecutionModeSource =
  | 'EXPLICIT_CALLER'
  | 'EXPLICIT_COMMAND'
  | 'TASK_DIRECTIVE'
  | 'DEFAULT';

export interface AuthoritativeExecutionMode {
  readonly mode: ExecutionMode;
  readonly source: ExecutionModeSource;
  readonly authoritative: true;
}

const READ_ONLY_COMMAND_PATTERN = /(?:^|\s)(?:--read-only|\/inspect\b)/i;

const READ_ONLY_TASK_PATTERN =
  /\b(read_only|read-only|read only|do not modify|do not create|do not edit|only inspect|only analyze|reconnaissance|understanding report|architecture discovery|inspection task)\b/i;

/**
 * Deterministic markers for an internal validation run. These requests target a
 * validator directly and must never reach the planner, so detection is pattern
 * based and never delegated to a model.
 */
const INTERNAL_VALIDATION_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\binternal[\s_-]*(unit[\s_-]*)?validation([\s_-]*run)?\b/i,
  /\bdo not run (the )?full pipeline\b/i,
  /\bcall only:/i,
  /\bdirectly call (the )?validation boundary\b/i,
  /\bdo not invoke (the )?planner\b/i,
  /\bdo not invoke (the )?llm\b/i,
]);

export function isInternalValidationDirective(text?: string): boolean {
  if (!text) return false;
  return INTERNAL_VALIDATION_PATTERNS.some(pattern => pattern.test(text));
}

export function isReadOnlyDirective(text?: string): boolean {
  if (!text) return false;
  return READ_ONLY_COMMAND_PATTERN.test(text) || READ_ONLY_TASK_PATTERN.test(text);
}

export function resolveAuthoritativeExecutionMode(input?: {
  readonly executionMode?: ExecutionMode | string;
  readonly task?: string;
}): AuthoritativeExecutionMode {
  // Internal validation is the most restrictive mode: it bypasses the whole
  // task pipeline, so it is resolved before any other directive.
  if (input?.executionMode === 'INTERNAL_VALIDATION') {
    return Object.freeze({
      mode: 'INTERNAL_VALIDATION',
      source: 'EXPLICIT_CALLER',
      authoritative: true,
    });
  }

  if (input?.task && isInternalValidationDirective(input.task)) {
    return Object.freeze({
      mode: 'INTERNAL_VALIDATION',
      source: 'TASK_DIRECTIVE',
      authoritative: true,
    });
  }

  if (input?.executionMode === 'READ_ONLY') {
    return Object.freeze({
      mode: 'READ_ONLY',
      source: 'EXPLICIT_CALLER',
      authoritative: true,
    });
  }

  if (input?.task && READ_ONLY_COMMAND_PATTERN.test(input.task)) {
    return Object.freeze({
      mode: 'READ_ONLY',
      source: 'EXPLICIT_COMMAND',
      authoritative: true,
    });
  }

  if (input?.task && READ_ONLY_TASK_PATTERN.test(input.task)) {
    return Object.freeze({
      mode: 'READ_ONLY',
      source: 'TASK_DIRECTIVE',
      authoritative: true,
    });
  }

  if (input?.executionMode === 'STANDARD') {
    return Object.freeze({
      mode: 'STANDARD',
      source: 'EXPLICIT_CALLER',
      authoritative: true,
    });
  }

  return Object.freeze({
    mode: DEFAULT_EXECUTION_MODE,
    source: 'DEFAULT',
    authoritative: true,
  });
}

