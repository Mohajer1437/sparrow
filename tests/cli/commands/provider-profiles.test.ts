import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  printProviderList,
  printProviderCurrent,
  addProviderProfile,
  createProviderProfileStore,
} from '../../../src/cli/commands/provider-profiles';
import { providerCommand } from '../../../src/cli/commands/provider';
import { OpenAICompatibleProvider } from '../../../src/core/provider/openai-compatible-provider';
import { OllamaProvider } from '../../../src/core/provider/ollama-provider';
import { loadEffectiveConfiguration } from '../../../src/core/configuration/default-configuration-loader';

describe('provider profile CLI output', () => {
  it('list marks active provider without printing secrets', () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    printProviderList('omni', [
      {
        name: 'omni',
        profile: {
          type: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:20128/v1',
          model: 'auto',
        },
        hasApiKey: true,
      },
      {
        name: 'ollama-local',
        profile: { type: 'ollama', baseUrl: 'http://localhost:11434' },
        hasApiKey: false,
      },
    ]);

    const joined = logs.join('\n');
    expect(joined).toContain('✓ omni');
    expect(joined).toContain('type: openai-compatible');
    expect(joined).toContain('apiKey: (configured)');
    expect(joined).not.toMatch(/sk-[A-Za-z0-9]{10,}/);

    spy.mockRestore();
  });

  it('current shows configured without key material', () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    printProviderCurrent(
      'omni',
      { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' },
      true,
    );

    expect(logs.join('\n')).toContain('apiKey:  (configured)');
    expect(logs.join('\n')).not.toContain('Bearer');

    spy.mockRestore();
  });
});

describe('provider use missing profile (scenario D)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-cli-provider-'));
    process.env.AGENT_WORKSPACE_ROOT = tmpRoot;
    fs.mkdirSync(path.join(tmpRoot, '.ai'), { recursive: true });
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exits with clear error for unknown profile', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as any);

    await expect(providerCommand(['use', 'no-such-profile'])).rejects.toThrow('exit');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('not found'))).toBe(true);

    errSpy.mockRestore();
    exit.mockRestore();
  });
});

describe('provider profile persistence (scenario E)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-cli-persist-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('persists active selection across store reloads', async () => {
    const store = createProviderProfileStore(tmpRoot);
    await addProviderProfile(store, {
      name: 'ollama-local',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:3b',
    });
    await store.setActive('ollama-local');

    const store2 = createProviderProfileStore(tmpRoot);
    const profiles = await store2.loadProfiles();
    expect(profiles.activeProvider).toBe('ollama-local');
  });
});

describe('provider health/test with profiles (mocked)', () => {
  let fetchMock: jest.Mock;
  let tmpRoot: string;

  beforeEach(async () => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-cli-health-'));
    process.env.AGENT_WORKSPACE_ROOT = tmpRoot;
    fs.mkdirSync(path.join(tmpRoot, '.ai'), { recursive: true });

    const store = createProviderProfileStore(tmpRoot);
    await addProviderProfile(store, {
      name: 'bad-omni',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:20128/v1',
      model: 'auto',
      apiKey: 'sk-invalid-key-for-test',
    });
    await store.setActive('bad-omni');
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('scenario C: unauthorized surfaces typed failure on smoke test', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid',
    });

    const config = await loadEffectiveConfiguration(tmpRoot);
    expect(config.provider.apiKey).toBe('sk-invalid-key-for-test');

    const provider = new OpenAICompatibleProvider({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey!,
    });
    const { runProviderSmokeTest } = await import('../../../src/core/provider/provider-smoke-test');
    const result = await runProviderSmokeTest(provider, {
      providerType: 'openai-compatible',
      endpoint: config.provider.baseUrl,
      model: 'auto',
    });
    expect(result.success).toBe(false);
    expect(result.failureCategory).toBe('authentication');
  });

  it('scenario A: ollama profile loads for health path', async () => {
    const store = createProviderProfileStore(tmpRoot);
    await addProviderProfile(store, {
      name: 'ollama-local',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:3b',
    });
    await store.setActive('ollama-local');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }),
    });

    const config = await loadEffectiveConfiguration(tmpRoot);
    expect(config.provider.type).toBe('ollama');
    const provider = new OllamaProvider(config.provider.baseUrl);
    const health = await provider.checkHealth({ model: config.defaultModel });
    expect(health.status).toBe('healthy');
  });
});
