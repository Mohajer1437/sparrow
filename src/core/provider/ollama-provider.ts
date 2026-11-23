import { Provider, ModelRequest, ModelResponse } from '../../contracts/provider';
import type { LlmProvider } from '../../contracts/llm-provider';
import { Message } from '../../domain/message';
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

export { countPromptChars } from './prompt-char-count';

/** Bound PROVIDER_META.error so large response bodies never land in pipeline logs. */
const MAX_PROVIDER_META_ERROR_CHARS = 500;

function truncateProviderMetaError(text: string): string {
  if (text.length <= MAX_PROVIDER_META_ERROR_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PROVIDER_META_ERROR_CHARS)}…`;
}

/**
 * Ollama-backed LlmProvider.
 * Sole HTTP client for Ollama /api/chat — application code must not call Ollama directly.
 */
export class OllamaProvider implements Provider, LlmProvider {
  constructor(private readonly baseUrl: string) {}

  /**
   * Non-completion probe via GET /api/tags (no chat, no tokens).
   */
  async checkHealth(options?: ProviderHealthOptions): Promise<ProviderHealthResult> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/api/tags`;
    const configuredModel = options?.model;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS;
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;

      if (response.status === 401 || response.status === 403) {
        return {
          providerType: 'ollama',
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
          providerType: 'ollama',
          endpoint,
          configuredModel,
          authentication: 'not_required',
          latencyMs,
          status: 'unknown',
          message: `HTTP ${response.status}`,
          checkedAt,
        };
      }

      let modelNote: string | undefined;
      if (configuredModel) {
        try {
          const data = await response.json() as { models?: Array<{ name?: string }> };
          const names = (data.models ?? []).map((m) => m.name).filter(Boolean) as string[];
          if (names.length > 0 && !names.includes(configuredModel)) {
            modelNote = `Configured model "${configuredModel}" not listed in /api/tags (${names.length} models present)`;
          }
        } catch {
          // tags body optional for reachability
        }
      }

      return {
        providerType: 'ollama',
        endpoint,
        configuredModel,
        authentication: 'not_required',
        latencyMs,
        status: 'healthy',
        message: modelNote,
        checkedAt,
      };
    } catch (err: any) {
      return {
        providerType: 'ollama',
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
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;

    // observability is never serialized into the Ollama body.
    const body: Record<string, any> = {
      model: request.model,
      messages: this.translateMessages(request.messages),
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    const options: Record<string, any> = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
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
        }
      );
    };

    let response: Response;
    try {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (fetchError: any) {
        if (fetchError?.name === 'AbortError') {
          error = truncateProviderMetaError(String(fetchError.message || 'Aborted'));
          throw new ProviderUnavailableError(
            `Ollama request timed out or was aborted: ${fetchError.message || 'Aborted'}`,
          );
        }
        error = truncateProviderMetaError(`Failed to connect to Ollama: ${fetchError.message}`);
        throw new ProviderUnavailableError(`Failed to connect to Ollama: ${fetchError.message}`);
      }

      httpStatus = response.status;

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        error = truncateProviderMetaError(text.trim() || `HTTP ${response.status}`);
        if (response.status === 401 || response.status === 403) {
          throw new ProviderAuthenticationError(`Ollama authentication failed: ${response.status} ${text}`);
        }
        if (response.status === 404) {
          throw new ProviderModelNotFoundError(`Ollama model not found: ${request.model}`);
        }
        if (response.status === 429) {
          throw new ProviderRateLimitError(`Ollama rate limit: ${response.status} ${text}`);
        }
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new ProviderUnavailableError(
            `Ollama unavailable: HTTP ${response.status} ${text}`,
          );
        }
        if (response.status === 400 && text.toLowerCase().includes('context length')) {
           throw new ProviderContextLengthExceededError(`Ollama context length exceeded: ${text}`);
        }
        throw new ProviderError(`Ollama API error: ${response.status} ${text}`);
      }

      // HTTP attempt succeeded; remaining work is response parsing only.
      success = true;

      let data: any;
      try {
        data = await response.json();
      } catch (parseError: any) {
        throw new ProviderInvalidResponseError(`Failed to parse Ollama response: ${parseError.message}`);
      }

      if (!data.message) {
        throw new ProviderInvalidResponseError('Ollama response missing message');
      }

      let toolCalls: any[] | undefined = undefined;
      if (data.message.tool_calls && Array.isArray(data.message.tool_calls) && data.message.tool_calls.length > 0) {
        toolCalls = data.message.tool_calls.map((tc: any, index: number) => ({
          id: `call_${index}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: tc.function?.name || '',
          arguments: typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || {})
        }));
      }

      // Fallback: some models return tool calls as JSON text in content
      if (
        (!toolCalls || toolCalls.length === 0) &&
        request.tools && request.tools.length > 0 &&
        data.message.content
      ) {
        try {
          const content = data.message.content;
          const validToolNames = new Set(request.tools.map(t => t.name));
          const extractedCalls: any[] = [];

          // Strategy 1: Entire content is a single JSON object
          const trimmed = content.trim();
          if (trimmed.startsWith('{') && trimmed.includes('"name"')) {
            try {
              let parsed: any = null;
              try { parsed = JSON.parse(trimmed); } catch {
                try { parsed = JSON.parse(trimmed.replace(/'/g, '"')); } catch { /* skip */ }
              }
              if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
                let toolName = parsed.name;
                if (!validToolNames.has(toolName)) {
                      const aliases: Record<string, string> = { 'modify': 'write_file', 'edit': 'write_file', 'update': 'write_file', 'read': 'read_file', 'write': 'write_file', 'create': 'create_file', 'delete': 'delete_file', 'remove': 'delete_file', 'list': 'list_directory', 'search': 'search_files', 'find': 'search_files', 'patch': 'apply_patch' };
                  toolName = aliases[toolName] || toolName;
                }
                if (validToolNames.has(toolName)) {
                  extractedCalls.push({
                    id: `call_0_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    name: toolName,
                    arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
                  });
                }
              }
            } catch { /* not valid JSON */ }
          }

          // Strategy 2: Brace-depth scanner (always runs to catch multiple JSON objects)
          {
            let callIndex = 0;
            let i = 0;
            while (i < content.length) {
              // Find next potential JSON start
              const jsonStart = content.indexOf('{"name"', i);
              if (jsonStart === -1) break;

              // Scan forward with brace depth tracking
              let depth = 0;
              let inString = false;
              let escape = false;
              let end = -1;

              for (let j = jsonStart; j < content.length; j++) {
                const ch = content[j];
                if (escape) { escape = false; continue; }
                if (ch === '\\') { escape = true; continue; }
                if (ch === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (ch === '{') depth++;
                if (ch === '}') {
                  depth--;
                  if (depth === 0) { end = j; break; }
                }
              }

              if (end > jsonStart) {
                const jsonStr = content.substring(jsonStart, end + 1);
                try {
                  let parsed: any = null;
                  try { parsed = JSON.parse(jsonStr); } catch {
                    try { parsed = JSON.parse(jsonStr.replace(/'/g, '"')); } catch { /* skip */ }
                  }
                  if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
                    let toolName = parsed.name;
                    if (!validToolNames.has(toolName)) {
                      const aliases: Record<string, string> = { 'modify': 'write_file', 'edit': 'write_file', 'update': 'write_file', 'read': 'read_file', 'write': 'write_file', 'create': 'create_file', 'delete': 'delete_file', 'remove': 'delete_file', 'list': 'list_directory', 'search': 'search_files', 'find': 'search_files', 'patch': 'apply_patch' };
                      toolName = aliases[toolName] || toolName;
                    }
                    if (validToolNames.has(toolName)) {
                      extractedCalls.push({
                        id: `call_${callIndex}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                        name: toolName,
                        arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
                      });
                      callIndex++;
                    }
                  }
                } catch { /* skip invalid JSON */ }
                i = end + 1;
              } else {
                i = jsonStart + 1;
              }
            }
          }

          // Strategy 3: Line-by-line JSON block detection (multi-line JSON)
          if (extractedCalls.length === 0) {
            const lines = content.split('\n');
            let jsonBuffer = '';
            let braceDepth = 0;
            let callIndex = 0;
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (braceDepth === 0 && trimmedLine.startsWith('{')) {
                jsonBuffer = trimmedLine;
                braceDepth = (trimmedLine.match(/\{/g) || []).length - (trimmedLine.match(/\}/g) || []).length;
              } else if (braceDepth > 0) {
                jsonBuffer += '\n' + trimmedLine;
                braceDepth += (trimmedLine.match(/\{/g) || []).length - (trimmedLine.match(/\}/g) || []).length;
              }
              if (braceDepth <= 0 && jsonBuffer) {
                try {
                  let parsed: any = null;
                  try { parsed = JSON.parse(jsonBuffer); } catch {
                    try { parsed = JSON.parse(jsonBuffer.replace(/'/g, '"')); } catch { /* skip */ }
                  }
                  if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
                    let toolName = parsed.name;
                    if (!validToolNames.has(toolName)) {
                      const aliases: Record<string, string> = { 'modify': 'write_file', 'edit': 'write_file', 'update': 'write_file', 'read': 'read_file', 'write': 'write_file', 'create': 'create_file', 'delete': 'delete_file', 'remove': 'delete_file', 'list': 'list_directory', 'search': 'search_files', 'find': 'search_files', 'patch': 'apply_patch' };
                      toolName = aliases[toolName] || toolName;
                    }
                    if (validToolNames.has(toolName)) {
                      extractedCalls.push({
                        id: `call_${callIndex}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                        name: toolName,
                        arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
                      });
                      callIndex++;
                    }
                  }
                } catch { /* skip */ }
                jsonBuffer = '';
                braceDepth = 0;
              }
            }
          }

          if (extractedCalls.length > 0) {
            toolCalls = extractedCalls;
            ExecutionLogger.log('PROVIDER', 'ollama', request.model,
              `Fallback extracted ${extractedCalls.length} tool calls from content`, {
                tools: extractedCalls.map(tc => tc.name),
              });
          }
        } catch {
          // Not valid JSON - keep as regular content
        }
      }

      ExecutionLogger.log('PROVIDER', 'ollama', request.model,
        `Response: ${toolCalls?.length ?? 0} tool calls`, {
          contentLength: data.message.content?.length ?? 0,
          structuredToolCalls: data.message.tool_calls?.length ?? 0,
          fallbackParsing: !!(toolCalls && toolCalls.length > 0 && !(data.message.tool_calls?.length > 0)),
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          responsePreview: data.message.content?.substring(0, 200),
        });

      return {
        content: data.message.content || '',
        toolCalls,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        metadata: {
          model: data.model || request.model,
          done: String(data.done ?? true),
        }
      };
    } finally {
      emitProviderMeta();
    }
  }

  private translateMessages(messages: ReadonlyArray<Readonly<Message>>): any[] {
    return messages.map(msg => {
      let content: string = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content.map(part => part.type === 'text' ? part.text : '').join('');
      }

      const translated: any = {
        role: msg.role,
        content
      };

      if (msg.tool_calls) {
        translated.tool_calls = msg.tool_calls.map(tc => ({
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
          }
        }));
      }

      if (msg.role === 'tool' && msg.tool_call_id) {
        translated.tool_call_id = msg.tool_call_id;
      }

      return translated;
    });
  }
}
