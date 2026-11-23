/**
 * Reliability Hardening R1 — per-Todo verification evidence (R1.1-R1.10).
 *
 * A Todo verdict is derived only from checks that are explicitly mapped to
 * that Todo. Whole-run evidence stays whole-run: it can never be promoted
 * into a Todo-level PASS, and a missing required check can never be.
 */

export const VERIFICATION_SCOPES = ['TODO_SPECIFIC', 'WHOLE_RUN', 'UNKNOWN'] as const;
export type VerificationScope = (typeof VERIFICATION_SCOPES)[number];

export const VERIFICATION_CHECK_STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN'] as const;
export type VerificationCheckStatus = (typeof VERIFICATION_CHECK_STATUSES)[number];

export const TODO_VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN', 'NOT_TESTED'] as const;
export type TodoVerdictKind = (typeof TODO_VERDICTS)[number];

/** How a check became attached to a Todo. Text matching is deliberately absent. */
export const TODO_MAPPING_SOURCES = [
  'EXPLICIT_CHECK_TODO_ID',
  'EXECUTION_STEP_MAPPING',
  'ENDPOINT_VERIFICATION',
  'BROWSER_VERIFICATION',
  'DATABASE_VERIFICATION',
  'NONE',
] as const;
export type TodoMappingSource = (typeof TODO_MAPPING_SOURCES)[number];

export interface TodoVerificationCheckResult {
  readonly checkId: string;
  readonly name: string;
  readonly category: string;
  readonly todoId?: string;
  readonly scope: VerificationScope;
  readonly status: VerificationCheckStatus;
  readonly mappingSource: TodoMappingSource;
  readonly required: boolean;
  readonly expected?: string;
  readonly actual?: string;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly source: string;
}

export interface TodoVerificationResult {
  readonly todoId: string;
  readonly scope: VerificationScope;
  readonly verdict: TodoVerdictKind;
  readonly requiredChecks: ReadonlyArray<string>;
  readonly executedChecks: ReadonlyArray<string>;
  readonly missingChecks: ReadonlyArray<string>;
  readonly results: ReadonlyArray<TodoVerificationCheckResult>;
  readonly reason: string;
}

export interface TodoVerificationReport {
  /** TODO_SPECIFIC when at least one Todo carries Todo-specific evidence. */
  readonly scope: VerificationScope;
  readonly verdicts: ReadonlyArray<TodoVerificationResult>;
  readonly wholeRunChecks: ReadonlyArray<TodoVerificationCheckResult>;
  readonly todosTotal: number;
  readonly todosVerified: number;
  readonly todosFailed: number;
  readonly todosBlocked: number;
  readonly todosUnknown: number;
  readonly todosNotTested: number;
}

/**
 * Verification requirements whose evidence can genuinely be attributed to a
 * single Todo. Requirements outside this set (typecheck, lint, deterministic,
 * intent-contract, unit-test) are whole-run by nature: satisfying them produces
 * WHOLE_RUN evidence (R1.10), so their absence from Todo-specific evidence is
 * not itself a reliability signal.
 */
export const TODO_ATTRIBUTABLE_REQUIREMENTS: ReadonlyArray<string> = Object.freeze([
  'browser',
  'api',
  'auth',
  'authorization',
  'error-handling',
  'database-read-check',
  'ui-acceptance',
]);

export function isTodoAttributableRequirement(value: string): boolean {
  return TODO_ATTRIBUTABLE_REQUIREMENTS.includes(value);
}

export function isVerificationScope(value: unknown): value is VerificationScope {
  return typeof value === 'string' && (VERIFICATION_SCOPES as ReadonlyArray<string>).includes(value);
}

/**
 * Derives one Todo verdict from its mapped checks (R1.3-R1.5).
 *
 * Ordering matters and is intentional:
 *   any required FAIL  -> FAIL
 *   any BLOCKED        -> BLOCKED
 *   missing required   -> UNKNOWN (never PASS)
 *   no mapped check    -> NOT_TESTED
 */
