/**
 * Reliability Hardening R1 — verification side-effect policy (R1.25-R1.28).
 *
 * Verification declares up front whether it only reads project state or
 * needs a controlled mutation. Anything a verifier does that could change
 * the project is recorded here, so "V&V changed my data" stops being an
 * invisible surprise and becomes evidence.
 */

export const VERIFICATION_SIDE_EFFECT_POLICIES = ['READ_ONLY', 'CONTROLLED_MUTATION'] as const;
export type VerificationSideEffectPolicy = (typeof VERIFICATION_SIDE_EFFECT_POLICIES)[number];

export const VERIFICATION_SIDE_EFFECT_KINDS = [
  'HTTP_MUTATION',
  'FILE_WRITE',
  'DB_WRITE',
  'GIT_MUTATION',
  'PROCESS_SPAWN',
] as const;
export type VerificationSideEffectKind = (typeof VERIFICATION_SIDE_EFFECT_KINDS)[number];

export const VERIFICATION_SIDE_EFFECT_STATUSES = [
  'PERFORMED',
  'BLOCKED',
  'SKIPPED',
  'REVERTED',
] as const;
export type VerificationSideEffectStatus = (typeof VERIFICATION_SIDE_EFFECT_STATUSES)[number];

export interface VerificationSideEffect {
  readonly id: string;
  readonly source: string;
  readonly kind: VerificationSideEffectKind;
  /** What was (or would have been) touched: a URL, a path, a table. */
  readonly target: string;
  readonly policy: VerificationSideEffectPolicy;
  readonly status: VerificationSideEffectStatus;
  readonly declared: boolean;
  readonly reversible: boolean;
  readonly detail: string;
}

export interface VerificationSideEffectLedger {
  readonly policy: VerificationSideEffectPolicy;
  readonly effects: ReadonlyArray<VerificationSideEffect>;
  readonly performedCount: number;
  readonly blockedCount: number;
  readonly undeclaredCount: number;
}

export function buildSideEffectLedger(input: {
  readonly policy: VerificationSideEffectPolicy;
  readonly effects: ReadonlyArray<VerificationSideEffect>;
}): VerificationSideEffectLedger {
  const effects = Object.freeze([...input.effects]);
  return Object.freeze({
    policy: input.policy,
    effects,
    performedCount: effects.filter(effect => effect.status === 'PERFORMED').length,
    blockedCount: effects.filter(effect => effect.status === 'BLOCKED').length,
    undeclaredCount: effects.filter(effect => !effect.declared && effect.status === 'PERFORMED').length,
  });
}

export const EMPTY_SIDE_EFFECT_LEDGER: VerificationSideEffectLedger = buildSideEffectLedger({
  policy: 'READ_ONLY',
  effects: [],
});
