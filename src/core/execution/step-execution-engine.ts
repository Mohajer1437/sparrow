import { SessionManager } from '../session/session-manager';
import { GitManager } from '../../contracts/git-manager';
import { CommitMessageGenerator } from '../git/commit-message-generator';
import { TypeInventoryBuilder, TypeInventory } from '../type-analysis/type-inventory';
import { PrePatchTypeChecker } from '../type-analysis/pre-patch-type-checker';
import { Workspace } from '../../contracts/workspace';
import { ReflectionEngine } from '../../contracts/reflection-engine';
import { ExecutionGovernor } from '../../contracts/execution-governor';
import { RuntimeHealthProvider } from '../../contracts/runtime-health-provider';
import { PipelineHooks } from '../../contracts/pipeline-hooks';
import { ExecutionPlan, PlanStep } from '../../domain/execution-plan';
import { ExecutionContext, StepResult, StepExecutionResult } from '../../domain/execution-context';
import { isRepairContext } from '../vv/repair-scope';
import { formatAcceptanceContract } from '../../domain/acceptance-contract';
import { contractHasUnsatisfiedObservables } from '../vv/acceptance-contract';
import { ResumeEngine } from '../checkpoint/resume-engine';
import { AuditService } from '../../contracts/audit-service';
import { ExecutionLogger } from '../observability/execution-logger';
import { SelfHealingExecutor } from './self-healing-executor';
import { SelfHealingConfig } from '../../domain/self-healing-config';
import { TaskExecutor } from './task-executor';
import { ToolDefinition } from '../../contracts/provider';
import { Role } from '../../contracts/role';
import { ProviderId, KnownProviders } from '../../domain/provider-id';
import {
  EMPTY_MUTATION_LEDGER,
  MutationLedger,
  MutationResult,
  extractExpectedChangeMarkers,
} from '../../domain/execution/mutation-safety';
import { groundTargetPaths } from '../workspace/target-path-grounding';
import { PlanStepKnowledgeBridge } from '../knowledge/plan-step-knowledge-bridge';

