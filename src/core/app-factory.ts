import { LocalRuntimeRepository } from './runtime/local-runtime-repository';
import { ExecutionLogger } from './observability/execution-logger';
import { JsonConfiguration } from './configuration/json-configuration';
import { LocalWorkspace } from './workspace/local-workspace';
import { ManifestLoader } from './discovery/manifest-loader';
import { RuleLoader } from './discovery/rule-loader';
import { KnowledgeLoader } from './discovery/knowledge-loader';
import { MemoryLoader } from './discovery/memory-loader';
import { ProjectDiscoveryService } from './discovery/project-discovery-service';
import { DefaultProjectStructureService } from './discovery/default-project-structure-service';
import { ContextSelector } from './context/context-selector';
import { NullSemanticReferenceProvider } from './context/null-semantic-reference-provider';
import type { SemanticReferenceProvider } from '../contracts/semantic-reference-provider';
import { ContextLimiter } from './context/context-limiter';
import { ContextBuilder } from './context/context-builder';
import { ContextFreezer } from './context/context-freezer';
import { DefaultContextEngine } from './context/default-context-engine';
import { ProjectMemoryPolicy } from './context/policies/project-memory-policy';
import { DefaultPromptBuilder } from './prompt/default-prompt-builder';
import { InMemoryProviderRegistry } from './provider/in-memory-provider-registry';
import { InMemorySession } from './session/in-memory-session';
import { InMemoryToolRegistry } from './tool/in-memory-tool-registry';
import { ToolExecutor } from './tool/tool-executor';
import { TaskExecutor } from './execution/task-executor';
import { ConversationOrchestrator } from './conversation/conversation-orchestrator';
import { KnowledgePipeline } from './knowledge/knowledge-pipeline';
import { DefaultWorkspaceMemory } from './memory/workspace-memory';
import { DefaultMemoryContextBuilder } from './memory/memory-context-builder';
import { FileMemoryStorage } from './memory/file-memory-storage';
import { DefaultWorkspaceMemoryRepository } from './memory/default-workspace-memory-repository';
import { DefaultRoleMemoryRepository } from './memory/default-role-memory-repository';
import { NodeRuntimeHealthProvider } from './health/node-runtime-health-provider';
import { DefaultExecutionGovernor } from './health/default-execution-governor';
import { DefaultSessionStore } from './session/default-session-store';
import { FileSessionStoreImpl } from './session/file-session-store';
import { SessionManagerExtended } from './session/session-manager-extended';
import { ApplicationCommandService } from '../app/application-command-service';

import { SessionManager } from './session/session-manager';
import { InMemoryModelRegistry } from './model/in-memory-model-registry';
import { OllamaModelDiscovery } from './model/ollama-model-discovery';
import { ModelRegistry } from '../contracts/model-registry';
import { InMemoryRoleRegistry } from './agent/in-memory-role-registry';
import { InMemoryRoleAssignmentRegistry } from './agent/in-memory-role-assignment-registry';
import { DefaultRoleAssignmentService } from './agent/default-role-assignment-service';
import { FileAssignmentRepository } from './agent/file-assignment-repository';
import { DEFAULT_ASSIGNMENTS } from './agent/default-role-assignments';
import { DefaultAgentOrchestrator } from './agent/default-agent-orchestrator';
import { DEFAULT_ROLES } from './agent/default-roles';
import { DefaultBackupManager } from './patch/default-backup-manager';
import { DefaultPatchExecutor } from './patch/default-patch-executor';
import { DefaultReflectionEngine } from './reflection/default-reflection-engine';
import { DefaultImpactAnalyzer } from './impact-analysis/default-impact-analyzer';
import { DeterministicRegressionSelector } from './impact-analysis/deterministic-regression-selector';
import { RegressionSelector } from '../contracts/regression-selector';
import { DefaultReviewer } from './review/default-reviewer';
import { DefaultWorkflowOrchestrator } from './workflow/default-workflow-orchestrator';
import { DefaultPlanValidator } from './planning/default-plan-validator';
import { DefaultVerificationStrategyEngine } from './verification/default-verification-strategy-engine';
import { DefaultKnowledgeFeedbackEngine } from './knowledge/default-knowledge-feedback-engine';
import { DefaultPostExecutionPipeline } from './pipeline/default-post-execution-pipeline';
import { DefaultContextOptimizer } from './context/default-context-optimizer';
import { DefaultToolPolicy } from './tool-policy/default-tool-policy';
import { DefaultVerificationEngine } from './patch/default-verification-engine';
import { SafePatchExecutor } from './patch/safe-patch-executor';
import { StructuralAnalyzer } from './patch/structural-analyzer';
import { DefaultStructuralGraphIndexer } from './knowledge/structural-graph-indexer';
import { DefaultKnowledgeSynchronizer } from './knowledge/knowledge-synchronizer';
import { DefaultStructuralKnowledgeQuery } from './knowledge/structural-knowledge-query';
import { PlanStepKnowledgeBridge } from './knowledge/plan-step-knowledge-bridge';
import { DefaultKnowledgeFusionRetriever } from './knowledge/knowledge-fusion-retriever';

import { ShellValidationEngine } from './patch/shell-validation-engine';
import { ShellTestRunner } from './patch/shell-test-runner';
import { ApplyPatchTool } from './tools/workspace/apply-patch-tool';
import { ShellCommandExecutor } from './git/shell-command-executor';
import { DefaultGitManager } from './git/default-git-manager';
import { CommitMessageGenerator } from './git/commit-message-generator';


