/**
 * Local provider profile catalog (non-secret metadata).
 * Secrets live separately in .ai/providers/secrets.json.
 */

import { LlmProviderBackendType } from './llm-provider-config';

export interface ProviderProfile {
  readonly type: LlmProviderBackendType;
  readonly baseUrl: string;
  readonly model?: string;
}

export interface ProviderProfilesFile {
  readonly activeProvider: string | null;
  readonly providers: Readonly<Record<string, ProviderProfile>>;
}

export interface ProviderSecretsFile {
  readonly [profileName: string]: {
    readonly apiKey?: string;
  };
}

export const PROVIDER_PROFILES_PATH = 'providers/providers.json';
export const PROVIDER_SECRETS_PATH = 'providers/secrets.json';

export const EMPTY_PROVIDER_PROFILES: ProviderProfilesFile = Object.freeze({
  activeProvider: null,
  providers: Object.freeze({}),
});

/** Mask an API key for display — never echo the full secret. */
export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey) return '(none)';
  if (apiKey.length <= 8) return '********';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

export function assertValidProfileName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Provider profile name is required');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    throw new Error(
      `Invalid provider profile name "${name}". Use letters, digits, ".", "_", or "-" (max 64).`,
    );
  }
}
