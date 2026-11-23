import { TaskExecutor } from '../../execution/task-executor';
import { Workspace } from '../../../contracts/workspace';
import { KnowledgeRole } from '../knowledge-role';
import { ToolDefinition } from '../../../contracts/provider';
import { KnownProviders } from '../../../domain/provider-id';
import { extractJsonFromResponse } from '../utils/json-validator';
import { ARCHITECTURAL_MAP_PROMPT } from '../prompts/architectural-map-prompt';
import { ARCH_CHUNK_PROMPT } from '../prompts/arch-chunk-prompt';
import { ARCHITECTURAL_INCREMENTAL_PROMPT } from '../prompts/architectural-incremental-prompt';
import { ChangeDetector, FileChange, ModuleChanges } from '../utils/change-detector';
import { RetryExecutor } from '../utils/retry-executor';

export interface ArchitecturalMapFile {
  path: string;
  hash?: string;
  type: string;
  responsibility: string;
  architectural_role: string;
  interacts_with: string[];
}

export interface ArchitecturalMapModule {
  module_name: string;
  directory_path: string;
  purpose: string;
  files: ArchitecturalMapFile[];
}

export interface ArchitecturalMap {
  meta: {
    project_name: string;
    architecture_style: string;
    generated_at: string;
    generation_mode?: 'full' | 'incremental' | 'chunked';
  };
  system_overview: {
    description: string;
    core_modules: string[];
  };
  module_map: ArchitecturalMapModule[];
}

export class ArchitecturalMapStage {
  private retryExecutor = new RetryExecutor();

  constructor(
    private readonly taskExecutor: TaskExecutor,
    private readonly tools: ReadonlyArray<ToolDefinition>,
    private readonly workspace: Workspace,
    private readonly model: string = 'qwen3-32b'
  ) {}

  async execute(existing?: ArchitecturalMap): Promise<ArchitecturalMap> {
    if (existing) {
      return await this.executeIncremental(existing);
    }
    
    // Try full generation first, fall back to chunked if iteration limit hit
    try {
      return await this.executeFull();
    } catch (error: any) {
      if (error.message?.includes('maximum iterations')) {
        console.log(`   [Stage 1] ⚠️  Full generation hit iteration limit, falling back to chunked approach`);
        return await this.executeChunked();
      }
      throw error;
    }
  }

  private async executeFull(): Promise<ArchitecturalMap> {
    console.log(`   [Stage 1] 🔄 Full generation (first run)...`);
    const startTime = Date.now();

    let attemptNumber = 0;

    const result = await this.retryExecutor.executeWithRetry(async () => {
      attemptNumber++;
      
      const reinforcement = attemptNumber > 1
        ? `\n\nCRITICAL: You MUST output ONLY valid JSON immediately. Stop exploring and generate JSON NOW.`
        : '';

      const response = await this.taskExecutor.execute({
        context: {
          taskIntent: `${ARCHITECTURAL_MAP_PROMPT}${reinforcement}`,
          rules: [],
          knowledge: [],
          memories: [],
          files: []
        },
        role: new KnowledgeRole(),
        providerId: KnownProviders.OLLAMA,
        model: this.model,
        tools: this.tools,
        history: []
      });

      const content = response.content || '';
      const parsed = extractJsonFromResponse<ArchitecturalMap>(content);

      if (!parsed) {
        if (attemptNumber < 3) {
          await this.retryExecutor.saveDebugLog(
            'architectural_map',
            attemptNumber,
            content,
            new Error('JSON parse failed')
          );
        }
        throw new Error('Failed to parse architectural map JSON');
      }

      return parsed;
    }, {
      maxAttempts: 3,
      backoffMs: 2000,
      shouldRetry: (error) => RetryExecutor.isTransientError(error) && !error.message?.includes('maximum iterations'),
      onRetry: (attempt, error, delay) => {
        console.log(`   [Stage 1] ⚠️  ${error.message} (attempt ${attempt}/3), retrying in ${Math.round(delay)}ms...`);
      }
    });

    const duration = Date.now() - startTime;
    console.log(`   [Stage 1] ⏱️  ${Math.round(duration/1000)}s, ${attemptNumber} attempt${attemptNumber > 1 ? 's' : ''}`);

    const detector = new ChangeDetector(this.workspace);
    const enriched = await this.enrichWithHashes(result, detector);
    enriched.meta.generation_mode = 'full';

    console.log(`   [Stage 1] ✅ Full: ${enriched.module_map?.length || 0} modules`);
    return enriched;
  }