import { DefaultTaskPlanner } from './planning/default-task-planner';
import { DefaultExecutionPlanner } from './planning/default-execution-planner';
import { DefaultTaskDecomposer } from './planning/default-task-decomposer';
import { StepExecutionEngine } from './execution/step-execution-engine';
import { TypeInventoryBuilder } from './type-analysis/type-inventory';
import { PrePatchTypeChecker } from './type-analysis/pre-patch-type-checker';
import { SelfHealingExecutor } from './execution/self-healing-executor';
import { ExecutionStateTracker } from './execution/execution-state-tracker';
import type { IExecutionStateTracker } from '../contracts/execution-state-tracker';
import { DefaultTelemetryCollector } from './observability/default-telemetry-collector';
import { DefaultDiagnosticsReporter } from './observability/default-diagnostics-reporter';
import { FileDocumentationRepository } from './documentation/file-documentation-repository';
import { DefaultDocumentationService } from './documentation/default-documentation-service';
import { FileCheckpointRepository } from './checkpoint/file-checkpoint-repository';
import { ResumeEngine } from './checkpoint/resume-engine';
import { DefaultRecoveryService } from './recovery/default-recovery-service';
import { DefaultRecoveryTrigger } from './recovery/default-recovery-trigger';
import { FileAuditRepository } from './audit/file-audit-repository';
import { DefaultAuditService } from './audit/default-audit-service';
import { Logger } from '../contracts/logger';
import { EffectiveConfiguration } from '../domain/effective-configuration';
import { DefaultConfigurationLoader } from './configuration/default-configuration-loader';
import { DefaultConfigurationMigrator } from './configuration/default-configuration-migrator';
import { ConfigurationLoader } from '../contracts/configuration-loader';
import { ContextLimits } from '../domain/context-limits';
import { ToolDefinition } from '../contracts/provider';
import type { LlmProvider } from '../contracts/llm-provider';
import type { ModelDiscovery } from '../contracts/model-discovery';
import { isProviderHealthCheckable } from '../contracts/provider-health';
import {
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  ProviderHealthOptions,
  ProviderHealthResult,
} from '../domain/provider-health';
import {
  ProviderSmokeTestOptions,
  ProviderSmokeTestResult,
} from '../domain/provider-smoke-test';
import { runProviderSmokeTest } from './provider/provider-smoke-test';
import { createLlmProviderFromSettings } from './provider/create-llm-provider-from-settings';
import { ResilientLlmProvider } from './provider/resilient-llm-provider';
import { ProviderRuntimeContext } from './provider/provider-runtime-context';
import { Session } from '../contracts/session';
import { Tool } from '../domain/tool';
import { ProviderId, KnownProviders, createProviderId } from '../domain/provider-id';
import { ReadFileTool } from './tools/workspace/read-file-tool';
import { WriteFileTool } from './tools/workspace/write-file-tool';
import { CreateFileTool } from './tools/workspace/create-file-tool';
import { DeleteFileTool } from './tools/workspace/delete-file-tool';
import { ListDirectoryTool } from './tools/workspace/list-directory-tool';
import { SearchFilesTool } from './tools/workspace/search-files-tool';
import { GrepTool } from './tools/workspace/grep-tool';

// G.0: Pre-Execution Components (Stage 0 — DI wiring only, not yet active)
import { Workspace } from '../contracts/workspace';
import { TaskIntake } from '../contracts/task-intake';
import { PreflightAnalyzer } from '../contracts/preflight-analyzer';
import { EvidenceBuilder } from '../contracts/evidence-builder';
import { ClarificationEngine } from '../contracts/clarification-engine';
import { DecisionAdvisor } from '../contracts/decision-advisor';
import { ContractPlanner } from '../contracts/contract-planner';
import { PlanCritic } from '../contracts/plan-critic';
import { ContractBuilder } from '../contracts/contract-builder';
import { ExecutionGate } from '../contracts/execution-gate';
import { SafeExperiment } from '../contracts/safe-experiment';
import { PreExecutionOrchestrator } from '../contracts/pre-execution-orchestrator';
import { DefaultTaskIntake } from './pre-execution/task-intake';
import { DefaultPreflightAnalyzer } from './pre-execution/preflight-analyzer';
import { DefaultEvidenceBuilder } from './pre-execution/evidence-builder';
import { DefaultClarificationEngine } from './pre-execution/clarification-engine';
import { DefaultDecisionAdvisor } from './pre-execution/decision-advisor';
import { DefaultContractPlanner } from './pre-execution/contract-planner';
import { DefaultPlanCritic } from './pre-execution/plan-critic';
import { DefaultContractBuilder } from './pre-execution/contract-builder';
import { DefaultExecutionGate } from './pre-execution/execution-gate';
import { DefaultSafeExperiment } from './pre-execution/safe-experiment';
import { DefaultQualityPolicy } from './vv/default-quality-policy';
import { HeuristicProductValidator } from './vv/heuristic-product-validator';
import { DefaultDeterministicVerifier } from './vv/default-deterministic-verifier';
import { DefaultApiVerifier } from './vv/default-api-verifier';
import { PlaywrightBrowserVerifier } from './vv/playwright-browser-verifier';
import { DefaultSecurityVerifier } from './vv/default-security-verifier';
import { DefaultAdaptiveAdversary } from './vv/default-adaptive-adversary';
import { FileRegressionStore } from './vv/file-regression-store';
import { DefaultVvAgent } from './vv/default-vv-agent';
import { parseQualityProfile } from '../domain/quality-profile';
import { DefaultPreExecutionOrchestrator } from './pre-execution/orchestrator';
import { readFileSync } from 'fs';
import * as path from 'path';

// Milestone A: Skill & Context foundation (DI wiring only — not consumed by planner/executor)
import { SkillRegistry } from '../contracts/skill-registry';
import { SkillResolver } from '../contracts/skill-resolver';
import { ProjectDetector } from '../contracts/project-detector';
import { AiContextLoader } from '../contracts/ai-context';
import { ContextCache, ProjectContextService, ProjectFingerprinter } from '../contracts/context-cache';
import { createDefaultSkillRegistry } from './skill/default-skills';
import { DeterministicSkillResolver } from './skill/deterministic-skill-resolver';
import { NodeProjectDetector } from './project/node-project-detector';
import { FileAiContextLoader } from './project/file-ai-context-loader';
import { InMemoryContextCache } from './project/in-memory-context-cache';
import { FilesystemProjectFingerprinter } from './project/filesystem-project-fingerprinter';
import { DefaultProjectContextService } from './project/default-project-context-service';
import { PlannerContextPreparationService } from '../contracts/planner-context';
import { DefaultPlannerContextPreparationService } from './planning/planner-context-preparation-service';
import { TargetedContextGatherer } from './planning/targeted-context-gatherer';
import { ContextGatherer } from '../contracts/context-gatherer';
import { canonicalizeWorkspaceRoot } from './workspace/workspace-paths';
import { TaskRunStore } from '../contracts/task-run-store';
import { FileTaskRunStore } from '../app/file-task-run-store';
import { ConfirmationStore } from '../contracts/confirmation-store';
import { FileConfirmationStore } from './confirmation/file-confirmation-store';
import { ConfirmationPolicy } from './confirmation/confirmation-policy';
import { ConfirmationService } from '../app/confirmation-service';
import { TaskExecutionService } from '../app/task-execution-service';
import { TaskQueryService } from '../app/task-query-service';
import { ReliabilityStore } from '../contracts/reliability-store';
import { FileReliabilityStore } from '../app/file-reliability-store';
import { ReliabilityService } from '../app/reliability-service';
import { PipelineEventReader } from '../app/pipeline-event-reader';
import { resolveRepairLimits } from './repair/repair-limits';



