import { LlmProvider } from '../../contracts/llm-provider';
import {
  ProviderAuthenticationError,
  ProviderContextLengthExceededError,
  ProviderError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../domain/errors/provider-errors';
import {
  DEFAULT_PROVIDER_SMOKE_TIMEOUT_MS,
  PROVIDER_SMOKE_PROMPT,
  ProviderSmokeFailureCategory,
  ProviderSmokeTestOptions,
  ProviderSmokeTestResult,
} from '../../domain/provider-smoke-test';

export interface ProviderSmokeTestContext {
  readonly providerType: string;
  readonly endpoint: string;
  readonly model: string;
}

/**
 * Minimal completion probe through the LlmProvider boundary.
 * Vendor HTTP details stay inside provider implementations.
 */
export async function runProviderSmokeTest(
  provider: LlmProvider,
  context: ProviderSmokeTestContext,
  options?: ProviderSmokeTestOptions,
): Promise<ProviderSmokeTestResult> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PROVIDER_SMOKE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof (timer as any).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }
  const started = Date.now();

  try {
    const response = await provider.generate({
      model: context.model,
      messages: [{ role: 'user', content: PROVIDER_SMOKE_PROMPT }],
      temperature: 0,
      maxTokens: 16,
      signal: controller.signal,
      observability: { stage: 'unknown' },
    });

    const latencyMs = Date.now() - started;
    const content = (response.content ?? '').trim();
    if (!content) {
      return {
        providerType: context.providerType,
        endpoint: context.endpoint,
        model: context.model,
        latencyMs,
        success: false,
        failureCategory: 'empty_response',
        message: 'Provider returned an empty completion',
        checkedAt,
      };
    }

    return {
      providerType: context.providerType,
      endpoint: context.endpoint,
      model: context.model,
      latencyMs,
      success: true,
      responsePreview: content.slice(0, 80),
      checkedAt,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const failureCategory = classifyProviderSmokeFailure(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      providerType: context.providerType,
      endpoint: context.endpoint,
      model: context.model,
      latencyMs,
      success: false,
      failureCategory,
      message,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyProviderSmokeFailure(err: unknown): ProviderSmokeFailureCategory {
  if (err instanceof ProviderAuthenticationError) return 'authentication';
  if (err instanceof ProviderUnavailableError) return 'unavailable';
  if (err instanceof ProviderModelNotFoundError) return 'model_not_found';
  if (err instanceof ProviderRateLimitError) return 'rate_limit';
  if (err instanceof ProviderContextLengthExceededError) return 'context_length';
  if (err instanceof ProviderInvalidResponseError) return 'invalid_response';
  if (err instanceof ProviderError) return 'provider_error';
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return 'unavailable';
  }
  return 'unknown';
}
