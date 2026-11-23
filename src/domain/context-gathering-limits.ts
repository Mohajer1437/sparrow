/**
 * Bounded context gathering limits.
 * Defaults live here so gatherers do not scatter magic numbers.
 */

export interface ContextGatheringLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxFileBytes: number;
  readonly maxTotalContextBytes: number;
}

export const DEFAULT_CONTEXT_GATHERING_LIMITS: ContextGatheringLimits = Object.freeze({
  maxFiles: 12,
  maxBytes: 120_000,
  maxFileBytes: 32_000,
  maxTotalContextBytes: 200_000,
});

export function freezeContextGatheringLimits(limits: ContextGatheringLimits): ContextGatheringLimits {
  return Object.freeze({
    maxFiles: limits.maxFiles,
    maxBytes: limits.maxBytes,
    maxFileBytes: limits.maxFileBytes,
    maxTotalContextBytes: limits.maxTotalContextBytes,
  });
}

export function mergeContextGatheringLimits(
  overrides?: Partial<ContextGatheringLimits>,
): ContextGatheringLimits {
  return freezeContextGatheringLimits({
    maxFiles: overrides?.maxFiles ?? DEFAULT_CONTEXT_GATHERING_LIMITS.maxFiles,
    maxBytes: overrides?.maxBytes ?? DEFAULT_CONTEXT_GATHERING_LIMITS.maxBytes,
    maxFileBytes: overrides?.maxFileBytes ?? DEFAULT_CONTEXT_GATHERING_LIMITS.maxFileBytes,
    maxTotalContextBytes: overrides?.maxTotalContextBytes ?? DEFAULT_CONTEXT_GATHERING_LIMITS.maxTotalContextBytes,
  });
}