export class AppFactory {
  private _providerRegistry?: InMemoryProviderRegistry;
  private _modelRegistry?: ModelRegistry;
  private _roleRegistry?: InMemoryRoleRegistry;
  private _roleAssignmentRegistry?: InMemoryRoleAssignmentRegistry;
  private _assignmentRepository?: FileAssignmentRepository;
  private _roleAssignmentService?: DefaultRoleAssignmentService;
  private _workspaceMemory?: DefaultWorkspaceMemory;
  private _sessionManagers = new Map<string, SessionManager>();
  private _config?: import('./configuration/json-configuration').JsonConfiguration;
  private _skillRegistry?: SkillRegistry;
  private _contextCache?: ContextCache;
  private _projectContextService?: ProjectContextService;
  private _plannerContextPreparer?: PlannerContextPreparationService;
  private readonly rootDir: string;

  private readonly logger: Logger;
  /** Phase 6: whether planner/executor consume structural/fused knowledge. Default on. */
  private readonly knowledgeConsumption: 'on' | 'off';

  constructor(
    rootDir: string,
    logger?: Logger,
    private readonly effectiveConfig?: EffectiveConfiguration,
    knowledgeConsumption: 'on' | 'off' = 'on',
    private readonly providerRuntime?: ProviderRuntimeContext,
  ) {
    this.rootDir = canonicalizeWorkspaceRoot(rootDir);
    this.knowledgeConsumption = knowledgeConsumption === 'off' ? 'off' : 'on';
    this.logger = logger ?? {
      info: () => {},
      warn: (msg: string) => console.warn(msg),
      error: (msg: string) => console.error(msg),
      debug: () => {},
    };
  }

  /** Phase 6 benchmark: current knowledge consumption mode. */
  getKnowledgeConsumption(): 'on' | 'off' {
    return this.knowledgeConsumption;
  }

  private isKnowledgeConsumptionEnabled(): boolean {
    return this.knowledgeConsumption === 'on';
  }

  createRuntimeRepository() {
    return new LocalRuntimeRepository(this.rootDir);
  }

  /** Canonical workspace root shared by every adapter. */
  get workspaceRoot(): string {
    return this.rootDir;
  }

  createTaskRunStore(): TaskRunStore {
    return new FileTaskRunStore(this.rootDir);
  }

  /**
   * The application boundary CLI, REPL and any other adapter use to run a task.
   * Adapters format output; they never orchestrate the pipeline themselves.
   */
  createTaskExecutionService(): TaskExecutionService {
    return new TaskExecutionService(
      this.createAgentOrchestrator(this.rootDir),
      this.createTaskRunStore(),
      this.rootDir,
      resolveRepairLimits(this.createQualityPolicy()),
    );
  }

  createTaskQueryService(): TaskQueryService {
    return new TaskQueryService(
      this.createTaskRunStore(),
      new PipelineEventReader(this.rootDir),
      this.rootDir,
    );
  }

  createConfirmationStore(): ConfirmationStore {
    return new FileConfirmationStore(this.rootDir);
  }

  createConfirmationPolicy(): ConfirmationPolicy {
    return new ConfirmationPolicy();
  }

  createConfirmationService(): ConfirmationService {
    return new ConfirmationService(
      this.createConfirmationStore(),
      this.createConfirmationPolicy(),
    );
  }

  createReliabilityStore(): ReliabilityStore {
    return new FileReliabilityStore(this.rootDir);
  }

  /**
   * Reliability measurement boundary shared by CLI, REPL and Web so no adapter
   * computes its own metrics (G.29, G.30).
   */
  createReliabilityService(): ReliabilityService {
    return new ReliabilityService(
      this.createTaskRunStore(),
      this.createReliabilityStore(),
      this.rootDir,
    );
  }

  /**
   * Application command & query boundary for all interface adapters (UI-2.1).
   */
  createApplicationCommandService(): ApplicationCommandService {
    return new ApplicationCommandService(
      this.createTaskExecutionService(),
      this.createTaskQueryService(),
      this.createConfirmationService(),
      this.createReliabilityService(),
      this.rootDir,
    );
  }

  createConfiguration() {
    if (!this._config) {
      this._config = new JsonConfiguration(this.createRuntimeRepository());
    }
    return this._config;
  }

  createConfigurationLoader(): ConfigurationLoader {
    return new DefaultConfigurationLoader(this.createRuntimeRepository());
  }

  createConfigurationMigrator() {
    return new DefaultConfigurationMigrator(this.createRuntimeRepository());
  }

  createWorkspace() {
    return new LocalWorkspace(this.rootDir);
  }

  createTypeInventoryBuilder(): TypeInventoryBuilder {
    return new TypeInventoryBuilder(this.createWorkspace());
  }

  createPrePatchTypeChecker(): PrePatchTypeChecker {
    return new PrePatchTypeChecker();
  }

  createDiscoveryService(config: import('../contracts/configuration').Configuration) {
    const runtime = this.createRuntimeRepository();
    return new ProjectDiscoveryService(
      new ManifestLoader(runtime, config, this.logger),
      new RuleLoader(runtime, config),
      new KnowledgeLoader(runtime, config),
      new MemoryLoader(runtime, config)
    );
  }

  createProjectStructureService(): DefaultProjectStructureService {
    return new DefaultProjectStructureService();
  }

  createSemanticReferenceProvider(): SemanticReferenceProvider {
    // Phase 3a: Always return null provider (infrastructure only, no behavior change)
    // Phase 3b: Check effectiveConfig?.experimentalFeatures?.lsp?.enabled and return
    //           LspSemanticReferenceProvider if enabled, else NullSemanticReferenceProvider
    return new NullSemanticReferenceProvider();
  }

  createContextEngine(limits: ContextLimits) {
    return new DefaultContextEngine(
      new ContextSelector(this.createSemanticReferenceProvider()),
      new ProjectMemoryPolicy(),
      new ContextLimiter(limits),
      new ContextBuilder(),
      new ContextFreezer()
    );
  }

