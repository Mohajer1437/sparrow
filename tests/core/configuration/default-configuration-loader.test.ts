import { DefaultConfigurationLoader } from '../../../src/core/configuration/default-configuration-loader';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('DefaultConfigurationLoader', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let loader: DefaultConfigurationLoader;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    loader = new DefaultConfigurationLoader(mockRuntime);
    // Clear env overrides
    delete process.env.AGENT_OLLAMA_URL;
    delete process.env.AGENT_DEFAULT_PROVIDER;
    delete process.env.AGENT_DEFAULT_MODEL;
    delete process.env.AGENT_PROVIDER_TYPE;
    delete process.env.AGENT_LLM_BASE_URL;
    delete process.env.AGENT_LLM_API_KEY;
  });

  afterEach(() => {
    delete process.env.AGENT_OLLAMA_URL;
    delete process.env.AGENT_DEFAULT_PROVIDER;
    delete process.env.AGENT_DEFAULT_MODEL;
    delete process.env.AGENT_PROVIDER_TYPE;
    delete process.env.AGENT_LLM_BASE_URL;
    delete process.env.AGENT_LLM_API_KEY;
  });

  it('loads defaults without config file', async () => {
    mockRuntime.exists.mockResolvedValue(false);

    const config = await loader.load();

    expect(config.schemaVersion).toBe(1);
    expect(config.defaultProvider).toBe('ollama');
    expect(config.defaultModel).toBe('qwen3-32b');
    expect(config.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(config.provider).toEqual({ type: 'ollama', baseUrl: 'http://localhost:11434' });
    expect(config.contextLimits).toEqual({ rules: 10, knowledge: 10, memory: 10, files: 10 });
    expect(config.paths.manifestDir).toBe('manifest');
  });

  it('workspace config overrides defaults', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
      ollamaBaseUrl: 'http://custom:11434',
      contextLimits: { rules: 20, knowledge: 5 },
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const config = await loader.load();

    expect(config.defaultProvider).toBe('openai');
    expect(config.defaultModel).toBe('gpt-4o');
    expect(config.ollamaBaseUrl).toBe('http://custom:11434');
    expect(config.contextLimits.rules).toBe(20);
    expect(config.contextLimits.knowledge).toBe(5);
    expect(config.contextLimits.memory).toBe(10); // default preserved
  });

  it('environment overrides workspace config', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      defaultModel: 'gpt-4o',
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    process.env.AGENT_DEFAULT_MODEL = 'claude-sonnet-4';
    process.env.AGENT_OLLAMA_URL = 'http://env-override:11434';

    const config = await loader.load();

    expect(config.defaultModel).toBe('claude-sonnet-4');
    expect(config.ollamaBaseUrl).toBe('http://env-override:11434');
  });

  it('invalid JSON fails with clear error', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('{ invalid json !!!');

    await expect(loader.load()).rejects.toThrow('Invalid JSON in .ai/config.json');
  });

  it('missing optional fields use defaults', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const config = await loader.load();

    expect(config.defaultProvider).toBe('ollama');
    expect(config.defaultModel).toBe('qwen3-32b');
    expect(config.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(config.contextLimits).toEqual({ rules: 10, knowledge: 10, memory: 10, files: 10 });
  });

  it('EffectiveConfiguration is immutable', async () => {
    mockRuntime.exists.mockResolvedValue(false);

    const config = await loader.load();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.contextLimits)).toBe(true);
    expect(Object.isFrozen(config.paths)).toBe(true);
  });

  it('handles missing config file gracefully', async () => {
    mockRuntime.exists.mockRejectedValue(new Error('ENOENT'));

    const config = await loader.load();

    expect(config.defaultProvider).toBe('ollama');
    expect(config.schemaVersion).toBe(1);
  });

  // =========================================================================
  // R4.8: Schema Version Validation Tests
  // =========================================================================

  it('loads config with schemaVersion 1 successfully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 1,
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const config = await loader.load();

    expect(config.schemaVersion).toBe(1);
    expect(config.defaultProvider).toBe('ollama');
  });

  it('loads config without schemaVersion (backward compat)', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const config = await loader.load();

    expect(config.schemaVersion).toBe(1);
    expect(config.defaultProvider).toBe('ollama');
  });

  it('rejects older schemaVersion with migration message', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 0,
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    await expect(loader.load()).rejects.toThrow('schema version 0 is outdated');
    await expect(loader.load()).rejects.toThrow('Current: 1');
    await expect(loader.load()).rejects.toThrow('Migration required');
  });

  it('loads openai-compatible provider block from config', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
        model: 'vendor/model',
      },
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    const config = await loader.load();

    expect(config.provider.type).toBe('openai-compatible');
    expect(config.provider.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.provider.apiKey).toBe('sk-test');
    expect(config.defaultProvider).toBe('openai-compatible');
    expect(config.defaultModel).toBe('vendor/model');
  });

  it('rejects openai-compatible provider without apiKey', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
      },
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    await expect(loader.load()).rejects.toThrow('provider.apiKey is required');
  });

  it('rejects newer schemaVersion with upgrade message', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      version: '0.1.0',
      schemaVersion: 99,
      paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' },
    }));

    await expect(loader.load()).rejects.toThrow('newer Sparrow version');
    await expect(loader.load()).rejects.toThrow('Schema: 99');
    await expect(loader.load()).rejects.toThrow('Please upgrade');
  });
});
