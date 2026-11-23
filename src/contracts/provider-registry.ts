import type { LlmProvider } from './llm-provider';
import { ProviderId } from '../domain/provider-id';

/**
 * ProviderRegistry is the single source of truth for resolving
 * LlmProvider instances by their identity.
 * 
 * This registry is intentionally READ-ONLY at runtime.
 * All providers are registered during application bootstrap
 * via the Composition Root (AppFactory) through constructor injection.
 * 
 * No dynamic registration is allowed to preserve immutability
 * and prevent hidden state mutations during task execution.
 */
export interface ProviderRegistry {
  /**
   * Returns the LlmProvider registered under the given id,
   * or undefined if no such provider exists.
   */
  get(id: ProviderId): LlmProvider | undefined;

  /**
   * Returns true if a provider is registered under the given id.
   */
  has(id: ProviderId): boolean;

  /**
   * Returns an immutable list of all registered provider ids.
   */
  list(): ReadonlyArray<ProviderId>;
}