  createPromptBuilder() {
    return new DefaultPromptBuilder();
  }

  /**
   * Composition-root wiring for LLM providers.
   * Vendor clients are constructed here only, selected via EffectiveConfiguration.provider
   * and optional ProviderRuntimeContext (multi-provider failover).
   */
  createProviderRegistry() {
    if (this._providerRegistry) return this._providerRegistry;

    const settings = this.effectiveConfig?.provider ?? {
      type: 'ollama' as const,
      baseUrl: this.effectiveConfig?.ollamaBaseUrl ?? 'http://localhost:11434',
    };
    const defaultProviderId = createProviderId(
      this.effectiveConfig?.defaultProvider ?? settings.type,
    );

    const bindings = new Map<ProviderId, LlmProvider>();
    const resilient = this.buildResilientProvider(settings);
    const underlyingType = settings.type;

    if (underlyingType === 'openai-compatible') {
      bindings.set(KnownProviders.OPENAI_COMPATIBLE, resilient);
      bindings.set(defaultProviderId, resilient);
    } else {
      bindings.set(KnownProviders.OLLAMA, resilient);
      bindings.set(defaultProviderId, resilient);
    }
    // Always expose both known ids to the same resilient wrapper so role
    // assignments that name either backend still resolve during failover.
    bindings.set(KnownProviders.OLLAMA, resilient);
    bindings.set(KnownProviders.OPENAI_COMPATIBLE, resilient);

    this._providerRegistry = new InMemoryProviderRegistry(bindings);
    return this._providerRegistry;
  }

  private buildResilientProvider(
    fallbackSettings: { type: 'ollama' | 'openai-compatible'; baseUrl: string; apiKey?: string; model?: string },
  ): LlmProvider {
    const runtime = this.providerRuntime;
    if (runtime && runtime.orderedCandidates.length > 0) {
      const candidates = runtime.orderedCandidates.map((c) => ({
        name: c.name,
        provider: createLlmProviderFromSettings(c.settings),
      }));
      return new ResilientLlmProvider({
        candidates,
        preferredName: runtime.preferredName,
        onFailoverMessage: runtime.onFailoverMessage
          ?? ((msg) => this.logger.warn(msg)),
        attemptTimeoutMs: runtime.attemptTimeoutMs,
      });
    }

    // Single-provider path (legacy / no multi-candidate context)
    const name = fallbackSettings.type === 'openai-compatible'
      ? 'openai-compatible'
      : 'ollama';
    if (fallbackSettings.type === 'openai-compatible' && !fallbackSettings.apiKey) {
      throw new Error(
        '[AppFactory] openai-compatible provider requires provider.apiKey (or AGENT_LLM_API_KEY)',
      );
    }
    const single = createLlmProviderFromSettings({
      type: fallbackSettings.type,
      baseUrl: fallbackSettings.baseUrl
        || (fallbackSettings.type === 'ollama'
          ? (this.effectiveConfig?.ollamaBaseUrl ?? 'http://localhost:11434')
          : fallbackSettings.baseUrl),
      apiKey: fallbackSettings.apiKey,
      model: fallbackSettings.model,
    });
    return new ResilientLlmProvider({
      candidates: [{ name, provider: single }],
      preferredName: name,
      onFailoverMessage: (msg) => this.logger.warn(msg),
    });
  }

  /** Resolve configured primary provider id (config-driven; no vendor hardcoding). */
  resolveConfiguredProviderId(): ProviderId {
    const id = this.effectiveConfig?.defaultProvider
      ?? this.effectiveConfig?.provider?.type
      ?? 'ollama';
    return createProviderId(id);
  }

  /**
   * Non-completion health probe for the configured LLM provider.
   * Does not invoke Planner/Executor or chat completions.
   */
  async checkConfiguredProviderHealth(
    options?: ProviderHealthOptions,
  ): Promise<ProviderHealthResult> {
    const registry = this.createProviderRegistry();
    const providerId = this.resolveConfiguredProviderId();
    const provider =
      registry.get(providerId)
      ?? registry.get(KnownProviders.OLLAMA)
      ?? registry.get(KnownProviders.OPENAI_COMPATIBLE);

    const model = options?.model ?? this.effectiveConfig?.defaultModel
      ?? this.effectiveConfig?.provider?.model;
    const settings = this.effectiveConfig?.provider;
    const fallbackEndpoint = settings?.baseUrl
      ?? this.effectiveConfig?.ollamaBaseUrl
      ?? 'http://localhost:11434';

    if (!provider || !isProviderHealthCheckable(provider)) {
      return {
        providerType: settings?.type ?? String(providerId),
        endpoint: fallbackEndpoint,
        configuredModel: model,
        authentication: 'not_checked',
        latencyMs: 0,
        status: 'unknown',
        message: 'Configured provider does not implement health checks',
        checkedAt: new Date().toISOString(),
      };
    }

    return provider.checkHealth({
      model,
      timeoutMs: options?.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
    });
  }

  /**
   * Minimal completion smoke test for the configured LLM provider.
   * Uses ProviderRegistry + generate(); does not invoke Planner/Executor.
   */
  async runConfiguredProviderSmokeTest(
    options?: ProviderSmokeTestOptions,
  ): Promise<ProviderSmokeTestResult> {
    const registry = this.createProviderRegistry();
    const providerId = this.resolveConfiguredProviderId();
    const provider =
      registry.get(providerId)
      ?? registry.get(KnownProviders.OLLAMA)
      ?? registry.get(KnownProviders.OPENAI_COMPATIBLE);

    const settings = this.effectiveConfig?.provider;
    const model =
      options?.model
      ?? this.effectiveConfig?.defaultModel
      ?? settings?.model
      ?? 'unknown';
    const endpoint =
      settings?.baseUrl
      ?? this.effectiveConfig?.ollamaBaseUrl
      ?? 'http://localhost:11434';
    const providerType = settings?.type ?? String(providerId);

    if (!provider) {
      return {
        providerType,
        endpoint,
        model,
        latencyMs: 0,
        success: false,
        failureCategory: 'unavailable',
        message: `Configured provider not found: ${providerId}`,
        checkedAt: new Date().toISOString(),
      };
    }

    return runProviderSmokeTest(
      provider,
      { providerType, endpoint, model },
      options,
    );
  }

