export type VerificationCategory =
  | 'deterministic'
  | 'api'
  | 'browser'
  | 'security'
  | 'adversarial';

export type VerificationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** PHASE-09: SKIPPED/NOT_RUN must never aggregate as PASS. */
export type VerificationResultStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN';

export interface VerificationCheck {
  readonly id: string;
  readonly category: VerificationCategory;
  readonly name: string;
  /**
   * Legacy boolean. For SKIPPED/NOT_RUN this is false (PHASE-09: skip != pass).
   * Prefer `resultStatus` when present.
   */
  readonly passed: boolean;
  /** PHASE-09 authoritative check outcome. Absent => derived from `passed`. */
  readonly resultStatus?: VerificationResultStatus;
  readonly severity: VerificationSeverity;
  readonly evidence: string;
  readonly acceptanceCriterion?: string;
  /**
   * R1.6: set by the verifier that produced the check from a specific Todo.
   * It is the only trustworthy check-to-Todo mapping; nothing downstream may
   * reconstruct one from names or evidence text.
   */
  readonly todoId?: string;
  /** R1.2: explicit scope. Absent means the mapper decides from evidence. */
  readonly scope?: import('./todo-verification').VerificationScope;
  /** R1.4: whether the Todo verdict must not pass without this check. */
  readonly required?: boolean;
  readonly expected?: string;
  readonly actual?: string;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly source?: string;
}

export function resolveVerificationResultStatus(check: VerificationCheck): VerificationResultStatus {
  if (check.resultStatus) return check.resultStatus;
  return check.passed ? 'PASSED' : 'FAILED';
}

/** Overall report pass: every executed check passed; skips/not-run forbid PASS. */
export function aggregateVerificationPassed(checks: ReadonlyArray<VerificationCheck>): boolean {
  if (checks.length === 0) return false;
  let executed = 0;
  for (const check of checks) {
    const status = resolveVerificationResultStatus(check);
    if (status === 'SKIPPED' || status === 'NOT_RUN') return false;
    if (status === 'FAILED') return false;
    if (status === 'PASSED') executed += 1;
  }
  return executed > 0;
}
