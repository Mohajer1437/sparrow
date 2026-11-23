import { AppFactory } from '../../../src/core/app-factory';
import { Logger } from '../../../src/contracts/logger';
import { EffectiveConfiguration } from '../../../src/domain/effective-configuration';
import { KnownProviders } from '../../../src/domain/provider-id';
import { ResilientLlmProvider } from '../../../src/core/provider/resilient-llm-provider';

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function baseConfig(overrides: Partial<EffectiveConfiguration> = {}): EffectiveConfiguration {
  return Object.freeze({
    schemaVersion: 1,
    defaultProvider: 'ollama',
    defaultModel: 'qwen3-32b',
    ollamaBaseUrl: 'http://localhost:11434',
    provider: Object.freeze({ type: 'ollama' as const, baseUrl: 'http://localhost:11434' }),
    contextLimits: Object.freeze({ rules: 10, knowledge: 10, memory: 10, files: 10 }),
    protection: Object.freeze({
      cpuThreshold: 90,
      memoryThreshold: 85,
      temperatureThreshold: 80,
      pauseDurationMs: 30000,
      healthCheckIntervalMs: 5000,
      autoResume: true,
    }),
    planning: Object.freeze({ maxSteps: 10, preferredStepSize: 1, strategy: 'sequential' as const }),
    observability: Object.freeze({ enabled: true, verbosity: 'standard' as const, timelineRetention: 100 }),
    selfHealing: Object.freeze({
      enabled: true,
      maxHealingAttempts: 3,
      tempKnowledgeDir: 'knowledge/temp',
      mergeOnSuccess: true,
    }),
    experimentalFeatures: Object.freeze({
      lsp: Object.freeze({ enabled: false }),
      vectorRag: Object.freeze({ enabled: false }),
      multiAgentDebate: Object.freeze({ enabled: false }),
    }),
    paths: Object.freeze({
      manifestDir: 'manifest',
      rulesDir: 'rules',
      knowledgeDir: 'knowledge',
      memoryDir: 'memory',
    }),
    ...overrides,
  }) as EffectiveConfiguration;
}

describe('Provider registry factory (Phase 2 + resilient)', () => {
  it('wraps configured ollama backend in ResilientLlmProvider', () => {
    const factory = new AppFactory(process.cwd(), mockLogger, baseConfig());
    const registry = factory.createProviderRegistry();
    const provider = registry.get(KnownProviders.OLLAMA);
    expect(provider).toBeInstanceOf(ResilientLlmProvider);
    expect(factory.resolveConfiguredProviderId()).toBe(KnownProviders.OLLAMA);
  });

  it('wraps openai-compatible backend in ResilientLlmProvider', () => {
    const factory = new AppFactory(
      process.cwd(),
      mockLogger,
      baseConfig({
        defaultProvider: 'openai-compatible',
        defaultModel: 'openrouter/auto',
        provider: Object.freeze({
          type: 'openai-compatible',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-test',
          model: 'openrouter/auto',
        }),
      }),
    );
    const registry = factory.createProviderRegistry();
    const provider = registry.get(KnownProviders.OPENAI_COMPATIBLE);
    expect(provider).toBeInstanceOf(ResilientLlmProvider);
    expect(registry.get(factory.resolveConfiguredProviderId())).toBe(provider);
  });

  it('exposes the same resilient wrapper under both known provider ids', () => {
    const factory = new AppFactory(process.cwd(), mockLogger, baseConfig());
    const registry = factory.createProviderRegistry();
    expect(registry.get(KnownProviders.OLLAMA)).toBe(
      registry.get(KnownProviders.OPENAI_COMPATIBLE),
    );
  });
});