  /** Vendor model discovery behind ModelDiscovery — currently Ollama /api/tags. */
  createModelDiscovery(): ModelDiscovery {
    const baseUrl =
      this.effectiveConfig?.provider?.type === 'ollama'
        ? (this.effectiveConfig.provider.baseUrl || this.effectiveConfig.ollamaBaseUrl)
        : (this.effectiveConfig?.ollamaBaseUrl ?? 'http://localhost:11434');
    return new OllamaModelDiscovery(baseUrl);
  }

  createTaskExecutor() {
    return new TaskExecutor(
      this.createPromptBuilder(),
      this.createProviderRegistry(),
      this.createToolExecutor(),
      this.createWorkspaceMemory(),
      this.createMemoryContextBuilder(),
      this.createSessionManager(this.rootDir),
      this.createReflectionEngine()
    );
  }

  createReflectionEngine() {
    return new DefaultReflectionEngine();
  }

  createImpactAnalyzer() {
    return new DefaultImpactAnalyzer(this.createWorkspace(), this.createWorkspaceMemory());
  }

  createRegressionSelector(): RegressionSelector {
    return new DeterministicRegressionSelector();
  }

  createReviewer() {
    return new DefaultReviewer(this.createWorkspace(), this.createWorkspaceMemory());
  }

  createWorkflowOrchestrator(workspacePath: string) {
    // A.5: Hybrid Architecture logs
    ExecutionLogger.log('ARCHITECTURE', 'planner', '-', 'Planner: cloud model configured');
    ExecutionLogger.log('ARCHITECTURE', 'reviewer', '-', 'Reviewer: cloud model configured');
    ExecutionLogger.log('ARCHITECTURE', 'coder', '-', 'Coder: role-assigned model configured');

    return new DefaultWorkflowOrchestrator(
      this.createSessionManager(workspacePath),
      this.createWorkspaceMemory(),
      this.createTaskPlanner(),
      this.createImpactAnalyzer(),
      this.createReviewer(),
      this.createSafePatchExecutor(workspacePath, this.createSessionManager(workspacePath)),
      this.createGitManager(workspacePath),
      this.createReflectionEngine(),
      this.createPlanValidator(),
      this.createVerificationStrategyEngine(),
      this.createPostExecutionPipeline(),
      this.createExecutionGovernor(),
      this.createRuntimeHealthProvider(),
      undefined,
      new TaskExecutor(
        this.createPromptBuilder(),
        this.createProviderRegistry(),
        this.createToolExecutor(),
        this.createWorkspaceMemory(),
        this.createMemoryContextBuilder(),
      ),
      this.createToolDefinitions(),
      this.createWorkspaceMemoryRepository(),
      this.createRoleMemoryRepository(),
      this.createMemoryContextBuilder(),
      this.createStepExecutionEngine(workspacePath),
      this.createContextEngine({ rules: 15, knowledge: 10, memory: 20, files: 10 }),
      this.createDiscoveryService(this.createConfiguration()),
      this.createConfiguration(),
      this.createExecutionPlanner(),
      this.createTaskDecomposer(),
      this.createExecutionStateTracker(),
      workspacePath,
      this.createProjectStructureService(),
      this.createTaskIntake(),  // G.1: Stage 1 TaskIntake wiring
      this.createPreflightAnalyzer(this.createWorkspace()),  // G.2: Stage 2 Preflight wiring
      this.createEvidenceBuilder(this.createWorkspace()),  // G.2: Stage 2 Evidence wiring
      this.createClarificationEngine(),  // G.3: Stage 3 Clarification wiring
      this.createDecisionAdvisor(),  // G.4: Stage 4 DecisionAdvisor wiring
      this.createContractBuilder(),  // G.5: Stage 5 ContractBuilder wiring
      this.createExecutionGate(),  // G.6: Stage 6 ExecutionGate wiring
      this.createSafeExperiment(this.createWorkspace()),  // G.6: Stage 6 SafeExperiment wiring
      this.createQualityPolicy(),
      this.createProductValidator(),
      this.createVvAgent(workspacePath),
      this.createPlannerContextPreparationService(),
      undefined,
      this.createConfirmationService(),
    );
  }

  createExecutionStateTracker(): IExecutionStateTracker {
    return new ExecutionStateTracker(this.createRuntimeRepository());
  }

  createPlanValidator() {
    return new DefaultPlanValidator();
  }

  createExecutionPlanner() {
    return new DefaultExecutionPlanner();
  }

  createTaskDecomposer() {
    return new DefaultTaskDecomposer();
  }

  createStepExecutionEngine(workspacePath: string, providerId?: import('../domain/provider-id').ProviderId, modelId?: string) {
    return new StepExecutionEngine(
      this.createSessionManager(workspacePath),
      this.createReflectionEngine(),
      this.createExecutionGovernor(),
      this.createRuntimeHealthProvider(),
      undefined,
      this.createResumeEngine(),
      this.createAuditService(),
      new TaskExecutor(
        this.createPromptBuilder(),
        this.createProviderRegistry(),
        this.createToolExecutor([], workspacePath),
        this.createWorkspaceMemory(),
        this.createMemoryContextBuilder(),
      ),
      this.createToolDefinitions(),
      providerId,
      modelId,
      this.createSelfHealingExecutor(),
      this.effectiveConfig?.selfHealing,
      this.createWorkspace(),
      this.createTypeInventoryBuilder(),
      this.createPrePatchTypeChecker(),
      this.createGitManager(workspacePath),
      this.isKnowledgeConsumptionEnabled() ? this.createPlanStepKnowledgeBridge() : undefined,
    );
  }

  createSelfHealingExecutor() {
    return new SelfHealingExecutor(
      this.createTaskExecutor(),
      this.createKnowledgeFeedbackEngine(),
      this.createRuntimeRepository(),
    );
  }

  createTelemetryCollector(executionId: string, sessionId: string, planId?: string) {
    return new DefaultTelemetryCollector(executionId, sessionId, planId);
  }

  createDiagnosticsReporter() {
    return new DefaultDiagnosticsReporter();
  }

  createDocumentationRepository() {
    return new FileDocumentationRepository(this.createRuntimeRepository());
  }

  createDocumentationService() {
    return new DefaultDocumentationService(this.createDocumentationRepository());
  }

  createCheckpointRepository() {
    return new FileCheckpointRepository(this.createRuntimeRepository());
  }

  createResumeEngine() {
    return new ResumeEngine(this.createCheckpointRepository());
  }

  createRecoveryService() {
    return new DefaultRecoveryService(this.createCheckpointRepository(), this.createResumeEngine());
  }

