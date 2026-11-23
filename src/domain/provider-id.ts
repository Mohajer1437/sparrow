/**
 * ProviderId is a branded string type that provides type safety
 * when identifying providers across the architecture.
 * 
 * Using a branded type prevents accidental mixing of provider IDs
 * with arbitrary strings and makes the intent explicit in APIs.
 */
declare const ProviderIdBrand: unique symbol;

export type ProviderId = string & {
  readonly [ProviderIdBrand]: typeof ProviderIdBrand;
};

/**
 * Creates a strongly-typed ProviderId from a raw string.
 * This is the only approved way to construct a ProviderId.
 */
export function createProviderId(value: string): ProviderId {
  if (!value || value.trim().length === 0) {
    throw new Error('ProviderId cannot be empty');
  }
  return value as ProviderId;
}

/**
 * Well-known provider identifiers used across the platform.
 * These are constants to avoid string typos in configuration and code.
 */
export const KnownProviders = {
  OLLAMA: createProviderId('ollama'),
  OPENAI_COMPATIBLE: createProviderId('openai-compatible'),
  OPENAI: createProviderId('openai'),
  ANTHROPIC: createProviderId('anthropic'),
  GEMINI: createProviderId('gemini'),
  AZURE_OPENAI: createProviderId('azure-openai'),
} as const;
