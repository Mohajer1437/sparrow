import { ConfigurationLoader } from '../../contracts/configuration-loader';
import { EffectiveConfiguration, ContextLimits, ProtectionConfig, CURRENT_SCHEMA_VERSION } from '../../domain/effective-configuration';
import { QualityProfile, parseQualityProfile, DEFAULT_QUALITY_PROFILE } from '../../domain/quality-profile';
import { PlanningConfig } from '../../domain/planning-context';
import { ObservabilityConfig } from '../../domain/execution-telemetry';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { LocalRuntimeRepository } from '../runtime/local-runtime-repository';
import { ContextGatheringLimits, mergeContextGatheringLimits } from '../../domain/context-gathering-limits';
import {
  DEFAULT_OLLAMA_PROVIDER_SETTINGS,
  LlmProviderBackendType,
  LlmProviderSettings,
} from '../../domain/llm-provider-config';
import { ProviderProfileStore } from '../provider/provider-profile-store';

const DEFAULT_CONTEXT_LIMITS: ContextLimits = Object.freeze({
  rules: 10,
  knowledge: 10,
  memory: 10,
  files: 10,
});

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = 'qwen3-32b';

const DEFAULT_OBSERVABILITY: ObservabilityConfig = Object.freeze({
  enabled: true,
  verbosity: 'standard',
  timelineRetention: 100,
});

const DEFAULT_PLANNING: PlanningConfig = Object.freeze({
  maxSteps: 10,
  preferredStepSize: 1,
  strategy: 'sequential',
});

const DEFAULT_PROTECTION: ProtectionConfig = Object.freeze({
  cpuThreshold: 90,
  memoryThreshold: 85,
  temperatureThreshold: 80,
  pauseDurationMs: 30000,
  healthCheckIntervalMs: 5000,
  autoResume: true,
});

const DEFAULT_EXPERIMENTAL_FEATURES: import('../../domain/experimental-features').ExperimentalFeatures = Object.freeze({
  lsp: Object.freeze({ enabled: false }),
  vectorRag: Object.freeze({ enabled: false }),
  multiAgentDebate: Object.freeze({ enabled: false }),
});

const DEFAULT_SELF_HEALING: import('../../domain/self-healing-config').SelfHealingConfig = Object.freeze({
  enabled: true,
  maxHealingAttempts: 3,
  tempKnowledgeDir: 'knowledge/temp',
  mergeOnSuccess: true,
});

const DEFAULT_PATHS = Object.freeze({
  manifestDir: 'manifest',
  rulesDir: 'rules',
  knowledgeDir: 'knowledge',
  memoryDir: 'memory',
});

export class DefaultConfigurationLoader implements ConfigurationLoader {
  constructor(private readonly runtime: RuntimeRepository) {}