export function deriveTodoVerdict(input: {
  readonly todoId: string;
  readonly requiredChecks: ReadonlyArray<string>;
  readonly results: ReadonlyArray<TodoVerificationCheckResult>;
  readonly executed: boolean;
}): TodoVerificationResult {
  const specific = input.results.filter(result => result.scope === 'TODO_SPECIFIC');
  const executedChecks = specific.map(result => result.checkId);
  const satisfied = new Set(
    specific
      .filter(result => result.status === 'PASS' || result.status === 'FAIL')
      .map(result => normalizeRequirement(result.name))
      .concat(specific.map(result => normalizeRequirement(result.category))),
  );
  const missingChecks = input.requiredChecks.filter(
    requirement => !satisfied.has(normalizeRequirement(requirement)),
  );

  const base = {
    todoId: input.todoId,
    requiredChecks: Object.freeze([...input.requiredChecks]),
    executedChecks: Object.freeze(executedChecks),
    missingChecks: Object.freeze(missingChecks),
    results: Object.freeze([...input.results]),
  };

  if (specific.length === 0) {
    return Object.freeze({
      ...base,
      scope: 'WHOLE_RUN' as const,
      verdict: input.executed ? ('UNKNOWN' as const) : ('NOT_TESTED' as const),
      reason: input.executed
        ? 'no verification check is mapped to this todo; evidence is whole-run'
        : 'todo was not executed and no verification check is mapped to it',
    });
  }

  if (specific.some(result => result.status === 'FAIL' && result.required)) {
    return Object.freeze({
      ...base,
      scope: 'TODO_SPECIFIC' as const,
      verdict: 'FAIL' as const,
      reason: 'a required todo-specific check failed',
    });
  }

  if (specific.some(result => result.status === 'FAIL')) {
    return Object.freeze({
      ...base,
      scope: 'TODO_SPECIFIC' as const,
      verdict: 'FAIL' as const,
      reason: 'a todo-specific check failed',
    });
  }

  if (specific.some(result => result.status === 'BLOCKED')) {
    return Object.freeze({
      ...base,
      scope: 'TODO_SPECIFIC' as const,
      verdict: 'BLOCKED' as const,
      reason: 'a todo-specific check was blocked',
    });
  }

  if (missingChecks.length > 0) {
    return Object.freeze({
      ...base,
      scope: 'TODO_SPECIFIC' as const,
      verdict: 'UNKNOWN' as const,
      reason: `required checks without todo-specific evidence: ${missingChecks.join(', ')}`,
    });
  }

  if (specific.every(result => result.status === 'UNKNOWN')) {
    return Object.freeze({
      ...base,
      scope: 'TODO_SPECIFIC' as const,
      verdict: 'UNKNOWN' as const,
      reason: 'todo-specific checks produced no conclusive status',
    });
  }

  return Object.freeze({
    ...base,
    scope: 'TODO_SPECIFIC' as const,
    verdict: 'PASS' as const,
    reason: 'all mapped todo-specific checks passed and no required check is missing',
  });
}

export function summarizeTodoVerification(input: {
  readonly verdicts: ReadonlyArray<TodoVerificationResult>;
  readonly wholeRunChecks: ReadonlyArray<TodoVerificationCheckResult>;
}): TodoVerificationReport {
  const verdicts = Object.freeze([...input.verdicts]);
  const count = (kind: TodoVerdictKind): number =>
    verdicts.filter(verdict => verdict.verdict === kind).length;
  return Object.freeze({
    scope: verdicts.some(verdict => verdict.scope === 'TODO_SPECIFIC')
      ? ('TODO_SPECIFIC' as const)
      : ('WHOLE_RUN' as const),
    verdicts,
    wholeRunChecks: Object.freeze([...input.wholeRunChecks]),
    todosTotal: verdicts.length,
    todosVerified: count('PASS'),
    todosFailed: count('FAIL'),
    todosBlocked: count('BLOCKED'),
    todosUnknown: count('UNKNOWN'),
    todosNotTested: count('NOT_TESTED'),
  });
}

function normalizeRequirement(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}
