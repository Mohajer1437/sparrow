import {
  ProviderHealthOptions,
  ProviderHealthResult,
} from '../domain/provider-health';

/**
 * Optional capability for LlmProvider implementations that can probe
 * reachability/auth without issuing a chat completion.
 */
export interface ProviderHealthCheckable {
  checkHealth(options?: ProviderHealthOptions): Promise<ProviderHealthResult>;
}

export function isProviderHealthCheckable(
  provider: unknown,
): provider is ProviderHealthCheckable {
  return (
    !!provider
    && typeof (provider as ProviderHealthCheckable).checkHealth === 'function'
  );
}