  private async executeChunked(): Promise<ArchitecturalMap> {
    console.log(`   [Stage 1] 🔄 Chunked generation (fallback mode)...`);
    const startTime = Date.now();

    const modules = await this.discoverTopLevelModules();
    console.log(`   [Stage 1] 📦 Found ${modules.length} top-level modules to analyze`);

    const moduleResults: ArchitecturalMapModule[] = [];

    for (let i = 0; i < modules.length; i++) {
      const module = modules[i];
      console.log(`   [Module ${i + 1}/${modules.length}] ${module.name}...`);

      try {
        const moduleResult = await this.processModule(module);
        if (moduleResult) {
          moduleResults.push(moduleResult);
          console.log(`   [Module ${i + 1}/${modules.length}] ✅ ${moduleResult.files.length} files`);
        }
      } catch (error: any) {
        console.log(`   [Module ${i + 1}/${modules.length}] ❌ Failed: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   [Stage 1] ⏱️  Total: ${Math.round(duration/1000)}s`);

    const result: ArchitecturalMap = {
      meta: {
        project_name: 'project',
        architecture_style: 'Modular Architecture',
        generated_at: new Date().toISOString().split('T')[0],
        generation_mode: 'chunked'
      },
      system_overview: {
        description: `Project with ${moduleResults.length} main modules`,
        core_modules: moduleResults.map(m => m.module_name)
      },
      module_map: moduleResults
    };

    const detector = new ChangeDetector(this.workspace);
    const enriched = await this.enrichWithHashes(result, detector);

    console.log(`   [Stage 1] ✅ Chunked: ${moduleResults.length} modules`);
    return enriched;
  }

  private async discoverTopLevelModules(): Promise<Array<{ name: string; path: string }>> {
    // Dynamically discover top-level code directories
    let basePath = 'src';
    let entries: string[] = [];
    try {
      const rootEntries = await this.workspace.listEntries('.');
      const rootDirs = rootEntries.filter(e => e.endsWith('/')).map(e => e.slice(0, -1));
      const preferredRoots = ['src', 'app', 'lib', 'components', 'pages'];
      const found = preferredRoots.filter(r => rootDirs.includes(r));
      if (found.includes('src')) {
        basePath = 'src';
        entries = await this.workspace.listEntries('src');
      } else {
        for (const root of found) {
          const sub = await this.workspace.listEntries(root).catch(() => []);
          entries.push(...sub.map(e => root + '/' + e));
        }
        basePath = '';
      }
    } catch {
      entries = [];
    }
    const modules: Array<{ name: string; path: string }> = [];

    for (const entry of entries) {
      if (entry.endsWith('/')) {
        const dirName = entry.slice(0, -1);
        if (['__tests__', 'tests', 'node_modules'].includes(dirName)) continue;
        
        modules.push({
          name: dirName.charAt(0).toUpperCase() + dirName.slice(1),
          path: basePath ? `${basePath}/${dirName}` : dirName
        });
      }
    }

    return modules;
  }

  private async processModule(module: { name: string; path: string }): Promise<ArchitecturalMapModule | null> {
    const promptContent = ARCH_CHUNK_PROMPT
      .replace(/__MODULE_NAME__/g, module.name)
      .replace(/__MODULE_DIRECTORY__/g, module.path);

    const response = await this.taskExecutor.execute({
      context: {
        taskIntent: promptContent,
        rules: [],
        knowledge: [],
        memories: [],
        files: []
      },
      role: new KnowledgeRole(),
      providerId: KnownProviders.OLLAMA,
      model: this.model,
      tools: this.tools,
      history: []
    });

    const content = response.content || '';
    const parsed = extractJsonFromResponse<{ module: ArchitecturalMapModule }>(content);

    return parsed?.module || null;
  }

  private async executeIncremental(existing: ArchitecturalMap): Promise<ArchitecturalMap> {
    const existingModuleCount = existing.module_map?.length || 0;
    console.log(`   [Stage 1] 🔄 Incremental update (existing: ${existingModuleCount} modules)...`);

    if (existingModuleCount < 3) {
      console.log(`   [Stage 1] ⚠️  Existing map too sparse (${existingModuleCount} modules), rebuilding fully`);
      return await this.executeFull();
    }

    const startTime = Date.now();

    const detector = new ChangeDetector(this.workspace);
    const baselineFiles = existing.module_map.flatMap(m => m.files.map(f => ({ path: f.path, hash: f.hash || '' })));
    const currentFiles = await detector.listAllSourceFiles();
    const changes = await detector.detectChanges(baselineFiles, currentFiles);

    if (changes.length === 0) {
      console.log(`   [Stage 1] ⚡ No changes detected, skipping (${Math.round((Date.now()-startTime)/1000)}s)`);
      return existing;
    }

    console.log(`   [Stage 1] 📝 ${changes.length} changes detected`);

    const moduleChanges = detector.groupChangesByModule(changes);
    const changesSummary = this.formatChangesSummary(changes, moduleChanges);

    const existingJson = JSON.stringify(existing, null, 2);
    const promptContent = ARCHITECTURAL_INCREMENTAL_PROMPT
      .replace('__EXISTING_MAP_JSON__', existingJson)
      .replace('__CHANGES_SUMMARY__', changesSummary);

    let attemptNumber = 0;

    const parsed = await this.retryExecutor.executeWithRetry(async () => {
      attemptNumber++;

      const response = await this.taskExecutor.execute({
        context: {
          taskIntent: promptContent,
          rules: [],
          knowledge: [],
          memories: [],
          files: []
        },
        role: new KnowledgeRole(),
        providerId: KnownProviders.OLLAMA,
        model: this.model,
        tools: this.tools,
        history: []
      });

      const content = response.content || '';
      const result = extractJsonFromResponse<ArchitecturalMap>(content);

      if (!result) {
        if (attemptNumber < 3) {
          await this.retryExecutor.saveDebugLog(
            'architectural_map_incremental',
            attemptNumber,
            content,
            new Error('JSON parse failed')
          );
        }
        throw new Error('Failed to parse architectural map JSON');
      }

      return result;
    }, {
      maxAttempts: 3,
      backoffMs: 2000,
      shouldRetry: (error) => RetryExecutor.isTransientError(error),
      onRetry: (attempt, error, delay) => {
        console.log(`   [Stage 1] ⚠️  ${error.message} (attempt ${attempt}/3), retrying in ${Math.round(delay)}ms...`);
      }
    });

    const duration = Date.now() - startTime;
    console.log(`   [Stage 1] ⏱️  ${Math.round(duration/1000)}s, ${attemptNumber} attempt${attemptNumber > 1 ? 's' : ''}`);

    const enriched = await this.enrichWithHashes(parsed, detector);
    enriched.meta.generation_mode = 'incremental';
    enriched.meta.generated_at = new Date().toISOString().split('T')[0];

    console.log(`   [Stage 1] ✅ Incremental: ${enriched.module_map?.length || 0} modules, ${changes.length} changes`);
    return enriched;
  }

  private async enrichWithHashes(map: ArchitecturalMap, detector: ChangeDetector): Promise<ArchitecturalMap> {
    for (const module of map.module_map || []) {
      for (const file of module.files) {
        if (!file.hash) {
          file.hash = await detector.hashFile(file.path);
        }
      }
    }
    return map;
  }

  private formatChangesSummary(changes: FileChange[], moduleChanges: ModuleChanges[]): string {
    let summary = `Total changes: ${changes.length}\n\n`;
    summary += `Added: ${changes.filter(c => c.type === 'added').length}\n`;
    summary += `Modified: ${changes.filter(c => c.type === 'modified').length}\n`;
    summary += `Deleted: ${changes.filter(c => c.type === 'deleted').length}\n\n`;

    summary += 'Affected modules:\n';
    for (const mc of moduleChanges) {
      summary += `- ${mc.moduleName}: ${mc.changes.length} changes\n`;
      for (const change of mc.changes.slice(0, 5)) {
        summary += `  • [${change.type}] ${change.path}\n`;
      }
      if (mc.changes.length > 5) {
        summary += `  • ... and ${mc.changes.length - 5} more\n`;
      }
    }

    return summary;
  }
}
