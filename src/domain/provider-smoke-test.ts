/**
 * Result of a minimal provider completion smoke test.
 * Uses one tiny chat completion; not part of Planner/Executor flows.
 */

export const PROVIDER_SMOKE_PROMPT = 'Reply exactly with: OK';

export type ProviderSmokeFailureCategory =
  | 'authentication'
  | 'unavailable'
  | 'model_not_found'
  | 'rate_limit'
  | 'context_length'
  | 'invalid_response'
  | 'empty_response'
  | 'provider_error'
  | 'unknown';

export interface ProviderSmokeTestResult {
  readonly providerType: string;
  readonly endpoint: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly failureCategory?: ProviderSmokeFailureCategory;
  readonly responsePreview?: string;
  readonly message?: string;
  readonly checkedAt: string;
}

export interface ProviderSmokeTestOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
}

export const DEFAULT_PROVIDER_SMOKE_TIMEOUT_MS = 30_000;
