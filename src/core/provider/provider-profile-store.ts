import { RuntimeRepository } from '../../contracts/runtime-repository';
import {
  assertValidProfileName,
  EMPTY_PROVIDER_PROFILES,
  PROVIDER_PROFILES_PATH,
  PROVIDER_SECRETS_PATH,
  ProviderProfile,
  ProviderProfilesFile,
  ProviderSecretsFile,
} from '../../domain/provider-profile';
import { LlmProviderSettings } from '../../domain/llm-provider-config';

/**
 * Persist / load provider profiles and secrets under .ai/providers/.
 * Secrets are never written into providers.json.
 */
export class ProviderProfileStore {
  constructor(private readonly runtime: RuntimeRepository) {}

  async loadProfiles(): Promise<ProviderProfilesFile> {
    try {
      if (!(await this.runtime.exists(PROVIDER_PROFILES_PATH))) {
        return EMPTY_PROVIDER_PROFILES;
      }
      const raw = JSON.parse(await this.runtime.readFile(PROVIDER_PROFILES_PATH));
      return normalizeProfilesFile(raw);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        throw new Error(`[ProviderProfiles] Invalid JSON in ${PROVIDER_PROFILES_PATH}: ${err.message}`);
      }
      throw err;
    }
  }

  async loadSecrets(): Promise<ProviderSecretsFile> {
    try {
      if (!(await this.runtime.exists(PROVIDER_SECRETS_PATH))) {
        return {};
      }
      const raw = JSON.parse(await this.runtime.readFile(PROVIDER_SECRETS_PATH));
      return normalizeSecretsFile(raw);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        throw new Error(`[ProviderProfiles] Invalid JSON in ${PROVIDER_SECRETS_PATH}: ${err.message}`);
      }
      throw err;
    }
  }

  async saveProfiles(file: ProviderProfilesFile): Promise<void> {
    await this.runtime.mkdir('providers');
    const safe: ProviderProfilesFile = {
      activeProvider: file.activeProvider,
      providers: { ...file.providers },
    };
    await this.runtime.writeFile(
      PROVIDER_PROFILES_PATH,
      `${JSON.stringify(safe, null, 2)}\n`,
    );
  }

  async saveSecrets(file: ProviderSecretsFile): Promise<void> {
    await this.runtime.mkdir('providers');
    await this.runtime.writeFile(
      PROVIDER_SECRETS_PATH,
      `${JSON.stringify(file, null, 2)}\n`,
    );
  }

  async list(): Promise<{
    activeProvider: string | null;
    profiles: ReadonlyArray<{ name: string; profile: ProviderProfile; hasApiKey: boolean }>;
  }> {
    const [profilesFile, secrets] = await Promise.all([
      this.loadProfiles(),
      this.loadSecrets(),
    ]);
    const names = Object.keys(profilesFile.providers).sort();
    return {
      activeProvider: profilesFile.activeProvider,
      profiles: names.map((name) => ({
        name,
        profile: profilesFile.providers[name],
        hasApiKey: Boolean(secrets[name]?.apiKey),
      })),
    };
  }

  async getActiveResolved(): Promise<{
    name: string;
    settings: LlmProviderSettings;
  } | null> {
    const profilesFile = await this.loadProfiles();
    const active = profilesFile.activeProvider;
    if (!active) return null;
    const profile = profilesFile.providers[active];
    if (!profile) {
      throw new Error(
        `[ProviderProfiles] Active provider "${active}" is not defined in ${PROVIDER_PROFILES_PATH}`,
      );
    }
    const secrets = await this.loadSecrets();
    const apiKey = secrets[active]?.apiKey;
    if (profile.type === 'openai-compatible' && !apiKey) {
      throw new Error(
        `[ProviderProfiles] Active provider "${active}" requires an API key in ${PROVIDER_SECRETS_PATH}`,
      );
    }
    return {
      name: active,
      settings: Object.freeze({
        type: profile.type,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: apiKey || undefined,
      }),
    };
  }

  async setActive(name: string): Promise<ProviderProfile> {
    assertValidProfileName(name);
    const profilesFile = await this.loadProfiles();
    const profile = profilesFile.providers[name];
    if (!profile) {
      const available = Object.keys(profilesFile.providers);
      throw new Error(
        available.length === 0
          ? `Provider profile "${name}" not found. No profiles configured. Run: agent provider add`
          : `Provider profile "${name}" not found. Available: ${available.join(', ')}`,
      );
    }
    await this.saveProfiles({
      activeProvider: name,
      providers: profilesFile.providers,
    });
    return profile;
  }

  async upsertProfile(
    name: string,
    profile: ProviderProfile,
    apiKey?: string,
  ): Promise<void> {
    assertValidProfileName(name);
    if (!profile.baseUrl?.trim()) {
      throw new Error('Provider baseUrl is required');
    }
    if (profile.type === 'openai-compatible' && !apiKey?.trim()) {
      throw new Error('API key is required for openai-compatible providers');
    }

    const profilesFile = await this.loadProfiles();
    const nextProviders = {
      ...profilesFile.providers,
      [name]: {
        type: profile.type,
        baseUrl: profile.baseUrl.trim().replace(/\/$/, ''),
        ...(profile.model ? { model: profile.model } : {}),
      },
    };
    const activeProvider =
      profilesFile.activeProvider && profilesFile.providers[profilesFile.activeProvider]
        ? profilesFile.activeProvider
        : name;

    await this.saveProfiles({
      activeProvider,
      providers: nextProviders,
    });

    if (apiKey !== undefined) {
      const secrets: Record<string, { apiKey?: string }> = {
        ...(await this.loadSecrets()),
      };
      if (apiKey.trim()) {
        secrets[name] = { apiKey: apiKey.trim() };
      } else {
        delete secrets[name];
      }
      await this.saveSecrets(secrets);
    }
  }
}

function normalizeProfilesFile(raw: any): ProviderProfilesFile {
  const providers: Record<string, ProviderProfile> = {};
  const src = raw?.providers && typeof raw.providers === 'object' ? raw.providers : {};
  for (const [name, value] of Object.entries(src)) {
    const v = value as any;
    if (!v || typeof v !== 'object') continue;
    const type = v.type === 'openai-compatible' ? 'openai-compatible' : 'ollama';
    const baseUrl = typeof v.baseUrl === 'string' ? v.baseUrl : '';
    if (!baseUrl) continue;
    // Strip any accidental secret fields from providers.json
    providers[name] = {
      type,
      baseUrl,
      ...(typeof v.model === 'string' && v.model ? { model: v.model } : {}),
    };
  }
  const active =
    typeof raw?.activeProvider === 'string' && raw.activeProvider
      ? raw.activeProvider
      : null;
  return {
    activeProvider: active && providers[active] ? active : (active && !providers[active] ? active : null),
    providers,
  };
}

function normalizeSecretsFile(raw: any): ProviderSecretsFile {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { apiKey?: string }> = {};
  for (const [name, value] of Object.entries(raw)) {
    const v = value as any;
    if (!v || typeof v !== 'object') continue;
    if (typeof v.apiKey === 'string' && v.apiKey) {
      out[name] = { apiKey: v.apiKey };
    }
  }
  return out;
}
