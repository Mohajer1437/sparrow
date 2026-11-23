import { RepairAttempt, RepairAttemptHistory } from '../../domain/repair-intelligence';

/**
 * Equivalent retry detection. Additional evidence (new check ids or higher expansion)
 * can allow a new attempt even when the plan fingerprint matches.
 */
export function isDuplicateRepairPlan(input: {
  readonly history: RepairAttemptHistory;
  readonly nextFingerprint: string;
  readonly expansionLevel: number;
  readonly evidenceRefs?: ReadonlyArray<string>;
}): boolean {
  const previous = lastComparableAttempt(input.history);
  if (!previous) return false;
  if (previous.planFingerprint !== input.nextFingerprint) return false;
  if (input.expansionLevel > previous.expansionLevel) return false;
  if (hasAdditionalEvidence(previous.evidenceRefs, input.evidenceRefs ?? [])) return false;
  return true;
}

export function lastComparableAttempt(history: RepairAttemptHistory): RepairAttempt | undefined {
  for (let i = history.attempts.length - 1; i >= 0; i -= 1) {
    const attempt = history.attempts[i];
    if (attempt.planFingerprint && attempt.planFingerprint !== '::') {
      return attempt;
    }
  }
  return undefined;
}

function hasAdditionalEvidence(
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): boolean {
  const known = new Set(previous);
  return next.some(item => item && !known.has(item));
}
