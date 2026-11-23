import { ModelDescriptor } from '../domain/model-registry';

/**
 * Discovers available models from an LLM backend.
 * Vendor-specific HTTP (e.g. Ollama /api/tags) stays behind implementations.
 */
export interface ModelDiscovery {
  discover(): Promise<ReadonlyArray<ModelDescriptor>>;
}
