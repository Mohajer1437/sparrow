/**
 * Composition-root helper: construct a concrete LlmProvider from settings.
 * Vendor HTTP clients stay here — Planner/Executor must not import this for
 * vendor types; they only receive Provider instances via the registry.
 */

import type { LlmProvider } from '../../contracts/llm-provider';
import { LlmProviderSettings } from '../../domain/llm-provider-config';
import { OllamaProvider } from './ollama-provider';
import { OpenAICompatibleProvider } from './openai-compatible-provider';

export function createLlmProviderFromSettings(settings: LlmProviderSettings): LlmProvider {
  if (settings.type === 'openai-compatible') {
    if (!settings.apiKey?.trim()) {
      throw new Error(
        'openai-compatible provider requires an API key (profile secret or AGENT_LLM_API_KEY)',
      );
    }
    return new OpenAICompatibleProvider({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    });
  }

  const baseUrl = settings.baseUrl || 'http://localhost:11434';
  return new OllamaProvider(baseUrl);
}
