import { Provider, ModelRequest, ModelResponse } from '../../contracts/provider';
import type { LlmProvider } from '../../contracts/llm-provider';
import { Message } from '../../domain/message';
import { ToolCall } from '../../domain/tool';
import {
  ProviderError,
  ProviderAuthenticationError,
  ProviderUnavailableError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
  ProviderContextLengthExceededError,
  ProviderRateLimitError,
} from '../../domain/errors/provider-errors';
import { ExecutionLogger } from '../observability/execution-logger';
import { countPromptChars } from './prompt-char-count';
import {
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  ProviderHealthOptions,
  ProviderHealthResult,
} from '../../domain/provider-health';

/** Bound PROVIDER_META.error so large response bodies never land in pipeline logs. */
const MAX_PROVIDER_META_ERROR_CHARS = 500;

export type OpenAICompatibleProviderOptions = {
  readonly baseUrl: string;
  readonly apiKey: string;
};

function truncateProviderMetaError(text: string): string {
  if (text.length <= MAX_PROVIDER_META_ERROR_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PROVIDER_META_ERROR_CHARS)}…`;
}

/**
 * Resolve OpenAI-compatible chat completions URL from a configurable base.
 * Accepts either an API root (.../v1) or a full .../chat/completions URL.
 */
export function resolveOpenAICompatibleChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (!trimmed) {
    throw new ProviderError('OpenAI-compatible baseUrl is empty');
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

/**
 * Resolve OpenAI-compatible models list URL (non-completion health probe).
 * Strips a trailing /chat/completions if present so health never hits completions.
 */
export function resolveOpenAICompatibleModelsUrl(baseUrl: string): string {
  let trimmed = baseUrl.trim().replace(/\/$/, '');
  if (!trimmed) {
    throw new ProviderError('OpenAI-compatible baseUrl is empty');
  }
  trimmed = trimmed.replace(/\/chat\/completions$/i, '');
  if (/\/models$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/models`;
}

/**
 * Generic OpenAI Chat Completions client (OpenRouter, OmniRoute, local gateways, etc.).
 * Does not hard-code a vendor — only Bearer auth + /chat/completions JSON shape.
 */
export class OpenAICompatibleProvider implements Provider, LlmProvider {
  constructor(private readonly options: OpenAICompatibleProviderOptions) {}