  async load(): Promise<EffectiveConfiguration> {
    // Step 1: Start with built-in defaults
    let defaultProvider = DEFAULT_PROVIDER;
    let defaultModel = DEFAULT_MODEL;
    let ollamaBaseUrl = DEFAULT_OLLAMA_URL;
    let providerSettings: LlmProviderSettings = { ...DEFAULT_OLLAMA_PROVIDER_SETTINGS };
    let providerBlockPresent = false;
    let defaultProviderExplicit = false;
    let defaultModelExplicit = false;
    let contextLimits: ContextLimits = DEFAULT_CONTEXT_LIMITS;
    let contextGathering: ContextGatheringLimits | undefined;
    let paths = { ...DEFAULT_PATHS };
    let protection: ProtectionConfig = { ...DEFAULT_PROTECTION };
    let planning: PlanningConfig = { ...DEFAULT_PLANNING };
    let observability: ObservabilityConfig = { ...DEFAULT_OBSERVABILITY };
    let selfHealing: import('../../domain/self-healing-config').SelfHealingConfig = { ...DEFAULT_SELF_HEALING };
    let experimentalFeatures: import('../../domain/experimental-features').ExperimentalFeatures = { ...DEFAULT_EXPERIMENTAL_FEATURES };
    let qualityProfile: QualityProfile = DEFAULT_QUALITY_PROFILE;

    // Step 2: Load workspace config (.ai/config.json)
    try {
      const exists = await this.runtime.exists('config.json');
      if (exists) {
        const raw = await this.runtime.readFile('config.json');
        const config = JSON.parse(raw);

        // Schema version validation (R4.8)
        const fileSchemaVersion: number = config.schemaVersion ?? CURRENT_SCHEMA_VERSION;
        
        if (fileSchemaVersion < CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `[Configuration] Config schema version ${fileSchemaVersion} is outdated. ` +
            `Current: ${CURRENT_SCHEMA_VERSION}. Migration required.`
          );
        }
        
        if (fileSchemaVersion > CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `[Configuration] Config created by newer Sparrow version. ` +
            `Schema: ${fileSchemaVersion}. Current: ${CURRENT_SCHEMA_VERSION}. Please upgrade Sparrow.`
          );
        }

        if (typeof config.defaultProvider === 'string' && config.defaultProvider) {
          defaultProvider = config.defaultProvider;
          defaultProviderExplicit = true;
        }
        if (typeof config.defaultModel === 'string' && config.defaultModel) {
          defaultModel = config.defaultModel;
          defaultModelExplicit = true;
        }
        if (typeof config.ollamaBaseUrl === 'string' && config.ollamaBaseUrl) {
          ollamaBaseUrl = config.ollamaBaseUrl;
        }
        if (config.provider && typeof config.provider === 'object') {
          providerBlockPresent = true;
          providerSettings = parseProviderSettings(config.provider, ollamaBaseUrl);
        }
        if (config.qualityProfile) {
          qualityProfile = parseQualityProfile(config.qualityProfile);
        }
        if (config.contextLimits && typeof config.contextLimits === 'object') {
          contextLimits = Object.freeze({
            rules: typeof config.contextLimits.rules === 'number' ? config.contextLimits.rules : DEFAULT_CONTEXT_LIMITS.rules,
            knowledge: typeof config.contextLimits.knowledge === 'number' ? config.contextLimits.knowledge : DEFAULT_CONTEXT_LIMITS.knowledge,
            memory: typeof config.contextLimits.memory === 'number' ? config.contextLimits.memory : DEFAULT_CONTEXT_LIMITS.memory,
            files: typeof config.contextLimits.files === 'number' ? config.contextLimits.files : DEFAULT_CONTEXT_LIMITS.files,
          });
        }
        if (config.contextGathering && typeof config.contextGathering === 'object') {
          contextGathering = mergeContextGatheringLimits({
            maxFiles: typeof config.contextGathering.maxFiles === 'number' ? config.contextGathering.maxFiles : undefined,
            maxBytes: typeof config.contextGathering.maxBytes === 'number' ? config.contextGathering.maxBytes : undefined,
            maxFileBytes: typeof config.contextGathering.maxFileBytes === 'number' ? config.contextGathering.maxFileBytes : undefined,
            maxTotalContextBytes: typeof config.contextGathering.maxTotalContextBytes === 'number'
              ? config.contextGathering.maxTotalContextBytes
              : undefined,
          });
        }
        if (config.observability && typeof config.observability === 'object') {
          observability = Object.freeze({
            enabled: typeof config.observability.enabled === 'boolean' ? config.observability.enabled : DEFAULT_OBSERVABILITY.enabled,
            verbosity: config.observability.verbosity === 'minimal' || config.observability.verbosity === 'detailed' ? config.observability.verbosity : DEFAULT_OBSERVABILITY.verbosity,
            timelineRetention: typeof config.observability.timelineRetention === 'number' ? config.observability.timelineRetention : DEFAULT_OBSERVABILITY.timelineRetention,
          });
        }
        if (config.planning && typeof config.planning === 'object') {
          planning = Object.freeze({
            maxSteps: typeof config.planning.maxSteps === 'number' ? config.planning.maxSteps : DEFAULT_PLANNING.maxSteps,
            preferredStepSize: typeof config.planning.preferredStepSize === 'number' ? config.planning.preferredStepSize : DEFAULT_PLANNING.preferredStepSize,
            strategy: config.planning.strategy === 'parallel' ? 'parallel' : DEFAULT_PLANNING.strategy,
          });
        }
        if (config.protection && typeof config.protection === 'object') {
          protection = Object.freeze({
            cpuThreshold: typeof config.protection.cpuThreshold === 'number' ? config.protection.cpuThreshold : DEFAULT_PROTECTION.cpuThreshold,
            memoryThreshold: typeof config.protection.memoryThreshold === 'number' ? config.protection.memoryThreshold : DEFAULT_PROTECTION.memoryThreshold,
            temperatureThreshold: typeof config.protection.temperatureThreshold === 'number' ? config.protection.temperatureThreshold : DEFAULT_PROTECTION.temperatureThreshold,
            pauseDurationMs: typeof config.protection.pauseDurationMs === 'number' ? config.protection.pauseDurationMs : DEFAULT_PROTECTION.pauseDurationMs,
            healthCheckIntervalMs: typeof config.protection.healthCheckIntervalMs === 'number' ? config.protection.healthCheckIntervalMs : DEFAULT_PROTECTION.healthCheckIntervalMs,
            autoResume: typeof config.protection.autoResume === 'boolean' ? config.protection.autoResume : DEFAULT_PROTECTION.autoResume,
          });
        }
        if (config.paths && typeof config.paths === 'object') {
          paths = {
            manifestDir: config.paths.manifestDir ?? paths.manifestDir,
            rulesDir: config.paths.rulesDir ?? paths.rulesDir,
            knowledgeDir: config.paths.knowledgeDir ?? paths.knowledgeDir,
            memoryDir: config.paths.memoryDir ?? paths.memoryDir,
          };
        }
        if (config.selfHealing && typeof config.selfHealing === 'object') {
          selfHealing = Object.freeze({
            enabled: typeof config.selfHealing.enabled === 'boolean' ? config.selfHealing.enabled : DEFAULT_SELF_HEALING.enabled,
            maxHealingAttempts: typeof config.selfHealing.maxHealingAttempts === 'number' ? config.selfHealing.maxHealingAttempts : DEFAULT_SELF_HEALING.maxHealingAttempts,
            escalationModelId: typeof config.selfHealing.escalationModelId === 'string' ? config.selfHealing.escalationModelId : DEFAULT_SELF_HEALING.escalationModelId,
            escalationProviderId: typeof config.selfHealing.escalationProviderId === 'string' ? config.selfHealing.escalationProviderId : DEFAULT_SELF_HEALING.escalationProviderId,
            tempKnowledgeDir: typeof config.selfHealing.tempKnowledgeDir === 'string' ? config.selfHealing.tempKnowledgeDir : DEFAULT_SELF_HEALING.tempKnowledgeDir,
            mergeOnSuccess: typeof config.selfHealing.mergeOnSuccess === 'boolean' ? config.selfHealing.mergeOnSuccess : DEFAULT_SELF_HEALING.mergeOnSuccess,
          });
        }
        if (config.experimentalFeatures && typeof config.experimentalFeatures === 'object') {
          const ef = config.experimentalFeatures;
          experimentalFeatures = Object.freeze({
            lsp: Object.freeze({
              enabled: typeof ef.lsp?.enabled === 'boolean' ? ef.lsp.enabled : false,
              tsconfigPath: typeof ef.lsp?.tsconfigPath === 'string' ? ef.lsp.tsconfigPath : undefined,
              serverPath: typeof ef.lsp?.serverPath === 'string' ? ef.lsp.serverPath : undefined,
              maxReferences: typeof ef.lsp?.maxReferences === 'number' ? ef.lsp.maxReferences : undefined,
            }),
            vectorRag: Object.freeze({
              enabled: typeof ef.vectorRag?.enabled === 'boolean' ? ef.vectorRag.enabled : false,
              embeddingModel: typeof ef.vectorRag?.embeddingModel === 'string' ? ef.vectorRag.embeddingModel : undefined,
              similarityThreshold: typeof ef.vectorRag?.similarityThreshold === 'number' ? ef.vectorRag.similarityThreshold : undefined,
              maxResults: typeof ef.vectorRag?.maxResults === 'number' ? ef.vectorRag.maxResults : undefined,
            }),
            multiAgentDebate: Object.freeze({
              enabled: typeof ef.multiAgentDebate?.enabled === 'boolean' ? ef.multiAgentDebate.enabled : false,
              minComplexity: ef.multiAgentDebate?.minComplexity === 'simple' || ef.multiAgentDebate?.minComplexity === 'medium' || ef.multiAgentDebate?.minComplexity === 'complex' ? ef.multiAgentDebate.minComplexity : undefined,
              maxRounds: typeof ef.multiAgentDebate?.maxRounds === 'number' ? ef.multiAgentDebate.maxRounds : undefined,
              consensusThreshold: typeof ef.multiAgentDebate?.consensusThreshold === 'number' ? ef.multiAgentDebate.consensusThreshold : undefined,
            }),
          });
        }
      }
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        throw new Error(`[Configuration] Invalid JSON in .ai/config.json: ${err.message}`);
      }
      // Re-throw configuration validation errors (R4.8)
      if (err.message && typeof err.message === 'string' && err.message.startsWith('[Configuration]')) {
        throw err;
      }
      // File not found or read error: use defaults silently
    }

    // Step 3: Apply environment overrides
    if (process.env.AGENT_OLLAMA_URL) {
      ollamaBaseUrl = process.env.AGENT_OLLAMA_URL;
    }
    if (process.env.AGENT_DEFAULT_PROVIDER) {
      defaultProvider = process.env.AGENT_DEFAULT_PROVIDER;
      defaultProviderExplicit = true;
    }
    if (process.env.AGENT_DEFAULT_MODEL) {
      defaultModel = process.env.AGENT_DEFAULT_MODEL;
      defaultModelExplicit = true;
    }
    if (process.env.AGENT_QUALITY_PROFILE) {
      qualityProfile = parseQualityProfile(process.env.AGENT_QUALITY_PROFILE);
    }
    if (process.env.AGENT_PROVIDER_TYPE || process.env.AGENT_LLM_BASE_URL || process.env.AGENT_LLM_API_KEY) {
      const envType = (process.env.AGENT_PROVIDER_TYPE || providerSettings.type) as string;
      providerBlockPresent = true;
      providerSettings = parseProviderSettings(
        {
          type: envType,
          baseUrl: process.env.AGENT_LLM_BASE_URL || providerSettings.baseUrl,
          apiKey: process.env.AGENT_LLM_API_KEY || providerSettings.apiKey,
          model: process.env.AGENT_DEFAULT_MODEL || providerSettings.model,
        },
        ollamaBaseUrl,
      );
    }

    // Step 3b: Active CLI provider profile wins over env + legacy (Phase 2.9).
    // Priority: profile > environment variables > legacy Ollama / config.json provider block.
    try {
      const profileStore = new ProviderProfileStore(this.runtime);
      const active = await profileStore.getActiveResolved();
      if (active) {
        providerBlockPresent = true;
        providerSettings = Object.freeze({ ...active.settings });
        // Profile wins over env-explicit provider/model selection.
        defaultProvider = active.settings.type;
        defaultProviderExplicit = true;
        if (active.settings.model) {
          defaultModel = active.settings.model;
          defaultModelExplicit = true;
        }
        if (active.settings.type === 'ollama') {
          ollamaBaseUrl = active.settings.baseUrl || ollamaBaseUrl;
        }
      }
    } catch (err: any) {
      // Missing profiles file is fine; dangling active provider is a hard error.
      if (err?.message && String(err.message).startsWith('[ProviderProfiles]')) {
        throw err;
      }
    }

    // When no provider block: synthesize ollama settings from ollamaBaseUrl (legacy).
    if (!providerBlockPresent) {
      providerSettings = Object.freeze({
        type: 'ollama' as const,
        baseUrl: ollamaBaseUrl,
      });
    } else if (providerSettings.type === 'ollama' && !providerSettings.baseUrl) {
      providerSettings = Object.freeze({
        ...providerSettings,
        baseUrl: ollamaBaseUrl,
      });
    }

    // Align defaultProvider/defaultModel with provider block when not explicit.
    if (providerBlockPresent && !defaultProviderExplicit) {
      defaultProvider = providerSettings.type;
    }
    if (providerBlockPresent && providerSettings.model && !defaultModelExplicit) {
      defaultModel = providerSettings.model;
    }

    // Keep legacy ollamaBaseUrl in sync when provider is ollama.
    if (providerSettings.type === 'ollama') {
      ollamaBaseUrl = providerSettings.baseUrl || ollamaBaseUrl;
    }

    // Step 4: Validate required values (fail fast)
    if (!defaultProvider) {
      throw new Error('[Configuration] defaultProvider is required after merge');
    }
    if (!defaultModel) {
      throw new Error('[Configuration] defaultModel is required after merge');
    }
    if (!ollamaBaseUrl) {
      throw new Error('[Configuration] ollamaBaseUrl is required after merge');
    }
    if (!providerSettings.baseUrl) {
      throw new Error('[Configuration] provider.baseUrl is required after merge');
    }
    if (providerSettings.type === 'openai-compatible' && !providerSettings.apiKey) {
      throw new Error('[Configuration] provider.apiKey is required for openai-compatible backends');
    }

    // Step 5: Create and freeze EffectiveConfiguration
    const effective: EffectiveConfiguration = Object.freeze({
      schemaVersion: 1,
      defaultProvider,
      defaultModel,
      ollamaBaseUrl,
      provider: Object.freeze({ ...providerSettings }),
      contextLimits,
      contextGathering,
      protection: Object.freeze(protection),
      planning: Object.freeze(planning),
      observability: Object.freeze(observability),
      selfHealing: Object.freeze(selfHealing),
      experimentalFeatures: Object.freeze(experimentalFeatures),
      paths: Object.freeze(paths),
      qualityProfile,
    });

    return effective;
  }
}

