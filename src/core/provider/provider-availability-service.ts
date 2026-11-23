/**
 * Discovers configured provider profiles and probes health for each.
 * Availability requires health status === 'healthy' — API key presence alone
 * never makes a provider available.
 */

import { isProviderHealthCheckable } from '../../contracts/provider-health';
import type { LlmProvider } from '../../contracts/llm-provider';
import { LlmProviderBackendType } from '../../domain/llm-provider-config';
import {
  ProviderHealthResult,
} from '../../domain/provider-health';
import { ProviderProfileStore } from './provider-profile-store';
import { createLlmProviderFromSettings } from './create-llm-provider-from-settings';

export interface ProviderAvailabilityEntry {
  readonly name: string;
  readonly type: LlmProviderBackendType;
  readonly baseUrl: string;
  readonly model?: string;
  readonly hasApiKey: boolean;
  readonly healthy: boolean;
  readonly health: ProviderHealthResult;
  /** Concrete provider instance when construction succeeded; undefined if not built. */
  readonly provider?: LlmProvider;
}

export interface ProviderAvailabilityReport {
  readonly entries: ReadonlyArray<ProviderAvailabilityEntry>;
  readonly healthy: ReadonlyArray<ProviderAvailabilityEntry>;
}

export class ProviderAvailabilityService {
  constructor(private readonly store: ProviderProfileStore) {}

  async discover(): Promise<ProviderAvailabilityReport> {
    const { activeProvider: _active, profiles } = await this.store.list();
    const entries: ProviderAvailabilityEntry[] = [];

    for (const { name, profile, hasApiKey } of profiles) {
      const checkedAt = new Date().toISOString();

      // openai-compatible without a key cannot be healthy
      if (profile.type === 'openai-compatible' && !hasApiKey) {
        entries.push({
          name,
          type: profile.type,
          baseUrl: profile.baseUrl,
          model: profile.model,
          hasApiKey: false,
          healthy: false,
          health: {
            providerType: profile.type,
            endpoint: profile.baseUrl,
            configuredModel: profile.model,
            authentication: 'failed',
            latencyMs: 0,
            status: 'unauthorized',
            message: 'API key missing — provider is not available',
            checkedAt,
          },
        });
        continue;
      }

      let provider: LlmProvider | undefined;
      try {
        provider = createLlmProviderFromSettings({
          type: profile.type,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKey: hasApiKey
            ? (await this.store.loadSecrets())[name]?.apiKey
            : undefined,
        });
      } catch (err: any) {
        entries.push({
          name,
          type: profile.type,
          baseUrl: profile.baseUrl,
          model: profile.model,
          hasApiKey,
          healthy: false,
          health: {
            providerType: profile.type,
            endpoint: profile.baseUrl,
            configuredModel: profile.model,
            authentication: 'not_checked',
            latencyMs: 0,
            status: 'unavailable',
            message: err?.message || String(err),
            checkedAt,
          },
        });
        continue;
      }

      let health: ProviderHealthResult;
      if (isProviderHealthCheckable(provider)) {
        health = await provider.checkHealth();
      } else {
        health = {
          providerType: profile.type,
          endpoint: profile.baseUrl,
          configuredModel: profile.model,
          authentication: 'not_checked',
          latencyMs: 0,
          status: 'unknown',
          message: 'Provider does not implement health checks',
          checkedAt,
        };
      }

      entries.push({
        name,
        type: profile.type,
        baseUrl: profile.baseUrl,
        model: profile.model,
        hasApiKey,
        healthy: health.status === 'healthy',
        health,
        provider,
      });
    }

    const healthy = entries.filter((e) => e.healthy);
    return { entries, healthy };
  }
}
