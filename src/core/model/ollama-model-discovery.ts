import { ModelDescriptor } from '../../domain/model-registry';
import { ModelDiscovery } from '../../contracts/model-discovery';

interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

/**
 * Ollama model discovery via /api/tags.
 * Composition root wires this behind ModelDiscovery — not used by Planner/Executor directly.
 */
export class OllamaModelDiscovery implements ModelDiscovery {
  constructor(private readonly baseUrl: string) {}

  async discover(): Promise<ReadonlyArray<ModelDescriptor>> {
    let models: OllamaModelInfo[];

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/api/tags`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { models?: OllamaModelInfo[] };
      models = data.models ?? [];
    } catch {
      return [];
    }

    return Object.freeze(models.map(m => this.toDescriptor(m)));
  }

  private toDescriptor(m: OllamaModelInfo): ModelDescriptor {
    const family = m.details?.family ?? 'unknown';
    const paramSize = m.details?.parameter_size ?? '';

    return Object.freeze({
      id: m.name,
      providerId: 'ollama',
      displayName: m.name,
      contextWindow: this.estimateContext(family),
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: m.name.includes('vision') || m.name.includes('llava'),
      supportsThinking: family === 'qwen3' || family === 'deepseek-r1',
      isLocal: true,
      availability: 'available' as const,
      tags: Object.freeze(['local', family]),
      metadata: Object.freeze({
        family,
        parameterSize: paramSize,
        quantization: m.details?.quantization_level ?? '',
        source: 'ollama-discovery',
      }),
    });
  }

  private estimateContext(family: string): number {
    if (family === 'qwen3' || family === 'qwen2.5' || family === 'qwen2') return 32768;
    if (family === 'llama') return 131072;
    if (family === 'deepseek-r1') return 32768;
    if (family === 'deepseek-coder') return 16384;
    if (family === 'mistral' || family === 'mixtral') return 32768;
    return 8192;
  }
}