  createRecoveryTrigger() {
    return new DefaultRecoveryTrigger(this.createRecoveryService(), this.createCheckpointRepository(), this.createAuditService());
  }

  createAuditRepository() {
    return new FileAuditRepository(this.createRuntimeRepository());
  }

  createAuditService() {
    return new DefaultAuditService(this.createAuditRepository());
  }

  createVerificationStrategyEngine() {
    return new DefaultVerificationStrategyEngine();
  }

  createKnowledgeFeedbackEngine() {
    return new DefaultKnowledgeFeedbackEngine();
  }

  createPostExecutionPipeline() {
    return new DefaultPostExecutionPipeline(
      this.createKnowledgeFeedbackEngine(),
      this.createRuntimeRepository(),
      this.createWorkspaceMemoryRepository(),
      this.createRoleMemoryRepository(),
      'coder'
    );
  }

  createRoleRegistry() {
    if (this._roleRegistry) return this._roleRegistry;
    const registry = new InMemoryRoleRegistry();
    for (const role of DEFAULT_ROLES) {
      registry.register(role);
    }
    this._roleRegistry = registry;
    return this._roleRegistry;
  }

  createRoleAssignmentRegistry() {
    if (this._roleAssignmentRegistry) return this._roleAssignmentRegistry;
    const registry = new InMemoryRoleAssignmentRegistry();
    // Load defaults first
    for (const assignment of DEFAULT_ASSIGNMENTS) {
      registry.assign(assignment);
    }
    // Override with user-saved assignments (sync read)
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(this.rootDir, '.ai', 'config', 'role-assignments.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.assignments)) {
          for (const a of parsed.assignments) {
            registry.update(Object.freeze({
              roleId: a.roleId,
              modelId: a.modelId,
              providerId: a.providerId,
              assignedAt: a.assignedAt ?? new Date().toISOString(),
              updatedAt: a.updatedAt ?? new Date().toISOString(),
              source: a.source ?? 'user',
            }));
          }
        }
      }
    } catch { /* no user assignments file yet */ }
    this._roleAssignmentRegistry = registry;
    return this._roleAssignmentRegistry;
  }

  createAssignmentRepository() {
    if (this._assignmentRepository) return this._assignmentRepository;
    this._assignmentRepository = new FileAssignmentRepository(this.createRuntimeRepository());
    return this._assignmentRepository;
  }

  createRoleAssignmentService() {
    if (this._roleAssignmentService) return this._roleAssignmentService;
    this._roleAssignmentService = new DefaultRoleAssignmentService(
      this.createRoleRegistry(),
      this.createRoleAssignmentRegistry(),
      this.createModelRegistry(),
      this.createProviderRegistry(),
      this.createAssignmentRepository()
    );
    return this._roleAssignmentService;
  }

  createAgentOrchestrator(workspacePath: string) {
    const roleRegistry = this.createRoleRegistry();
    const roleAssignmentRegistry = this.createRoleAssignmentRegistry();
    const modelRegistry = this.createModelRegistry();
    const providerRegistry = this.createProviderRegistry();

    // Startup Validation: Assignments → Models → Providers (Warn on missing)
    for (const assignment of roleAssignmentRegistry.list()) {
      const model = modelRegistry.get(assignment.modelId);
      if (!model) {
        this.logger.warn(
          `[Startup] Role "${assignment.roleId}" references model "${assignment.modelId}" which is not available. Skipping.`
        );
        continue;
      }
      if (model.availability !== 'available') {
        this.logger.warn(
          `[Startup] Model "${assignment.modelId}" assigned to role "${assignment.roleId}" is not available (status: ${model.availability})`
        );
        continue;
      }
      if (!providerRegistry.has(model.providerId as any)) {
        this.logger.warn(
          `[Startup] Model "${assignment.modelId}" references provider "${model.providerId}" which is not registered. Skipping.`
        );
        continue;
      }
    }

    return new DefaultAgentOrchestrator(
      roleRegistry,
      roleAssignmentRegistry,
      modelRegistry,
      providerRegistry,
      this.createWorkflowOrchestrator(workspacePath),
      this.createQualityPolicy()
    );
  }

  createModelRegistry(): ModelRegistry {
    if (this._modelRegistry) return this._modelRegistry;
    const registry = new InMemoryModelRegistry();
    this._modelRegistry = registry;
    return this._modelRegistry;
  }
  
  async discoverOllamaModels(): Promise<number> {
    const registry = this.createModelRegistry();
    const discovery = this.createModelDiscovery();
    const discovered = await discovery.discover();

    let added = 0;
    for (const model of discovered) {
      if (!registry.get(model.id)) {
        registry.register(model);
        added++;
      }
    }
    return added;
  }

  createSession(): Session {
    return new InMemorySession();
  }

  createWorkspaceTools(): ReadonlyArray<Tool> {
    const workspace = this.createWorkspace();
    return [
      new ReadFileTool(workspace),
      new WriteFileTool(workspace, this.createPatchExecutor()),
      new CreateFileTool(workspace, this.createPatchExecutor()),
      new DeleteFileTool(workspace),
      new ListDirectoryTool(workspace),
      new SearchFilesTool(workspace),
      new GrepTool(workspace),
      new ApplyPatchTool(this.createPatchExecutor(), this.createSessionManager(this.rootDir))
    ];
  }

  createToolRegistry(extraTools: ReadonlyArray<Tool> = []) {
    const workspaceTools = this.createWorkspaceTools();
    return new InMemoryToolRegistry([...workspaceTools, ...extraTools]);
  }

  createToolPolicy() {
    return new DefaultToolPolicy();
  }

  createToolExecutor(extraTools: ReadonlyArray<Tool> = [], workspacePath?: string) {
    return new ToolExecutor(
      this.createToolRegistry(extraTools),
      this.createSessionManager(this.rootDir),
      this.createToolPolicy(),
      workspacePath ?? this.rootDir
    );
  }

  createToolDefinitions(extraTools: ReadonlyArray<Tool> = []): ReadonlyArray<ToolDefinition> {
    const registry = this.createToolRegistry(extraTools);
    const toolNames = registry.list();
    const definitions: ToolDefinition[] = [];
    
    for (const toolName of toolNames) {
      const tool = registry.get(toolName);
      if (tool && tool.parameters) {
        definitions.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        });
      }
    }
    
    return Object.freeze(definitions);
  }

  createConversationOrchestrator(
    config: import('../contracts/configuration').Configuration,
    limits: ContextLimits,
    session?: Session
  ) {
    return new ConversationOrchestrator(
      this.createDiscoveryService(config),
      this.createContextEngine(limits),
      session ?? this.createSession(),
      this.createTaskExecutor(),
      this.createTaskPlanner()
    );
  }

  createKnowledgePipeline(model?: string) {
    return new KnowledgePipeline(
      this.createRuntimeRepository(),
      this.createTaskExecutor(),
      this.createWorkspace(),
      this.createToolDefinitions(),
      model || this.effectiveConfig?.defaultModel || 'gpt-oss:120b-cloud'
    );
  }

  createWorkspaceMemory() {
    if (this._workspaceMemory) return this._workspaceMemory;
    this._workspaceMemory = new DefaultWorkspaceMemory(this.createRuntimeRepository());
    return this._workspaceMemory;
  }

  createMemoryContextBuilder() {
    return new DefaultMemoryContextBuilder();
  }

  createFileMemoryStorage() {
    return new FileMemoryStorage(this.createRuntimeRepository());
  }

  createWorkspaceMemoryRepository() {
    return new DefaultWorkspaceMemoryRepository(this.createFileMemoryStorage());
  }

  createRoleMemoryRepository() {
    return new DefaultRoleMemoryRepository(this.createFileMemoryStorage());
  }

  createRuntimeHealthProvider() {
    return new NodeRuntimeHealthProvider();
  }

  createExecutionGovernor() {
    const protection = this.effectiveConfig?.protection;
    return new DefaultExecutionGovernor(protection ? {
      cpuThreshold: protection.cpuThreshold,
      memoryThreshold: protection.memoryThreshold,
      temperatureThreshold: protection.temperatureThreshold,
      pauseDurationMs: protection.pauseDurationMs,
      healthCheckIntervalMs: protection.healthCheckIntervalMs,
      autoResume: protection.autoResume,
    } : undefined);
  }

  createTaskPlanner(model?: string) {
    const providerRegistry = this.createProviderRegistry();
    const providerId = this.resolveConfiguredProviderId();
    const provider =
      providerRegistry.get(providerId)
      ?? providerRegistry.get(KnownProviders.OLLAMA)
      ?? providerRegistry.get(KnownProviders.OPENAI_COMPATIBLE);
    if (!provider) {
      throw new Error(
        `[TaskPlanner] Provider not found: ${providerId}. ` +
        `Available providers: ${providerRegistry.list().join(', ')}`
      );
    }
    return new DefaultTaskPlanner(
      provider,
      this.createWorkspaceMemory(),
      this.createMemoryContextBuilder(),
      providerId,
      model || this.effectiveConfig?.defaultModel || 'gpt-oss:120b-cloud'
    );
  }

  createSessionStore() {
    return new DefaultSessionStore(this.createRuntimeRepository());
  }

  createSessionManager(workspacePath: string) {
    const cached = this._sessionManagers.get(workspacePath);
    if (cached) return cached;
    const manager = new SessionManager(this.createSessionStore(), workspacePath);
    this._sessionManagers.set(workspacePath, manager);
    return manager;
  }

  createFileSessionStore() {
    return new FileSessionStoreImpl(this.rootDir);
  }

  createSessionManagerExtended() {
    return new SessionManagerExtended(
      this.createSessionStore(),
      this.createFileSessionStore()
    );
  }

  createBackupManager() {
    return new DefaultBackupManager(
      this.createRuntimeRepository(),
      this.createWorkspace()
    );
  }

  createValidationEngine(workspacePath?: string) {
    return new ShellValidationEngine({
      commands: ['npm run build'],
      cwd: workspacePath ?? this.rootDir,
    });
  }

  createTestRunner(workspacePath?: string) {
    return new ShellTestRunner({
      command: 'npm test',
      cwd: workspacePath ?? this.rootDir,
    });
  }

  createPatchExecutor(sessionManager?: SessionManager) {
    return new DefaultPatchExecutor(
      this.createWorkspace(),
      this.createBackupManager(),
      this.createValidationEngine(this.rootDir),
      this.createTestRunner(this.rootDir),
      sessionManager,
      this.createGitManager(this.rootDir)
    );
  }

  createVerificationEngine() {
    return new DefaultVerificationEngine();
  }

  createSafePatchExecutor(workspacePath: string, sessionManager: import('./session/session-manager').SessionManager) {
    return new SafePatchExecutor({
      workspacePath,
      patchExecutor: this.createPatchExecutor(sessionManager),
      verificationEngine: this.createVerificationEngine(),
      sessionManager,
      structuralAnalyzer: this.createStructuralAnalyzer(),
    });
  }

  createStructuralAnalyzer(): StructuralAnalyzer {
    return new StructuralAnalyzer();
  }

  /**
   * Deterministic structural indexer (Phase 1 Knowledge System).
   * LLM-free. Does not use KnowledgePipeline.
   */
  createStructuralGraphIndexer() {
    return new DefaultStructuralGraphIndexer(
      this.createWorkspace(),
      this.createRuntimeRepository(),
      this.rootDir,
      this.createStructuralAnalyzer(),
    );
  }

  /**
   * Incremental structural synchronizer (Phase 2 Knowledge System).
   * Filesystem-authoritative. LLM-free. Does not use KnowledgePipeline.
   */
  createKnowledgeSynchronizer() {
    const analyzer = this.createStructuralAnalyzer();
    const indexer = new DefaultStructuralGraphIndexer(
      this.createWorkspace(),
      this.createRuntimeRepository(),
      this.rootDir,
      analyzer,
    );
    return new DefaultKnowledgeSynchronizer(
      this.createWorkspace(),
      this.createRuntimeRepository(),
      this.rootDir,
      analyzer,
      indexer,
    );
  }

  /** Bounded structural graph query (Phase 3/4). LLM-free. */
  createStructuralKnowledgeQuery() {
    return new DefaultStructuralKnowledgeQuery(
      this.createStructuralGraphIndexer(),
      this.createRuntimeRepository(),
    );
  }

  /** Phase 5: bounded fusion (delegates structural). LLM-free. */
  createKnowledgeFusionRetriever() {
    return new DefaultKnowledgeFusionRetriever(
      this.createStructuralKnowledgeQuery(),
      this.createRuntimeRepository(),
    );
  }

  /** PlanStep boundary: query/fusion before step, sync after mutations before checkpoint. */
  createPlanStepKnowledgeBridge() {
    return new PlanStepKnowledgeBridge(
      this.createKnowledgeSynchronizer(),
      this.createStructuralKnowledgeQuery(),
      undefined,
      this.createKnowledgeFusionRetriever(),
    );
  }

  createCommandExecutor() {
    return new ShellCommandExecutor();
  }

  createGitManager(cwd?: string) {
    return new DefaultGitManager(this.createCommandExecutor(), cwd);
  }

  createCommitMessageGenerator() {
    return new CommitMessageGenerator();
  }

  // ============================================================
  // G.0: Pre-Execution Component Factories (Stage 0 — DI wiring)
  // NOT yet active in execution. Preparation only.
  // ============================================================

  createTaskIntake(): TaskIntake {
    return new DefaultTaskIntake();
  }

  createPreflightAnalyzer(workspace: Workspace): PreflightAnalyzer {
    return new DefaultPreflightAnalyzer(workspace, this.rootDir);
  }

  createEvidenceBuilder(workspace: Workspace): EvidenceBuilder {
    return new DefaultEvidenceBuilder(workspace, this.rootDir);
  }


  createQualityPolicy() {
    const fromEnv = process.env.AGENT_QUALITY_PROFILE;
    const fromDisk = this.readQualityProfileFromDisk();
    const profile = parseQualityProfile(fromEnv || this.effectiveConfig?.qualityProfile || fromDisk);
    return new DefaultQualityPolicy(profile);
  }

  private readQualityProfileFromDisk(): string | undefined {
    try {
      const raw = readFileSync(path.join(this.rootDir, '.ai', 'config.json'), 'utf8');
      const parsed = JSON.parse(raw);
      return typeof parsed.qualityProfile === 'string' ? parsed.qualityProfile : undefined;
    } catch {
      return undefined;
    }
  }

  createProductValidator() {
    return new HeuristicProductValidator();
  }

  createVvAgent(workspacePath: string) {
    const policy = this.createQualityPolicy();
    return new DefaultVvAgent(
      this.createProductValidator(),
      policy,
      new DefaultDeterministicVerifier(this.createCommandExecutor()),
      new DefaultApiVerifier(),
      new PlaywrightBrowserVerifier(),
      new DefaultSecurityVerifier(),
      new DefaultAdaptiveAdversary(),
      new FileRegressionStore(this.createRuntimeRepository()),
    );
  }
  createClarificationEngine(): ClarificationEngine {
    return new DefaultClarificationEngine();
  }

  createDecisionAdvisor(): DecisionAdvisor {
    return new DefaultDecisionAdvisor();
  }

  createContractPlanner(): ContractPlanner {
    return new DefaultContractPlanner();
  }

  createPlanCritic(): PlanCritic {
    return new DefaultPlanCritic();
  }

  createContractBuilder(): ContractBuilder {
    return new DefaultContractBuilder();
  }

  createExecutionGate(): ExecutionGate {
    return new DefaultExecutionGate();
  }

  createSafeExperiment(workspace: Workspace): SafeExperiment {
    return new DefaultSafeExperiment(workspace);
  }

  /**
   * Milestone A: Skill registry. DI only — planner/executor do not consume this yet.
   */
  createSkillRegistry(): SkillRegistry {
    if (this._skillRegistry) return this._skillRegistry;
    this._skillRegistry = createDefaultSkillRegistry();
    return this._skillRegistry;
  }

  /**
   * Milestone A: Deterministic skill resolver. DI only — not used by the planner yet.
   */
  createSkillResolver(): SkillResolver {
    return new DeterministicSkillResolver(this.createSkillRegistry());
  }

  /**
   * Milestone A: Project capability detector. DI only — not used by execution.
   */
  createProjectDetector(): ProjectDetector {
    return new NodeProjectDetector();
  }

  /**
   * Milestone A: .ai context discovery. DI only — full loading is deferred.
   */
  createAiContextLoader(): AiContextLoader {
    return new FileAiContextLoader();
  }

  /**
   * Milestone A: Project context cache. DI only — not used by execution.
   */
  createContextCache(): ContextCache {
    if (this._contextCache) return this._contextCache;
    this._contextCache = new InMemoryContextCache();
    return this._contextCache;
  }

  createProjectFingerprinter(): ProjectFingerprinter {
    return new FilesystemProjectFingerprinter();
  }

  createProjectContextService(): ProjectContextService {
    if (this._projectContextService) return this._projectContextService;
    this._projectContextService = new DefaultProjectContextService(
      this.createProjectDetector(),
      this.createAiContextLoader(),
      this.createContextCache(),
      this.createProjectFingerprinter(),
    );
    return this._projectContextService;
  }

  /**
   * Milestone B2: targeted context gathering. Follows ContextStrategy.
   * Does not walk the repository or call an LLM.
   */
  createContextGatherer(): ContextGatherer {
    const knowledgeOn = this.isKnowledgeConsumptionEnabled();
    return new TargetedContextGatherer({
      cache: this.createContextCache(),
      aiContextLoader: this.createAiContextLoader(),
      limits: this.effectiveConfig?.contextGathering,
      structuralQuery: knowledgeOn ? this.createStructuralKnowledgeQuery() : undefined,
      fusionRetriever: knowledgeOn ? this.createKnowledgeFusionRetriever() : undefined,
    });
  }

  /**
   * Milestone B1/B2: assemble PlannerContext from strategy + targeted gathering.
   * Planner prompt consumption is deferred to B3.
   */
  createPlannerContextPreparationService(): PlannerContextPreparationService {
    if (this._plannerContextPreparer) return this._plannerContextPreparer;
    this._plannerContextPreparer = new DefaultPlannerContextPreparationService(
      this.createProjectContextService(),
      this.createSkillResolver(),
      this.createContextGatherer(),
    );
    return this._plannerContextPreparer;
  }

  /** Standalone G.10 composition for tests/library use. Not the /execute path. */
  createPreExecutionOrchestrator(workspace: Workspace): PreExecutionOrchestrator {
    return new DefaultPreExecutionOrchestrator(
      this.createTaskIntake(),
      this.createPreflightAnalyzer(workspace),
      this.createEvidenceBuilder(workspace),
      this.createClarificationEngine(),
      this.createDecisionAdvisor(),
      this.createContractPlanner(),
      this.createPlanCritic(),
      this.createContractBuilder(),
      this.createExecutionGate(),
    );
  }
}
