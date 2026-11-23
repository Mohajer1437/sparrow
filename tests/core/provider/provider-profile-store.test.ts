import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import { ProviderProfileStore } from '../../../src/core/provider/provider-profile-store';
import { DefaultConfigurationLoader } from '../../../src/core/configuration/default-configuration-loader';

describe('ProviderProfileStore', () => {
  let tmpRoot: string;
  let store: ProviderProfileStore;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-provider-profile-'));
    store = new ProviderProfileStore(new LocalRuntimeRepository(tmpRoot));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('stores secrets separately from providers.json', async () => {
    await store.upsertProfile(
      'omni',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' },
      'sk-test-secret-key-value',
    );

    const providersRaw = fs.readFileSync(
      path.join(tmpRoot, '.ai', 'providers', 'providers.json'),
      'utf8',
    );
    const secretsRaw = fs.readFileSync(
      path.join(tmpRoot, '.ai', 'providers', 'secrets.json'),
      'utf8',
    );

    expect(providersRaw).not.toContain('sk-test-secret-key-value');
    expect(providersRaw).not.toContain('apiKey');
    expect(secretsRaw).toContain('sk-test-secret-key-value');
  });

  it('setActive fails with clear error when profile missing', async () => {
    await expect(store.setActive('missing-one')).rejects.toThrow(/not found/);
  });

  it('getActiveResolved merges profile + secret', async () => {
    await store.upsertProfile(
      'ollama-local',
      { type: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5:3b' },
    );
    await store.setActive('ollama-local');
    const resolved = await store.getActiveResolved();
    expect(resolved?.name).toBe('ollama-local');
    expect(resolved?.settings.type).toBe('ollama');
    expect(resolved?.settings.model).toBe('qwen2.5:3b');
  });
});

describe('DefaultConfigurationLoader provider profile priority', () => {
  let tmpRoot: string;
  let runtime: LocalRuntimeRepository;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-config-profile-'));
    runtime = new LocalRuntimeRepository(tmpRoot);
    delete process.env.AGENT_PROVIDER_TYPE;
    delete process.env.AGENT_LLM_BASE_URL;
    delete process.env.AGENT_LLM_API_KEY;
    delete process.env.AGENT_DEFAULT_MODEL;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.AGENT_PROVIDER_TYPE;
    delete process.env.AGENT_LLM_BASE_URL;
    delete process.env.AGENT_LLM_API_KEY;
    delete process.env.AGENT_DEFAULT_MODEL;
  });

  it('active profile overrides environment variables', async () => {
    process.env.AGENT_PROVIDER_TYPE = 'openai-compatible';
    process.env.AGENT_LLM_BASE_URL = 'http://env-should-lose.test/v1';
    process.env.AGENT_LLM_API_KEY = 'sk-env-should-lose';

    const profileStore = new ProviderProfileStore(runtime);
    await profileStore.upsertProfile(
      'ollama-local',
      { type: 'ollama', baseUrl: 'http://localhost:11434', model: 'from-profile' },
    );
    await profileStore.setActive('ollama-local');

    const loader = new DefaultConfigurationLoader(runtime);
    const config = await loader.load();

    expect(config.provider.type).toBe('ollama');
    expect(config.provider.baseUrl).toBe('http://localhost:11434');
    expect(config.defaultModel).toBe('from-profile');
    expect(config.provider.apiKey).toBeUndefined();
  });

  it('throws when active profile name is dangling', async () => {
    await runtime.mkdir('providers');
    await runtime.writeFile(
      'providers/providers.json',
      JSON.stringify({ activeProvider: 'ghost', providers: {} }, null, 2),
    );

    const loader = new DefaultConfigurationLoader(runtime);
    await expect(loader.load()).rejects.toThrow(/Active provider "ghost"/);
  });
});
