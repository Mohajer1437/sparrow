/**
 * Result of a non-completion LLM provider health probe.
 * Does not involve chat/completions or token usage.
 */

export type ProviderHealthStatus =
  | 'healthy'
  | 'unavailable'
  | 'unauthorized'
  | 'unknown';

export type ProviderHealthAuthStatus =
  | 'ok'
  | 'failed'
  | 'not_required'
  | 'not_checked';

export interface ProviderHealthResult {
  readonly providerType: string;
  readonly endpoint: string;
  readonly configuredModel?: string;
  readonly authentication: ProviderHealthAuthStatus;
  /** Round-trip latency of the probe in milliseconds. */
  readonly latencyMs: number;
  readonly status: ProviderHealthStatus;
  readonly message?: string;
  readonly checkedAt: string;
}

export interface ProviderHealthOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
}

export const DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS = 5000;