  /**
   * Non-completion probe via GET /models with Bearer auth (no chat, no tokens).
   */
  async checkHealth(options?: ProviderHealthOptions): Promise<ProviderHealthResult> {
    const endpoint = resolveOpenAICompatibleModelsUrl(this.options.baseUrl);
    const configuredModel = options?.model;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS;
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;

      if (response.status === 401 || response.status === 403) {
        return {
          providerType: 'openai-compatible',
          endpoint,
          configuredModel,
          authentication: 'failed',
          latencyMs,
          status: 'unauthorized',
          message: `HTTP ${response.status}`,
          checkedAt,
        };
      }

      if (!response.ok) {
        return {
          providerType: 'openai-compatible',
          endpoint,
          configuredModel,
          authentication: 'ok',
          latencyMs,
          status: 'unknown',
          message: `HTTP ${response.status}`,
          checkedAt,
        };
      }

      let modelNote: string | undefined;
      if (configuredModel) {
        try {
          const data = await response.json() as { data?: Array<{ id?: string }> };
          const ids = (data.data ?? []).map((m) => m.id).filter(Boolean) as string[];
          if (ids.length > 0 && !ids.includes(configuredModel)) {
            modelNote = `Configured model "${configuredModel}" not listed in /models (${ids.length} models present)`;
          }
        } catch {
          // body optional for auth/reachability
        }
      }

      return {
        providerType: 'openai-compatible',
        endpoint,
        configuredModel,
        authentication: 'ok',
        latencyMs,
        status: 'healthy',
        message: modelNote,
        checkedAt,
      };
    } catch (err: any) {
      return {
        providerType: 'openai-compatible',
        endpoint,
        configuredModel,
        authentication: 'not_checked',
        latencyMs: Date.now() - started,
        status: 'unavailable',
        message: err?.message ? String(err.message) : 'unreachable',
        checkedAt,
      };
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const url = resolveOpenAICompatibleChatUrl(this.options.baseUrl);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.translateMessages(request.messages),
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    const stage = request.observability?.stage ?? 'unknown';
    const retryAttempt = request.observability?.retryAttempt ?? 0;
    const requestSeq = ExecutionLogger.nextProviderRequestSeq();
    const messageCount = request.messages.length;
    const promptChars = countPromptChars(request.messages);
    const toolCount = request.tools?.length ?? 0;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    let httpStatus: number | undefined;
    let success = false;
    let error: string | undefined;

    const emitProviderMeta = (): void => {
      ExecutionLogger.log(
        'PROVIDER_META',
        stage,
        request.model,
        `chat attempt seq=${requestSeq} status=${httpStatus ?? 'n/a'} retry=${retryAttempt}`,
        {
          stage,
          requestSeq,
          retryAttempt,
          isRetry: retryAttempt > 0,
          messageCount,
          promptChars,
          toolCount,
          startedAt,
          durationMs: Date.now() - startMs,
          ...(httpStatus !== undefined ? { httpStatus } : {}),
          success,
          ...(error ? { error } : {}),
        },
      );
    };

    let response: Response;
    try {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (fetchError: any) {
        if (fetchError?.name === 'AbortError') {
          error = truncateProviderMetaError(String(fetchError.message || 'Aborted'));
          throw new ProviderUnavailableError(
            `OpenAI-compatible request timed out or was aborted: ${fetchError.message || 'Aborted'}`,
          );
        }
        error = truncateProviderMetaError(
          `Failed to connect to OpenAI-compatible API: ${fetchError.message}`,
        );
        throw new ProviderUnavailableError(
          `Failed to connect to OpenAI-compatible API: ${fetchError.message}`,
        );
      }

      httpStatus = response.status;

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        error = truncateProviderMetaError(text.trim() || `HTTP ${response.status}`);
        if (response.status === 401 || response.status === 403) {
          throw new ProviderAuthenticationError(
            `OpenAI-compatible authentication failed: ${response.status} ${text}`,
          );
        }
        if (response.status === 404) {
          throw new ProviderModelNotFoundError(
            `OpenAI-compatible model not found: ${request.model}`,
          );
        }
        if (response.status === 429) {
          throw new ProviderRateLimitError(
            `OpenAI-compatible rate limit: ${response.status} ${text}`,
          );
        }
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new ProviderUnavailableError(
            `OpenAI-compatible unavailable: HTTP ${response.status} ${text}`,
          );
        }
        if (
          response.status === 400 &&
          /context length|maximum context|token/i.test(text)
        ) {
          throw new ProviderContextLengthExceededError(
            `OpenAI-compatible context length exceeded: ${text}`,
          );
        }
        throw new ProviderError(`OpenAI-compatible API error: ${response.status} ${text}`);
      }

      success = true;

      let data: any;
      try {
        data = await response.json();
      } catch (parseError: any) {
        throw new ProviderInvalidResponseError(
          `Failed to parse OpenAI-compatible response: ${parseError.message}`,
        );
      }

      const choice = data?.choices?.[0];
      const message = choice?.message;
      if (!message) {
        throw new ProviderInvalidResponseError(
          'OpenAI-compatible response missing choices[0].message',
        );
      }

      let toolCalls: ToolCall[] | undefined;
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc: any, index: number) => ({
          id: typeof tc.id === 'string' && tc.id
            ? tc.id
            : `call_${index}_${Date.now()}`,
          name: tc.function?.name || '',
          arguments: typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
        }));
      }

      const promptTokens = data.usage?.prompt_tokens ?? 0;
      const completionTokens = data.usage?.completion_tokens ?? 0;

      ExecutionLogger.log(
        'PROVIDER',
        'openai-compatible',
        request.model,
        `Response: ${toolCalls?.length ?? 0} tool calls`,
        {
          contentLength: typeof message.content === 'string' ? message.content.length : 0,
          structuredToolCalls: toolCalls?.length ?? 0,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      );

      return {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        metadata: {
          model: data.model || request.model,
          finishReason: String(choice.finish_reason ?? ''),
        },
      };
    } finally {
      emitProviderMeta();
    }
  }

  private translateMessages(messages: ReadonlyArray<Readonly<Message>>): any[] {
    return messages.map((msg) => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      }

      const translated: any = {
        role: msg.role,
        content,
      };

      if (msg.tool_calls) {
        translated.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }));
      }

      if (msg.tool_call_id) {
        translated.tool_call_id = msg.tool_call_id;
      }

      return translated;
    });
  }
}
