import { ProviderRegistry } from '../../contracts/provider-registry';
import type { LlmProvider } from '../../contracts/llm-provider';
import { ProviderId } from '../../domain/provider-id';

/**
 * InMemoryProviderRegistry is the default implementation of ProviderRegistry.
 * 
 * It receives its providers exclusively through constructor injection.
 * No runtime mutation is permitted: the registry is immutable after creation.
 */
export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderId, LlmProvider>;

  constructor(providers: ReadonlyMap<ProviderId, LlmProvider>) {
    // Defensive copy to guarantee immutability even if the caller
    // later mutates their own map reference.
    this.providers = new Map(providers);
  }

  get(id: ProviderId): LlmProvider | undefined {
    return this.providers.get(id);
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  list(): ReadonlyArray<ProviderId> {
    return Object.freeze(Array.from(this.providers.keys()));
  }
}