export class StepExecutionEngine {
  private readonly _commitMessageGenerator?: CommitMessageGenerator;
  /** PHASE-09: files awaiting acceptance commit (commit barrier). */
  private pendingAcceptanceFiles: string[] = [];
  private deferCommitsUntilAcceptance = true;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly reflectionEngine: ReflectionEngine,
    private readonly executionGovernor?: ExecutionGovernor,
    private readonly runtimeHealthProvider?: RuntimeHealthProvider,
    private readonly pipelineHooks?: PipelineHooks,
    private readonly resumeEngine?: ResumeEngine,
    private readonly auditService?: AuditService,
    private readonly taskExecutor?: TaskExecutor,
    private readonly toolDefinitions?: ReadonlyArray<ToolDefinition>,
    private readonly providerId?: ProviderId,
    private readonly modelId?: string,
    private readonly selfHealingExecutor?: SelfHealingExecutor,
    private readonly selfHealingConfig?: SelfHealingConfig,
    private readonly workspace?: Workspace,
    private readonly typeInventoryBuilder?: TypeInventoryBuilder,
    private readonly prePatchTypeChecker?: PrePatchTypeChecker,
      private readonly gitManager?: GitManager,
    private readonly knowledgeBridge?: PlanStepKnowledgeBridge,
  ) {
    this._commitMessageGenerator = gitManager ? new CommitMessageGenerator() : undefined;
  }

  /** PHASE-09: drain deferred commit file list for acceptance barrier. */
  drainPendingAcceptanceFiles(): ReadonlyArray<string> {
    const files = Object.freeze([...new Set(this.pendingAcceptanceFiles.map(f => f.replace(/\\/g, '/')))]);
    this.pendingAcceptanceFiles = [];
    return files;
  }

  peekPendingAcceptanceFiles(): ReadonlyArray<string> {
    return Object.freeze([...new Set(this.pendingAcceptanceFiles.map(f => f.replace(/\\/g, '/')))]);
  }

  setDeferCommitsUntilAcceptance(value: boolean): void {
    this.deferCommitsUntilAcceptance = value;
  }

  /** R2.23: mutation evidence produced by this engine's tool calls. */
  drainMutationLedger(): MutationLedger {
    return this.taskExecutor?.drainMutationLedger() ?? EMPTY_MUTATION_LEDGER;
  }

  /** Phase 3: PlanStep knowledge bridge (sync + bounded query). */
  getKnowledgeBridge(): PlanStepKnowledgeBridge | undefined {
    return this.knowledgeBridge;
  }

  private peekMutationCount(): number {
    return this.taskExecutor?.peekMutationLedger?.().results.length ?? 0;
  }

  private mutationsSince(mark: number): ReadonlyArray<MutationResult> {
    return this.taskExecutor?.peekMutationLedger?.().results.slice(mark) ?? [];
  }

  /**
   * D.2: Extract file paths from step description using regex patterns.
   * Matches: relative paths with extensions like .ts, .tsx, .js, .jsx, .json, .md
   * Excludes: glob patterns like *.module.ts or wildcard patterns
   */
  private extractFilePathsFromDescription(description: string): string[] {
    if (!description) return [];

    const paths: string[] = [];
    const seen = new Set<string>();

    // Matches: app/quiz/page.tsx, src/lib/utils.ts, components/Modal.tsx
    // Do not match glob wildcards (*.ts, *.module.ts, etc.)
    const filePathRegex = /(?:^|[\s"'`(\[])(?![\*.])([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|json|md|css|scss))\b/gi;
    let match;
    while ((match = filePathRegex.exec(description)) !== null) {
      let path = match[1];
      if (!path) continue;
      if (path.includes('*')) continue;
      // Clean up: remove leading ./ if present
      if (path.startsWith('./')) path = path.substring(2);
      // Skip if too short or looks like a URL
      if (path.length < 3) continue;
      if (path.includes('://')) continue;
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }

    return paths;
  }

  /**
   * E.1: Extract meaningful symbols (function/type/class names) from step description.
   * Used to detect if step goal is already present in project.
   */
  private extractSymbolsFromDescription(description: string): string[] {
    const symbols: string[] = [];
    const seen = new Set<string>();

    // Common English words to skip (avoid false positives)
    const COMMON_WORDS = new Set([
      'add', 'create', 'update', 'modify', 'delete', 'remove', 'read', 'write',
      'file', 'files', 'function', 'functions', 'component', 'components',
      'class', 'classes', 'type', 'types', 'interface', 'interfaces', 'import',
      'imports', 'export', 'exports', 'const', 'let', 'var', 'the', 'and', 'for',
      'with', 'that', 'this', 'from', 'into', 'using', 'use', 'new', 'return',
      'async', 'await', 'step', 'task', 'code', 'test', 'check', 'verify', 'find',
      'get', 'set', 'has', 'can', 'may', 'should', 'will', 'would', 'could',
      'not', 'but', 'all', 'any', 'each', 'every', 'some', 'such', 'than',
      'make', 'makes', 'then', 'also', 'only', 'make', 'just', 'like', 'very',
      'when', 'what', 'which', 'where', 'while', 'after', 'before', 'about',
      'above', 'below', 'between', 'under', 'over', 'again', 'further', 'once',
    ]);

    // Match camelCase, PascalCase, snake_case identifiers
    const symbolRegex = /\b([A-Z][a-zA-Z0-9]{2,}|[a-z][a-zA-Z0-9]{3,})\b/g;
    let match;
    while ((match = symbolRegex.exec(description)) !== null) {
      const sym = match[1];
      if (sym.length < 3 || sym.length > 40) continue;
      if (COMMON_WORDS.has(sym.toLowerCase())) continue;
      // Skip if it looks like a file path segment
      if (sym.includes('/') || sym.includes('\\')) continue;
      if (!seen.has(sym)) {
        seen.add(sym);
        symbols.push(sym);
      }
    }
    return symbols;
  }

  /**
   * E.1: Extract import paths from TypeScript/JSX file content.
   */
  private extractImports(fileContent: string): string[] {
    const imports: string[] = [];
    const regex = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  /**
   * E.1: Extract top-level declared symbols from TypeScript content.
   * Captures: functions, classes, interfaces, types, exported consts.
   */
  private extractDefinedSymbols(fileContent: string): string[] {
    const symbols: string[] = [];
    const seen = new Set<string>();
    const patterns = [
      /\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /\bclass\s+([A-Z][a-zA-Z0-9_]*)/g,
      /\binterface\s+([A-Z][a-zA-Z0-9_]*)/g,
      /\btype\s+([A-Z][a-zA-Z0-9_]*)/g,
      /\bexport\s+default\s+function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /\bexport\s+(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(fileContent)) !== null) {
        const sym = match[1];
        if (sym.length >= 2 && !seen.has(sym)) {
          seen.add(sym);
          symbols.push(sym);
        }
      }
    }
    return symbols;
  }

  /**
   * E.1: Capture current project state for step's target files.
   * Returns a prompt section describing what already exists in those files.
   * This allows the agent to detect when a step goal is already achieved.
   */
  private async captureCurrentState(step: PlanStep, isRepair = false): Promise<string> {
    if (!this.workspace) return '';

    const description = step.objective || step.description || '';
    const filePaths = this.uniqueFilePaths([
      ...(step.expectedFiles ?? []),
      ...this.extractFilePathsFromDescription(description),
    ]);
    const symbols = this.extractSymbolsFromDescription(description);

    if (filePaths.length === 0) return '';

    const fileSummaries: string[] = [];
    const symbolFindings: string[] = [];
    const MAX_FILES = 4;
    const MAX_FILE_SIZE = 60000; // 60KB max per file

    for (const filePath of filePaths.slice(0, MAX_FILES)) {
      try {
        const exists = await this.workspace.exists(filePath);
        if (!exists) {
          fileSummaries.push(`- ${filePath}: does not exist yet`);
          continue;
        }
        const fileContent = await this.workspace.readFile(filePath);
        if (fileContent.length > MAX_FILE_SIZE) {
          fileSummaries.push(`- ${filePath}: exists (${fileContent.length} chars, too large to fully analyze)`);
          continue;
        }

        const lineCount = fileContent.split('\n').length;
        const imports = this.extractImports(fileContent);
        const definedSymbols = this.extractDefinedSymbols(fileContent);

        let summary = `- ${filePath} (${lineCount} lines)`;
        if (imports.length > 0) {
          const topImports = imports.slice(0, 6);
          summary += `\n  * Imports from: ${topImports.join(', ')}${imports.length > 6 ? ' (and ' + (imports.length - 6) + ' more)' : ''}`;
        }
        if (definedSymbols.length > 0) {
          const topSymbols = definedSymbols.slice(0, 10);
          summary += `\n  * Defines: ${topSymbols.join(', ')}${definedSymbols.length > 10 ? ' (and ' + (definedSymbols.length - 10) + ' more)' : ''}`;
        }
        fileSummaries.push(summary);

        // Check if any step-related symbols are already present in file
        for (const sym of symbols) {
          if (fileContent.includes(sym)) {
            symbolFindings.push(`"${sym}" is PRESENT in ${filePath}`);
          }
        }
      } catch (e: any) {
        fileSummaries.push(`- ${filePath}: unreadable (${e.message})`);
      }
    }

    if (fileSummaries.length === 0) return '';

    let prompt = '\n\n## CURRENT PROJECT STATE (before this step)\n';
    prompt += 'The following is the current state of files relevant to this step:\n';
    prompt += fileSummaries.join('\n');

    if (symbolFindings.length > 0) {
      prompt += '\n\n### Symbols mentioned in step that ALREADY EXIST in project:\n';
      // Deduplicate
      const uniqueFindings = Array.from(new Set(symbolFindings)).slice(0, 10);
      for (const finding of uniqueFindings) {
        prompt += `- ${finding}\n`;
      }
    }

    prompt += '\n### CRITICAL INSTRUCTION:\n';
    if (isRepair) {
      prompt += 'This is a VERIFICATION REPAIR. The original user task may already be visible in these files.\n';
      prompt += 'That does NOT mean the repair is complete. If an implicated file still throws or still\n';
      prompt += 'contains the failing behavior, you MUST edit that file with apply_patch or write_file.\n';
      prompt += 'Do NOT respond with STEP_ALREADY_COMPLETE because a footer, test id, or original file already matches the prompt.\n';
    } else {
      prompt += 'If the goal of this step is ALREADY ACHIEVED (the described change is already\n';
      prompt += 'present in the project as shown above), respond EXACTLY with:\n';
      prompt += '```\nSTEP_ALREADY_COMPLETE: [brief reason why the step is already done]\n```\n';
      prompt += 'Do NOT proceed with any tool calls if the step is already complete.\n';
      prompt += 'Example: "STEP_ALREADY_COMPLETE: formatDate is already imported in BookmarkCard.tsx"\n';
    }

    return prompt;
  }

  private uniqueFilePaths(paths: ReadonlyArray<string>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const file of paths) {
      const normalized = file.replace(/\\/g, '/').replace(/^\.?\//, '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  /**
   * E.1: Detect if agent's response indicates the step was already complete.
   */
  private detectCompletionResponse(content: string): { isComplete: boolean; reason?: string } {
    if (!content) return { isComplete: false };
    const trimmed = content.trim();
    // Match STEP_ALREADY_COMPLETE (case-insensitive, with optional code fences)
    const cleaned = trimmed.replace(/```/g, '').trim();
    const match = cleaned.match(/STEP_ALREADY_COMPLETE\s*:\s*(.+)/i);
    if (match) {
      return { isComplete: true, reason: match[1].trim().split('\n')[0].trim() };
    }
    return { isComplete: false };
  }

  /**
   * D.2: Validate that files referenced in step exist in workspace.
   * If a concrete file is required for read/inspect/modify but does not exist,
   * flags a fatal premise failure (TARGET_NOT_FOUND) instead of allowing silent substitution.
   */
  private async validateStepPremises(
    step: import('../../domain/execution-plan').PlanStep,
    sessionId: string,
    workspacePath?: string,
  ): Promise<{ missingFiles: string[]; fatalPremiseFailure: boolean; failureReason?: string }> {
    if (!this.workspace) return { missingFiles: [], fatalPremiseFailure: false };

    const expectedFilesFromPlanner = (step as any).expectedFiles as ReadonlyArray<string> | undefined;
    const filePathsFromDesc = this.extractFilePathsFromDescription(step.objective || step.description || '');

    const filePaths: string[] = expectedFilesFromPlanner && expectedFilesFromPlanner.length > 0
      ? [...expectedFilesFromPlanner]
      : filePathsFromDesc;

    if (filePaths.length === 0) return { missingFiles: [], fatalPremiseFailure: false };

    const grounded = await groundTargetPaths(this.workspace, filePaths, workspacePath);
    const missingFiles: string[] = [];

    for (const g of grounded) {
      if (g.kind === 'MISSING' || g.kind === 'OUT_OF_SCOPE') {
        missingFiles.push(g.rawPath);
      }
    }

    if (missingFiles.length > 0) {
      const stepType = step.type;
      const stepDesc = (step.objective || step.description || '').toLowerCase();
      const isCreate = stepDesc.includes('create file') || stepDesc.includes('new file') || stepDesc.includes('create_file') || stepDesc.includes('write initial');
      const isReadOrInspect =
        stepType === 'analysis' ||
        stepType === 'test' ||
        stepType === 'validation' ||
        stepDesc.startsWith('read ') ||
        stepDesc.startsWith('inspect ') ||
        stepDesc.includes('read file') ||
        stepDesc.includes('inspect file') ||
        (step.requiredTools && step.requiredTools.includes('read_file') && !step.requiredTools.includes('create_file'));

      const isConcreteTargetRequired = (expectedFilesFromPlanner && expectedFilesFromPlanner.length > 0) || isReadOrInspect;

      if (isConcreteTargetRequired && !isCreate) {
        ExecutionLogger.log('PREMISE', '-', '-',
          `⚠️ D.2 Premise failure: target file(s) referenced in step do not exist in workspace`,
          { stepId: step.id, missingFiles, fatal: true }
        );
        console.log(`   [Step] ⚠️  Premise failure: target file(s) not found: ${missingFiles.join(', ')}`);
        return {
          missingFiles,
          fatalPremiseFailure: true,
          failureReason: `TARGET_NOT_FOUND: The requested file "${missingFiles[0]}" was not found in the active workspace.`,
        };
      }

      ExecutionLogger.log('PREMISE', '-', '-',
        `⚠️ D.2 Premise warning: ${missingFiles.length} file(s) referenced in step do not exist`,
        { stepId: step.id, missingFiles, fatal: false }
      );
      console.log(`   [Step] ⚠️  Premise warning: file(s) not found: ${missingFiles.join(', ')}`);
    }

    return { missingFiles, fatalPremiseFailure: false };
  }


  /**
   * Capture a snapshot of all tracked files in workspace.
   * Returns Map<filePath, contentHash> for quick diffing.
   */
  private async captureWorkspaceSnapshot(): Promise<Map<string, string>> {
    const snapshot = new Map<string, string>();
    if (!this.workspace) return snapshot;

    try {
      const files = await this.workspace.listFiles('.');
      for (const file of files) {
        const normalized = file.replace(/\\/g, '/');
        if (normalized.includes('node_modules/') || normalized.includes('.ai/') ||
            normalized.includes('.next/') || normalized.includes('.git/') ||
            normalized.endsWith('.lock') || normalized.endsWith('.map')) {
          continue;
        }
        try {
          const content = await this.workspace.readFile(file);
          const hash = content.substring(0, 100) + ':' + content.length;
          snapshot.set(file, hash);
        } catch {
          // Skip unreadable files
        }
      }
    } catch (e: any) {
      // Fallback: return empty
    }

    return snapshot;
  }

  /**
   * Detect files that changed during step execution.
   */
  private async detectChangesDuringStep(
    sessionId: string,
    step: import('../../domain/execution-plan').PlanStep,
    preStepFiles: Map<string, string> | null
  ): Promise<string[]> {
    if (!this.workspace) return [];

    if (preStepFiles && preStepFiles.size > 0) {
      const changedFiles: string[] = [];
      const postStepFiles = await this.captureWorkspaceSnapshot();

      for (const [file, postHash] of postStepFiles) {
        const preHash = preStepFiles.get(file);
        if (preHash !== postHash) {
          changedFiles.push(file);
        }
      }

      for (const file of preStepFiles.keys()) {
        if (!postStepFiles.has(file)) {
          changedFiles.push(file);
        }
      }

      return changedFiles;
    }

    // Fallback: extract file paths from step description
    const filePathRegex = /\b(?:\.{0,2}\/[\w\-./]+|[\w\-./]+)\.(ts|tsx|js|jsx|json|md|css)\b/gi;
    const description = step.description || '';
    const matches = description.match(filePathRegex) || [];
    return matches.map(m => m.startsWith('./') ? m.substring(2) : m);
  }

  /**
   * Per-step commit: create a git commit for the completed step.
   */
  private async commitStep(
    sessionId: string,
    stepId: string,
    stepDescription: string,
    changedFiles: string[]
  ): Promise<string | null> {
    if (!this.gitManager || !this._commitMessageGenerator) {
      return null;
    }
    if (changedFiles.length === 0) {
      return null;
    }

    // PHASE-09 commit barrier: defer until acceptance after verification.
    if (this.deferCommitsUntilAcceptance) {
      this.pendingAcceptanceFiles.push(...changedFiles);
      ExecutionLogger.log('STEP', '-', '-', `✓ Step changes deferred until acceptance (${changedFiles.length} file(s))`, {
        stepId,
        changedFiles,
      });
      return null;
    }

    try {
      const commitMessage = this._commitMessageGenerator.generate({
        userRequest: stepDescription,
        changedFiles,
        patchReason: stepDescription,
        validationPassed: true,
        testsPassed: true,
      });

      const commitResult = await this.gitManager.commit({
        sessionId,
        message: commitMessage,
        changedFiles,
      });

      if (commitResult.success) {
        ExecutionLogger.log('STEP', '-', '-', `✓ Step committed: ${commitResult.commitHash?.substring(0, 7)}`);
        return commitResult.commitHash || null;
      } else {
        ExecutionLogger.log('STEP', '-', '-', `⚠ Step commit failed: ${commitResult.error}`);
        return null;
      }
    } catch (e: any) {
      ExecutionLogger.log('STEP', '-', '-', `⚠ Step commit error: ${e.message}`);
      return null;
    }
  }

  async executeSteps(
    sessionId: string,
    plan: ExecutionPlan,
    context: ExecutionContext,
    modelId?: string,
    providerId?: ProviderId,
  ): Promise<StepExecutionResult> {
    const results: StepResult[] = [];

    // D.3: Build type inventory once at start of execution
    let typeInventory: TypeInventory | null = null;
    let typeInventoryPrompt: string = '';
    if (this.typeInventoryBuilder) {
      try {
        typeInventory = await this.typeInventoryBuilder.build();
        typeInventoryPrompt = this.typeInventoryBuilder.formatForPrompt(typeInventory);
        if (typeInventoryPrompt) {
          ExecutionLogger.log('TYPE_INVENTORY', '-', '-',
            `Injecting ${typeInventory.types.length} types into agent context`);
        }
      } catch (e: any) {
        console.warn(`[StepEngine] Type inventory build failed (non-fatal): ${e.message}`);
      }
    }

    const startIndex = context.resumedFromCheckpoint ? context.currentStepIndex : 0;
    const previousStepResults: string[] = [];
    ExecutionLogger.log('STEP', '-', '-', `Executing plan: ${plan.steps.length} steps (from index ${startIndex})`);
    for (let i = startIndex; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      if (this.pipelineHooks?.beforeStep) {
        try {
          await this.pipelineHooks.beforeStep(step, { ...context, currentStepIndex: i });
        } catch (e: any) {
          console.warn(`[StepEngine] beforeStep hook failed: ${e.message}`);
        }
      }

      // Phase 3: bounded structural query before step execution (executor consumption)
      let structuralPrompt = '';
      let structuralRelatedFiles: ReadonlyArray<string> = [];
      if (this.knowledgeBridge) {
        try {
          const seedPaths = this.collectStepSeedPaths(step);
          const q = await this.knowledgeBridge.beforeStep({
            sessionId,
            step,
            seedPaths,
          });
          structuralPrompt = q.promptSection;
          structuralRelatedFiles = q.relatedFiles;
          if (structuralPrompt) {
            ExecutionLogger.log('KNOWLEDGE', '-', '-',
              `Phase5: injected bounded fused knowledge (${structuralRelatedFiles.length} related files)`,
              { stepId: step.id, relatedFiles: structuralRelatedFiles },
            );
          }
        } catch (e: any) {
          console.warn(`[StepEngine] Knowledge query beforeStep failed (non-fatal): ${e.message}`);
        }
      }

      const governor = this.executionGovernor;
      const healthProvider = this.runtimeHealthProvider;
      if (governor && healthProvider) {
        try {
          const health = await healthProvider.collect();
          const decision = governor.evaluate(health);
          if (decision.action === 'pause') {
            await this.sessionManager.pauseSession(sessionId, decision.reason);
            const policy = governor.getPolicy();
            await new Promise(resolve => setTimeout(resolve, policy.pauseDurationMs));
            await this.sessionManager.resumeSession(sessionId);
          }
        } catch (e: any) {
          console.warn(`[StepEngine] Governor check failed (non-fatal): ${e.message}`);
        }
      }

      await this.sessionManager.recordStepStarted(sessionId, step.id, step.description);

      // The ledger accumulates across the whole run, so a step's own mutations
      // are the ones recorded after this mark.
      const mutationsBeforeStep = this.peekMutationCount();

      // Per-step commit: Capture pre-step file state for commit diff
      let preStepFiles: Map<string, string> | null = null;
      if (this.gitManager && this.workspace) {
        try {
          preStepFiles = await this.captureWorkspaceSnapshot();
        } catch (e: any) {
          ExecutionLogger.log('STEP', '-', '-', `⚠ Pre-step snapshot failed (non-fatal): ${e.message}`);
        }
      }
      ExecutionLogger.log('STEP', '-', '-', `Step ${i + 1}/${plan.steps.length}: ${step.description?.substring(0, 60)}`);

      // D.2: Premise validation — check file existence before executing
      try {
        const premiseCheck = await this.validateStepPremises(step, sessionId, context.workspacePath);
        if (premiseCheck.fatalPremiseFailure) {
          throw new Error(premiseCheck.failureReason || `TARGET_NOT_FOUND: The requested file "${premiseCheck.missingFiles[0]}" was not found in the active workspace.`);
        }
      } catch (e: any) {
        if (e.message?.startsWith('TARGET_NOT_FOUND')) {
          throw e;
        }
        console.warn(`[StepEngine] Premise validation failed (non-fatal): ${e.message}`);
      }

      // E.1: Capture current project state for completion awareness
      const isRepair = isRepairContext(context);
      let currentStatePrompt = '';
      try {
        currentStatePrompt = await this.captureCurrentState(step, isRepair);
        if (currentStatePrompt) {
          ExecutionLogger.log('STEP', '-', '-',
            `E.1: Injected current state into step prompt (${currentStatePrompt.length} chars)`,
            { stepId: step.id }
          );
        }
      } catch (e: any) {
        console.warn(`[StepEngine] Current state capture failed (non-fatal): ${e.message}`);
      }

      // Audit: step_started (R4.23)
      if (this.auditService) {
        try {
          await this.auditService.record({ executionId: context.executionId ?? sessionId, sessionId, eventType: 'step_started', stepId: step.id, status: 'started' });
        } catch (e: any) { console.warn(`[StepEngine] Audit failed (non-fatal): ${e.message}`); }
      }

      try {
        // Execute step via TaskExecutor (real execution, not just recording)
        if (this.taskExecutor && this.toolDefinitions) {
          // E.3: Build effective expectedFiles (from planner OR extracted from description)
          const expectedFilesFromPlanner = (step as any).expectedFiles as ReadonlyArray<string> | undefined;
          const expectedFilesFromDesc = this.extractFilePathsFromDescription(step.objective || step.description || '');
          const effectiveExpectedFiles: ReadonlyArray<string> =
            expectedFilesFromPlanner && expectedFilesFromPlanner.length > 0
              ? expectedFilesFromPlanner
              : expectedFilesFromDesc;

          // E.3: Store scope in session so ApplyPatchTool can read it
          if (effectiveExpectedFiles.length > 0) {
            this.sessionManager.setExpectedFiles(sessionId, effectiveExpectedFiles);
            // F.7: Log E.3 activation for observability
            ExecutionLogger.log('STEP', '-', '-',
              `E.3: Injected scope restriction (CRITICAL) — ${effectiveExpectedFiles.length} file(s): ${effectiveExpectedFiles.join(', ')}`,
              { expectedFiles: effectiveExpectedFiles, source: expectedFilesFromPlanner && expectedFilesFromPlanner.length > 0 ? 'planner' : 'description' }
            );
          } else {
            this.sessionManager.clearExpectedFiles(sessionId);
            ExecutionLogger.log('STEP', '-', '-',
              'E.3: No expectedFiles — scope restriction not applied',
              { reason: 'no files in planner or description' }
            );
          }

          // R2.10: markers come from literal forms in the task text (a JSX
          // comment, a data-testid), never from an interpretation of prose.
          const expectedMarkers = extractExpectedChangeMarkers(
            [step.objective, step.description, plan.objective].filter(Boolean).join('\n'),
          );
          this.sessionManager.setExpectedChangeMarkers?.(sessionId, expectedMarkers);
          if (expectedMarkers.length > 0) {
            ExecutionLogger.log('MUTATION', '-', '-',
              `R2.10: expected change marker(s) declared: ${expectedMarkers.join(', ')}`,
              { stepId: step.id, expectedMarkers },
            );
          }

          // E.3: Enhanced scope guidance — STRICT language
          const scopeGuidance = effectiveExpectedFiles.length > 0
            ? `\n\n## SCOPE RESTRICTION (CRITICAL)\nYou are ONLY ALLOWED to modify/create/delete the following files in this step:\n${effectiveExpectedFiles.map(f => '- ' + f).join('\n')}\n\nIf you MUST modify another file, your patch 'reason' field MUST include a justification keyword: "required", "helper", "dependency", "necessary", or "needed".\nOtherwise the patch WILL BE REJECTED with an error.\n\nDo NOT modify config files (package.json, tsconfig.json, .env, etc.) unless explicitly required by the task description.`
            : '';

          const repairRules = isRepair
            ? `\n\n## VERIFICATION REPAIR (CRITICAL)
Verification rejected this product. This is NOT a continuation of the original task.
The original task being already implemented does NOT mean this repair is complete.
Do NOT respond with STEP_ALREADY_COMPLETE because a footer, test id, or original file already matches the user prompt.
You MUST modify the implicated files listed in SCOPE RESTRICTION so the verification defect is gone.
If an implicated file still throws or still contains the failing behavior, edit that file with apply_patch or write_file.
Do NOT delete previously satisfied acceptance markers (existing data-testid or exact text) unless the failure contract names that marker as the defect.`
            : '';

          const acceptanceRules = context.acceptanceContract
            ? `\n\n## ACCEPTANCE CONTRACT (IMMUTABLE)
${formatAcceptanceContract(context.acceptanceContract)}
Every required data-testid and exact visible text must be present when this step finishes.
If one required marker already exists, you still must add any that are missing. Do not remove existing required markers.`
            : '';

          let repairNudge = '';
          const stepRole: Role = {
            getName: () => 'Step Agent',
            getConfig: () => ({
              systemPrompt: `You are an AI software engineer. Execute ONLY this specific step: "${step.description}". Use tools as needed. When done, respond with a brief text summary WITHOUT any tool calls. Do NOT repeat tool calls.${repairRules}${acceptanceRules}${repairNudge}${typeInventoryPrompt}${scopeGuidance}${currentStatePrompt}`
            })
          };

          ExecutionLogger.log('STEP', 'Step Agent', this.modelId ?? '-', `Executing step: ${step.description?.substring(0, 80)}`);

          // E.1: Captures last agent response to detect STEP_ALREADY_COMPLETE
          let lastAgentResponseContent = '';

          let taskNudge = '';
          const executeTask = async (model: string, provider: ProviderId) => {
            const structureHint = context.projectStructure
              ? `\n\n${context.projectStructure}`
              : '';
            const contractHint = context.acceptanceContract
              ? '\n\n' + formatAcceptanceContract(context.acceptanceContract)
              : '';
            const structuralHint = structuralPrompt
              ? `\n\n${structuralPrompt}\n\nPrefer reading these graph-related files first (do not re-explore the whole repository):\n${structuralRelatedFiles.map(f => `- ${f}`).join('\n')}`
              : '';
            const taskIntent = (previousStepResults.length > 0
              ? `Previous steps completed:\n${previousStepResults.join('\n')}\n\nCurrent step: ${step.objective || step.description}`
              : (step.objective || step.description)) + contractHint + taskNudge + structureHint + structuralHint;

            const response = await this.taskExecutor!.execute({
              sessionId,
              contract: context.contract,  // Stage 7: Pass contract policy
              executionMode: context.executionMode ?? 'STANDARD',
              context: {
                taskIntent,
                rules: [],
                knowledge: [],
                memories: [],
                files: []
              },
              role: stepRole,
              providerId: provider,
              model: model,
              tools: this.toolDefinitions!,
              history: []
            });
            lastAgentResponseContent = response.content || '';
          };

          // C.2: Silent failure detection
          let patchFailuresInThisStep = 0;
          try {
            const currentSession = await this.sessionManager.getSession(sessionId);
            if (currentSession && currentSession.events) {
              patchFailuresInThisStep = currentSession.events.filter(
                (e: any) =>
                  e.type === 'TOOL_EXECUTED' &&
                  e.metadata?.toolName === 'apply_patch' &&
                  e.metadata?.success === false
              ).length;

              if (patchFailuresInThisStep > 0) {
                ExecutionLogger.log('STEP', '-', '-',
                  `⚠️ C.2 Silent failure detected: ${patchFailuresInThisStep} apply_patch failure(s)`,
                  { stepId: step.id, patchFailures: patchFailuresInThisStep }
                );
              }
            }
          } catch (e: any) {
            console.warn(`[StepEngine] Silent failure detection failed (non-fatal): ${e.message}`);
          }

          if (this.selfHealingExecutor && this.selfHealingConfig) {
            const healingResult = await this.selfHealingExecutor.executeWithHealing(
              sessionId,
              { id: step.id, title: step.description, description: step.description } as any,
              this.selfHealingConfig,
              modelId || this.modelId || 'gpt-oss:20b-cloud',
              providerId || this.providerId || KnownProviders.OLLAMA,
              executeTask,
            );
            
            if (!healingResult.success) {
              throw new Error(healingResult.finalError || 'Task failed after all healing attempts');
            }

            // C.2: Check if patches failed despite agent claiming success
            if (patchFailuresInThisStep > 0) {
              ExecutionLogger.log('STEP', '-', '-',
                `⚠️ Silent failure masking: ${patchFailuresInThisStep} patch(es) failed — marking step as failed`,
                { stepId: step.id, patchFailures: patchFailuresInThisStep }
              );
              throw new Error(`SILENT_FAILURE_MASKING: ${patchFailuresInThisStep} apply_patch call(s) failed`);
            }
            
            // B.2: Passive tool failure detection (with await for async getSession)
            try {
              const sessionGetter = this.sessionManager.getSession?.bind(this.sessionManager);
              if (sessionGetter) {
                const currentSession = await sessionGetter(sessionId);
                if (currentSession) {
                  const toolFailures = currentSession.events.filter(
                    (e: any) => e.type === 'TOOL_EXECUTED' && 
                               e.metadata?.success === false
                  ).length;
                  const toolSuccesses = currentSession.events.filter(
                    (e: any) => e.type === 'TOOL_EXECUTED' && 
                               e.metadata?.success === true
                  ).length;
                  if (toolFailures > 0) {
                    ExecutionLogger.log('STEP', '-', '-',
                      `⚠️ Tool failures detected: ${toolFailures} failed / ${toolSuccesses} succeeded (session total)`,
                      { stepId: step.id, toolFailures, toolSuccesses }
                  );
                  }
                }
              }
            } catch (e: any) {
              console.warn(`[StepEngine] Tool failure detection failed (non-fatal): ${e.message}`);
            }
          } else {
            await executeTask(
              modelId || this.modelId || 'gpt-oss:20b-cloud',
              providerId || this.providerId || KnownProviders.OLLAMA
            );
          }

          // R2.19: a step whose every guarded mutation was refused did not do
          // its job, no matter what the agent says afterwards. This runs before
          // completion detection so an agent cannot escape a refused write by
          // reporting STEP_ALREADY_COMPLETE.
          const stepMutations = this.mutationsSince(mutationsBeforeStep);
          if (stepMutations.length > 0 && !stepMutations.some(result => result.status === 'APPLIED')) {
            const codes = [...new Set(stepMutations.flatMap(r => r.findings.map(f => f.code)))];
            const paths = [...new Set(stepMutations.map(r => r.path))];
            ExecutionLogger.log('MUTATION', '-', '-',
              `R2: every mutation in this step was refused (${stepMutations.length} attempt(s))`,
              { stepId: step.id, codes, paths });
            throw new Error(
              `MUTATION_NOT_APPLIED: all ${stepMutations.length} file mutation(s) in this step were refused `
              + `by the executor mutation safety policy [${codes.join(', ')}]. `
              + `Files: ${paths.join(', ')}`,
            );
          }

          // E.1: Detect if agent reported step was already complete
          const completion = this.detectCompletionResponse(lastAgentResponseContent);
          if (isRepair && completion.isComplete) {
            ExecutionLogger.log('STEP', '-', '-',
              'E.1: STEP_ALREADY_COMPLETE ignored during verification repair; requiring implicated-file edit',
              { stepId: step.id, skippedReason: completion.reason },
            );
            taskNudge = '\nYour previous response claimed the step was already complete. That is invalid for a verification repair. Use apply_patch or write_file on the implicated files now. Do not remove previously satisfied acceptance markers.\n';
            await executeTask(
              modelId || this.modelId || 'gpt-oss:20b-cloud',
              providerId || this.providerId || KnownProviders.OLLAMA,
            );
          } else if (completion.isComplete) {
            const stillMissing = await this.acceptanceStillUnsatisfied(context, effectiveExpectedFiles);
            if (stillMissing) {
              ExecutionLogger.log('STEP', '-', '-',
                'E.1: STEP_ALREADY_COMPLETE ignored; acceptance contract still unsatisfied',
                { stepId: step.id, skippedReason: completion.reason },
              );
              taskNudge = '\nRequired acceptance items are still missing. Add every required data-testid and exact text. Do not remove existing markers.\n';
              await executeTask(
                modelId || this.modelId || 'gpt-oss:20b-cloud',
                providerId || this.providerId || KnownProviders.OLLAMA,
              );
            } else {
              const skipReason = completion.reason || 'step already done';
              ExecutionLogger.log('STEP', '-', '-',
                `E.1: ⏭️  Step skipped (already complete): ${skipReason}`,
                { stepId: step.id }
              );
              await this.sessionManager.recordStepCompleted(
                sessionId, step.id,
                `STEP_ALREADY_COMPLETE: ${skipReason} (no action taken)`
              );
              previousStepResults.push(`Step ${i + 1} [${step.id}]: ${step.description} → already complete (skipped)`);
              results.push(Object.freeze({
                stepId: step.id,
                success: true,
                completedAt: new Date().toISOString(),
              }));
              continue;
            }
          }
        }

        await this.sessionManager.recordStepCompleted(sessionId, step.id, step.expectedOutcome);

        // Per-step commit: detect changed files and commit
        try {
          const detected = await this.detectChangesDuringStep(sessionId, step, preStepFiles);
          // R2.27: rollback already restores the bytes, so a rejected mutation
          // normally shows no change at all. This is the belt-and-braces half:
          // a path whose last mutation was not APPLIED is never committed.
          const unsafePaths = new Set(
            this.taskExecutor?.peekMutationLedger?.().results
              .filter(result => result.status !== 'APPLIED')
              .map(result => result.path.replace(/\\/g, '/')) ?? [],
          );
          const changedFiles = detected.filter(file => !unsafePaths.has(file.replace(/\\/g, '/')));
          if (unsafePaths.size > 0 && changedFiles.length !== detected.length) {
            ExecutionLogger.log('MUTATION', '-', '-',
              'R2.27: excluded unvalidated mutation target(s) from the step commit',
              { stepId: step.id, excluded: detected.filter(f => unsafePaths.has(f.replace(/\\/g, '/'))) },
            );
          }
          if (changedFiles.length > 0) {
            await this.commitStep(sessionId, step.id, step.description || step.id, changedFiles);
          }
        } catch (e: any) {
          ExecutionLogger.log('STEP', '-', '-', `⚠ Per-step commit failed (non-fatal): ${e.message}`);
        }
        previousStepResults.push(`Step ${i + 1} [${step.id}]: ${step.description} → completed successfully`);
        results.push(Object.freeze({
          stepId: step.id,
          success: true,
          completedAt: new Date().toISOString(),
        }));

        // Audit: step_completed (R4.23)
        if (this.auditService) {
          try {
            await this.auditService.record({ executionId: context.executionId ?? sessionId, sessionId, eventType: 'step_completed', stepId: step.id, status: 'completed' });
          } catch (e: any) { console.warn(`[StepEngine] Audit failed (non-fatal): ${e.message}`); }
        }

        // Phase 3: Knowledge sync AFTER mutations, BEFORE checkpoint (fail-open)
        await this.syncKnowledgeAfterStep(sessionId, step.id, 'success', mutationsBeforeStep);

        // Checkpoint after successful step (R4.19)
        if (this.resumeEngine) {
          try {
            this.knowledgeBridge?.markCheckpoint(sessionId, step.id);
            const execId = context.executionId ?? sessionId;
            const completedIds = results.filter(r => r.success).map(r => r.stepId);
            const isLast = i === plan.steps.length - 1;
            const cp = this.resumeEngine.createCheckpoint(execId, sessionId, plan, i + 1, completedIds);
            const finalCp = isLast
              ? Object.freeze({ ...cp, status: 'completed' as const, updatedAt: new Date().toISOString() })
              : cp;
            await this.resumeEngine.saveCheckpoint(finalCp);
            // Audit: checkpoint_created (R4.23)
            if (this.auditService) {
              try {
                await this.auditService.record({ executionId: execId, sessionId, eventType: 'checkpoint_created', stepId: step.id, status: isLast ? 'completed' : 'active' });
              } catch (e: any) { console.warn(`[StepEngine] Audit failed (non-fatal): ${e.message}`); }
            }
          } catch (e: any) {
            console.warn(`[StepEngine] Checkpoint save failed (non-fatal): ${e.message}`);
          }
        }
      } catch (error: any) {
        await this.sessionManager.recordStepFailed(sessionId, step.id, error.message);
        results.push(Object.freeze({
          stepId: step.id,
          success: false,
          error: error.message,
          completedAt: new Date().toISOString(),
        }));

        // Audit: step_failed (R4.23)
        if (this.auditService) {
          try {
            await this.auditService.record({ executionId: context.executionId ?? sessionId, sessionId, eventType: 'step_failed', stepId: step.id, status: 'failed', metadata: { error: error.message } });
          } catch (e: any) { console.warn(`[StepEngine] Audit failed (non-fatal): ${e.message}`); }
        }

        // Phase 3: sync remaining filesystem mutations even when step failed
        await this.syncKnowledgeAfterStep(sessionId, step.id, 'failed', mutationsBeforeStep);

        // Checkpoint after failed step (R4.19)
        if (this.resumeEngine) {
          try {
            this.knowledgeBridge?.markCheckpoint(sessionId, step.id);
            const execId = context.executionId ?? sessionId;
            const completedIds = results.filter(r => r.success).map(r => r.stepId);
            const cp = this.resumeEngine.createCheckpoint(execId, sessionId, plan, i, completedIds);
            await this.resumeEngine.saveCheckpoint(cp);
          } catch (e: any) {
            console.warn(`[StepEngine] Failed checkpoint save failed (non-fatal): ${e.message}`);
          }
        }
      }

      try {
        // Per-step reflection removed: produced false positives because
        // session.status was 'executing', not 'completed'. Reflection now
        // only runs at workflow level (DefaultWorkflowOrchestrator).
      } catch (e: any) {
        console.warn(`[StepEngine] Session retrieval failed: ${e.message}`);
      }

      if (this.pipelineHooks?.afterStep) {
        try {
          await this.pipelineHooks.afterStep(step, { ...context, currentStepIndex: i });
        } catch (e: any) {
          console.warn(`[StepEngine] afterStep hook failed: ${e.message}`);
        }
      }
    }

    return Object.freeze({
      success: results.every(r => r.success),
      results: Object.freeze(results),
      completedSteps: results.filter(r => r.success).length,
      totalSteps: plan.steps.length,
    });
  }

  private collectStepSeedPaths(step: PlanStep): string[] {
    const fromExpected = ((step as { expectedFiles?: ReadonlyArray<string> }).expectedFiles ?? [])
      .map(p => p.replace(/\\/g, '/'));
    const fromDesc = this.extractFilePathsFromDescription(
      [step.objective, step.description].filter(Boolean).join('\n'),
    );
    return [...new Set([...fromExpected, ...fromDesc])].sort();
  }

  private async syncKnowledgeAfterStep(
    sessionId: string,
    stepId: string,
    outcome: 'success' | 'failed',
    mutationsBeforeStep: number,
  ): Promise<void> {
    if (!this.knowledgeBridge) return;
    try {
      const stepMutations = this.mutationsSince(mutationsBeforeStep);
      const ledger: MutationLedger = {
        ...EMPTY_MUTATION_LEDGER,
        mutationAttempts: stepMutations.length,
        successfulMutations: stepMutations.filter(r => r.status === 'APPLIED').length,
        results: Object.freeze(stepMutations),
      };
      const result = await this.knowledgeBridge.afterStepSync({
        sessionId,
        stepId,
        ledger,
        outcome,
      });
      if (result) {
        ExecutionLogger.log('KNOWLEDGE', '-', '-',
          `Phase3: knowledge sync ${result.skipped ? 'skipped' : (result.ok ? 'ok' : 'failed')}`,
          {
            stepId,
            analyzed: result.analyzedFileCount,
            affected: result.affectedFileCount,
            stale: result.stale,
            fallbackUsed: result.fallbackUsed,
          },
        );
      }
    } catch (e: any) {
      console.warn(`[StepEngine] Knowledge sync failed (non-fatal): ${e.message}`);
    }
  }

  private async acceptanceStillUnsatisfied(
    context: ExecutionContext,
    files: ReadonlyArray<string>,
  ): Promise<boolean> {
    if (!context.acceptanceContract || !this.workspace) return false;
    if (files.length === 0) return true;
    const contents: Record<string, string> = {};
    for (const file of files) {
      try {
        contents[file] = await this.workspace.readFile(file);
      } catch {
        contents[file] = '';
      }
    }
    return contractHasUnsatisfiedObservables(contents, context.acceptanceContract);
  }
}
