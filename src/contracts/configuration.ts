export interface PlatformConfig {
  readonly version: string;
  readonly schemaVersion?: number;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly maxContextTokens?: number;
  readonly ollamaBaseUrl?: string;
  /**
   * Optional LLM backend selection. When omitted, Sparrow uses ollama + ollamaBaseUrl.
   *
   * Examples:
   *   { "type": "ollama", "baseUrl": "http://localhost:11434" }
   *   { "type": "openai-compatible", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "...", "model": "..." }
   */
  readonly provider?: {
    readonly type?: string;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly model?: string;
  };
  readonly contextLimits?: {
    readonly rules?: number;
    readonly knowledge?: number;
    readonly memory?: number;
    readonly files?: number;
  };
  readonly contextGathering?: {
    readonly maxFiles?: number;
    readonly maxBytes?: number;
    readonly maxFileBytes?: number;
    readonly maxTotalContextBytes?: number;
  };
  readonly protection?: {
    readonly cpuThreshold?: number;
    readonly memoryThreshold?: number;
    readonly temperatureThreshold?: number;
    readonly pauseDurationMs?: number;
    readonly healthCheckIntervalMs?: number;
    readonly autoResume?: boolean;
  };
  readonly planning?: {
    readonly maxSteps?: number;
    readonly preferredStepSize?: number;
    readonly strategy?: 'sequential' | 'parallel';
  };
  readonly observability?: {
    readonly enabled?: boolean;
    readonly verbosity?: 'minimal' | 'standard' | 'detailed';
    readonly timelineRetention?: number;
  };
  readonly selfHealing?: {
    readonly enabled?: boolean;
    readonly maxHealingAttempts?: number;
    readonly escalationModelId?: string;
    readonly escalationProviderId?: string;
    readonly tempKnowledgeDir?: string;
    readonly mergeOnSuccess?: boolean;
  };
  readonly experimentalFeatures?: {
    readonly lsp?: {
      readonly enabled?: boolean;
      readonly tsconfigPath?: string;
      readonly serverPath?: string;
      readonly maxReferences?: number;
    };
    readonly vectorRag?: {
      readonly enabled?: boolean;
      readonly embeddingModel?: string;
      readonly similarityThreshold?: number;
      readonly maxResults?: number;
    };
    readonly multiAgentDebate?: {
      readonly enabled?: boolean;
      readonly minComplexity?: 'simple' | 'medium' | 'complex';
      readonly maxRounds?: number;
      readonly consensusThreshold?: number;
    };
  };
  readonly paths: {
    readonly manifestDir: string;
    readonly rulesDir: string;
    readonly knowledgeDir: string;
    readonly memoryDir: string;
  };
}

export interface Configuration {
  load(): Promise<PlatformConfig>;
  get<K extends keyof PlatformConfig>(key: K): PlatformConfig[K] | undefined;
  set<K extends keyof PlatformConfig>(key: K, value: PlatformConfig[K]): Promise<void>;
}
