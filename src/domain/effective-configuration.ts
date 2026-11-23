export const CURRENT_SCHEMA_VERSION = 1;

export interface ContextLimits {
  readonly rules: number;
  readonly knowledge: number;
  readonly memory: number;
  readonly files: number;
}

export interface ProtectionConfig {
  readonly cpuThreshold: number;
  readonly memoryThreshold: number;
  readonly temperatureThreshold: number;
  readonly pauseDurationMs: number;
  readonly healthCheckIntervalMs: number;
  readonly autoResume: boolean;
}

export interface EffectiveConfiguration {
  readonly schemaVersion: number;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly ollamaBaseUrl: string;
  /**
   * Active LLM backend settings (ollama | openai-compatible).
   * When omitted historically, synthesized from ollamaBaseUrl.
   */
  readonly provider: import('./llm-provider-config').LlmProviderSettings;
  readonly contextLimits: ContextLimits;
  readonly contextGathering?: import('./context-gathering-limits').ContextGatheringLimits;
  readonly protection: ProtectionConfig;
  readonly planning: import('./planning-context').PlanningConfig;
  readonly observability: import('./execution-telemetry').ObservabilityConfig;
  readonly selfHealing: import('./self-healing-config').SelfHealingConfig;
  readonly experimentalFeatures: import('./experimental-features').ExperimentalFeatures;
  readonly paths: {
    readonly manifestDir: string;
    readonly rulesDir: string;
    readonly knowledgeDir: string;
    readonly memoryDir: string;
  };
  readonly qualityProfile?: import('./quality-profile').QualityProfile;
}