function parseProviderSettings(
  raw: { type?: string; baseUrl?: string; apiKey?: string; model?: string },
  fallbackOllamaUrl: string,
): LlmProviderSettings {
  const typeRaw = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : 'ollama';
  let type: LlmProviderBackendType;
  if (typeRaw === 'ollama') {
    type = 'ollama';
  } else if (typeRaw === 'openai-compatible' || typeRaw === 'openai_compatible' || typeRaw === 'openai') {
    type = 'openai-compatible';
  } else {
    throw new Error(
      `[Configuration] Unsupported provider.type "${raw.type}". Expected "ollama" or "openai-compatible".`,
    );
  }

  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : type === 'ollama'
        ? fallbackOllamaUrl
        : '';

  return Object.freeze({
    type,
    baseUrl,
    apiKey: typeof raw.apiKey === 'string' && raw.apiKey ? raw.apiKey : undefined,
    model: typeof raw.model === 'string' && raw.model ? raw.model : undefined,
  });
}

/**
 * Convenience function for CLI usage.
 * Creates a RuntimeRepository and loads the effective configuration.
 */
export async function loadEffectiveConfiguration(workspaceRoot: string): Promise<EffectiveConfiguration> {
  const runtime = new LocalRuntimeRepository(workspaceRoot);
  const loader = new DefaultConfigurationLoader(runtime);
  return loader.load();
}
