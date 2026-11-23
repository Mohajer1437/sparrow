/**
 * LLM backend selection in EffectiveConfiguration / PlatformConfig.
 * Vendor HTTP stays behind LlmProvider implementations.
 */

export type LlmProviderBackendType = 'ollama' | 'openai-compatible';

export interface LlmProviderSettings {
  /** Backend kind — drives which LlmProvider implementation AppFactory constructs. */
  readonly type: LlmProviderBackendType;
  /** API root (e.g. http://localhost:11434 or https://openrouter.ai/api/v1). */
  readonly baseUrl: string;
  /** Bearer token for openai-compatible backends. Unused for ollama. */
  readonly apiKey?: string;
  /**
   * Optional default model id for this backend.
   * Does not replace role assignments; used when EffectiveConfiguration.defaultModel
   * should follow the provider block.
   */
  readonly model?: string;
}

export const DEFAULT_OLLAMA_PROVIDER_SETTINGS: LlmProviderSettings = Object.freeze({
  type: 'ollama',
  baseUrl: 'http://localhost:11434',
});
