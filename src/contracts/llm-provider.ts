/**
 * Phase 1 LLM provider abstraction.
 *
 * Application, planning, and execution code must depend on this contract
 * (via ProviderRegistry) — never on a vendor-specific HTTP client.
 *
 * Streaming: not used by Sparrow today (Ollama calls use stream:false).
 * The generate() surface remains the sole chat capability.
 *
 * Provider (in ./provider) is the historical name; LlmProvider is the
 * canonical alias for the multi-provider roadmap.
 */

export type {
  ModelRequest,
  ModelResponse,
  ToolDefinition,
  ProviderCallStage,
  ProviderCallObservability,
  Provider as LlmProvider,
} from './provider';
