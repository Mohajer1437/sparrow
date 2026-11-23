import { AppFactory } from '../../src/core/app-factory';
import { Logger } from '../../src/contracts/logger';
import { EffectiveConfiguration } from '../../src/domain/effective-configuration';
import { SelfHealingExecutor } from '../../src/core/execution/self-healing-executor';
import { StepExecutionEngine } from '../../src/core/execution/step-execution-engine';

describe('AppFactory Self-Healing Wiring', () => {
  const mockLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const validConfig: EffectiveConfiguration = Object.freeze({
    schemaVersion: 1,
    defaultProvider: 'ollama',
    defaultModel: 'qwen2.5-coder:7b',
    ollamaBaseUrl: 'http://localhost:11434',
    provider: Object.freeze({ type: 'ollama' as const, baseUrl: 'http://localhost:11434' }),
    contextLimits: Object.freeze({ rules: 15, knowledge: 10, memory: 20, files: 10 }),
    protection: Object.freeze({
      cpuThreshold: 85,
      memoryThreshold: 80,
      temperatureThreshold: 85,
      pauseDurationMs: 30000,
      healthCheckIntervalMs: 5000,
      autoResume: true,
    }),
    planning: Object.freeze({ maxSteps: 10, preferredStepSize: 1, strategy: 'sequential' }),
    observability: Object.freeze({ enabled: true, verbosity: 'standard', timelineRetention: 100 }),
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
  });

  it('creates SelfHealingExecutor instance', () => {
    const factory = new AppFactory(process.cwd(), mockLogger, validConfig);
    const executor = factory.createSelfHealingExecutor();
    expect(executor).toBeInstanceOf(SelfHealingExecutor);
  });

  it('wires SelfHealingExecutor into StepExecutionEngine without throwing', () => {
    const factory = new AppFactory(process.cwd(), mockLogger, validConfig);
    expect(() => factory.createStepExecutionEngine(process.cwd())).not.toThrow();
    const engine = factory.createStepExecutionEngine(process.cwd());
    expect(engine).toBeInstanceOf(StepExecutionEngine);
  });

  it('maintains backward compatibility when effectiveConfig is omitted', () => {
    const factory = new AppFactory(process.cwd(), mockLogger);
    expect(() => factory.createStepExecutionEngine(process.cwd())).not.toThrow();
    const engine = factory.createStepExecutionEngine(process.cwd());
    expect(engine).toBeInstanceOf(StepExecutionEngine);
  });
});
