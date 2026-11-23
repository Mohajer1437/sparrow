import { AppFactory } from '../../src/core/app-factory';

describe('AppFactory lifecycle', () => {
  const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  it('reuses ProviderRegistry instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const reg1 = factory.createProviderRegistry();
    const reg2 = factory.createProviderRegistry();
    expect(reg1).toBe(reg2);
  });

  it('reuses RoleRegistry instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const reg1 = factory.createRoleRegistry();
    const reg2 = factory.createRoleRegistry();
    expect(reg1).toBe(reg2);
  });

  it('reuses WorkspaceMemory instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const mem1 = factory.createWorkspaceMemory();
    const mem2 = factory.createWorkspaceMemory();
    expect(mem1).toBe(mem2);
  });

  it('reuses SessionManager for same workspace', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const sm1 = factory.createSessionManager('/workspace/a');
    const sm2 = factory.createSessionManager('/workspace/a');
    expect(sm1).toBe(sm2);
  });

  it('creates different SessionManager for different workspaces', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const sm1 = factory.createSessionManager('/workspace/a');
    const sm2 = factory.createSessionManager('/workspace/b');
    expect(sm1).not.toBe(sm2);
  });

  it('accepts optional EffectiveConfiguration', () => {
    const effectiveConfig = Object.freeze({
      schemaVersion: 1,
      defaultProvider: 'ollama',
      defaultModel: 'qwen3-32b',
      ollamaBaseUrl: 'http://custom:11434',
      provider: Object.freeze({ type: 'ollama' as const, baseUrl: 'http://custom:11434' }),
      contextLimits: Object.freeze({ rules: 5, knowledge: 5, memory: 5, files: 5 }),
      protection: Object.freeze({ cpuThreshold: 90, memoryThreshold: 85, temperatureThreshold: 80, pauseDurationMs: 30000, healthCheckIntervalMs: 5000, autoResume: true }),
      planning: Object.freeze({ maxSteps: 10, preferredStepSize: 1, strategy: 'sequential' }),
      observability: Object.freeze({ enabled: true, verbosity: 'standard', timelineRetention: 100 }),
      selfHealing: Object.freeze({ enabled: true, maxHealingAttempts: 3, tempKnowledgeDir: 'knowledge/temp', mergeOnSuccess: true }),
      experimentalFeatures: Object.freeze({ lsp: Object.freeze({ enabled: false }), vectorRag: Object.freeze({ enabled: false }), multiAgentDebate: Object.freeze({ enabled: false }) }),
      paths: Object.freeze({ manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' }),
    });

    const factory = new AppFactory('/fake/path', mockLogger, effectiveConfig);
    const registry = factory.createProviderRegistry();
    expect(registry).toBeDefined();
  });

  it('reuses SkillRegistry instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const reg1 = factory.createSkillRegistry();
    const reg2 = factory.createSkillRegistry();
    expect(reg1).toBe(reg2);
    expect(reg1.get('frontend.core')).toBeDefined();
  });

  it('reuses ContextCache instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const cache1 = factory.createContextCache();
    const cache2 = factory.createContextCache();
    expect(cache1).toBe(cache2);
  });

  it('creates a skill resolver that does not touch the execution pipeline', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const resolver = factory.createSkillResolver();
    const result = resolver.resolve({
      directive: { explicitSkillIds: ['testing.core'] },
      projectProfile: {
        workspaceRoot: '/fake/path',
        projectType: 'unknown',
        detectedFrameworks: [],
        languages: [],
        packageManager: 'unknown',
        availableTestingTools: [],
        detectedDomains: [],
        capabilities: [],
      },
    });
    expect(result.skills.map(s => s.id)).toEqual(['testing.core']);
  });

  it('reuses PlannerContextPreparationService instance', () => {
    const factory = new AppFactory('/fake/path', mockLogger);
    const a = factory.createPlannerContextPreparationService();
    const b = factory.createPlannerContextPreparationService();
    expect(a).toBe(b);
  });
});
