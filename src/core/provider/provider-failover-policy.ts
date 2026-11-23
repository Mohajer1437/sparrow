/**
 * Failover policy for ResilientLlmProvider.
 *
 * Domain ProviderError types describe facts only. This module decides which
 * facts indicate provider unavailability (failover) vs request/application
 * errors (no failover).
 */

import {
  ProviderAuthenticationError,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../domain/errors/provider-errors';

export type ProviderFailureCategory =
  | 'unavailable'
  | 'rate_limit'
  | 'timeout'
  | 'authentication'
  | 'model_not_found'
  | 'context_length'
  | 'invalid_response'
  | 'application'
  | 'unknown';

/** Safe, secret-free reason string for user-visible failover messages. */
export function safeProviderFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeFailureMessage(error.message || error.name);
  }
  return sanitizeFailureMessage(String(error));
}

function sanitizeFailureMessage(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer ***')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'api_key=***')
    .slice(0, 240);
}

export function classifyProviderFailure(error: unknown): ProviderFailureCategory {
  if (error instanceof ProviderUnavailableError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('aborted') || msg.includes('abort')) {
      return 'timeout';
    }
    return 'unavailable';
  }
  if (error instanceof ProviderRateLimitError) return 'rate_limit';
  if (error instanceof ProviderAuthenticationError) return 'authentication';
  if (error instanceof ProviderModelNotFoundError) return 'model_not_found';
  if (error instanceof ProviderContextLengthExceededError) return 'context_length';
  if (error instanceof ProviderInvalidResponseError) return 'invalid_response';
  if (error instanceof ProviderError) return 'application';

  if (error && typeof error === 'object' && (error as any).name === 'AbortError') {
    return 'timeout';
  }

  const msg = String((error as any)?.message ?? error ?? '').toLowerCase();
  if (
    msg.includes('econnrefused')
    || msg.includes('econnreset')
    || msg.includes('enotfound')
    || msg.includes('fetch failed')
    || msg.includes('network')
    || msg.includes('connection refused')
  ) {
    return 'unavailable';
  }
  if (msg.includes('timeout') || msg.includes('aborted')) {
    return 'timeout';
  }
  if (/\b429\b/.test(msg) || msg.includes('rate limit')) {
    return 'rate_limit';
  }
  if (/\b502\b/.test(msg) || /\b503\b/.test(msg) || /\b504\b/.test(msg)) {
    return 'unavailable';
  }

  return 'unknown';
}

/**
 * True when the failure indicates the *provider* is unavailable for this
 * operation and the same ModelRequest may be retried on another provider.
 */
export function isFailoverCandidate(error: unknown): boolean {
  const category = classifyProviderFailure(error);
  return (
    category === 'unavailable'
    || category === 'rate_limit'
    || category === 'timeout'
  );
}
