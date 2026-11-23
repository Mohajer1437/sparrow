import { TaskExecutor } from '../../execution/task-executor';
import { Workspace } from '../../../contracts/workspace';
import { KnowledgeRole } from '../knowledge-role';
import { ToolDefinition } from '../../../contracts/provider';
import { KnownProviders } from '../../../domain/provider-id';
import { extractJsonFromResponse } from '../utils/json-validator';
import { CODEBASE_INCREMENTAL_PROMPT } from '../prompts/codebase-incremental-prompt';
import { ChunkManager, DEFAULT_CHUNKS, ChunkResult, FailedChunk, ChunkDefinition } from '../utils/chunk-manager';
import { ChangeDetector, FileChange } from '../utils/change-detector';

export interface CodebaseMapFile {
  path: string;
  hash?: string;
  role: string;
  functions: Array<{
    name: string;
    signature: string;
    purpose: string;
    calls: string[];
    called_by: string[];
  }>;
}

export interface CodebaseMapContext {
  context_name: string;
  tags: string[];
  description: string;
  dependencies: string[];
  files: CodebaseMapFile[];
}

export interface CodebaseMap {
  meta: {
    project_name: string;
    map_version: string;
    generated_at: string;
    total_contexts: number;
    generation_mode?: 'full' | 'chunked' | 'incremental';
    total_chunks?: number;
    successful_chunks?: number;
    failed_chunks?: number;
  };
  contexts: CodebaseMapContext[];
}

export class CodebaseMapStage {
  constructor(
    private readonly taskExecutor: TaskExecutor,
    private readonly tools: ReadonlyArray<ToolDefinition>,
    private readonly workspace: Workspace,
    private readonly model: string = 'qwen3-32b'
  ) {}

  async execute(existing?: CodebaseMap): Promise<CodebaseMap> {
    if (existing) {
      // Complete incrementally even if existing map is incomplete (do NOT rebuild from scratch)
      const actualContexts = existing.contexts?.length ?? 0;
      if (actualContexts < 5) {
        console.log(`   [Stage 2] ⚠️  Existing map has ${actualContexts} contexts — completing incrementally (not rebuilding)`);
      }
      return await this.executeIncremental(existing);
    }
    return await this.executeChunked();
  }

  /**
   * Discover chunks dynamically based on actual project structure.
   * Falls back to DEFAULT_CHUNKS if their directories exist.
   */
  private async discoverChunks(): Promise<ChunkDefinition[]> {
    // Try src/ first, then root
    let basePath = 'src';
    let entries: string[] = [];
    try {
      entries = await this.workspace.listEntries('src');
    } catch {
      basePath = '.';
      try {
        entries = await this.workspace.listEntries('.');
      } catch {
        entries = [];
      }
    }

    const dirs = entries.filter(e => e.endsWith('/')).map(e => e.replace(/\/$/, ''));

    if (dirs.length === 0) {
      console.log('   [Stage 2] 📂 No directories found, using single chunk');
      return [{
        id: 1,
        name: 'Project Files',
        description: 'All project files in workspace root',
        directories: ['.']
      }];
    }

    // Check if DEFAULT_CHUNKS directories actually exist in this workspace
    // Also check nested directories (e.g., src/core/configuration under src/core/)
    const existingDefaultChunks = DEFAULT_CHUNKS.filter(chunk =>
      chunk.directories.some(dir => {
        const dirName = dir.split('/').pop()?.replace('.ts', '') || '';
        // Check top-level dirs
        if (dirs.includes(dirName)) return true;
        // Check if parent dir exists (e.g., 'core' for 'src/core/configuration')
        const parts = dir.split('/');
        if (parts.length >= 2) {
          const parentDir = parts[parts.length - 2];
          if (dirs.includes(parentDir)) return true;
        }
        return false;
      })
    );

    if (existingDefaultChunks.length >= 2) {
      console.log(`   [Stage 2] 📂 Using ${existingDefaultChunks.length} predefined chunks (matching project structure)`);
      return existingDefaultChunks;
    }

    // Dynamic: one chunk per directory
    console.log(`   [Stage 2] 📂 Dynamic chunking: ${dirs.length} directories found in ${basePath}/`);
    return dirs.map((dir, idx) => ({
      id: idx + 1,
      name: dir.charAt(0).toUpperCase() + dir.slice(1).replace(/[-_]/g, ' '),
      description: `Source files in ${basePath}/${dir}/`,
      directories: [basePath === '.' ? dir : `${basePath}/${dir}`]
    }));
  }

  private async executeChunked(): Promise<CodebaseMap> {
    console.log(`   [Stage 2] 🔄 Chunked generation (first run)...`);
    const startTime = Date.now();

    const chunks = await this.discoverChunks();
    console.log(`   [Stage 2] 📦 Splitting into ${chunks.length} chunks`);

    const chunkManager = new ChunkManager(this.taskExecutor, this.tools, this.model);
    const { results: chunkResults, failed } = await chunkManager.processAllChunks(chunks);

    if (chunkResults.length === 0) {
      throw new Error('All chunks failed to process - cannot generate codebase map');
    }

    const mergedContexts = ChunkManager.mergeChunks(chunkResults);

    // Enrich with hashes
    const detector = new ChangeDetector(this.workspace);
    for (const ctx of mergedContexts) {
      for (const file of ctx.files) {
        if (!file.hash) {
          file.hash = await detector.hashFile(file.path);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   [Stage 2] ⏱️  Total: ${Math.round(duration/1000)}s`);

    const result: CodebaseMap = {
      meta: {
        project_name: mergedContexts[0]?.context_name?.split(' ')[0] || 'project',
        map_version: '1.0.0',
        generated_at: new Date().toISOString().split('T')[0],
        total_contexts: mergedContexts.length,
        generation_mode: 'chunked',
        total_chunks: chunks.length,
        successful_chunks: chunkResults.length,
        failed_chunks: failed.length
      },
      contexts: mergedContexts
    };

    console.log(`   [Stage 2] ✅ Final: ${mergedContexts.length} contexts from ${chunkResults.length}/${chunks.length} chunks`);

    if (failed.length > 0) {
      console.log(`   [Stage 2] ⚠️  ${failed.length} chunk(s) failed but pipeline continued with partial result`);
      console.log(`   [Stage 2] 💡 Check debug logs in .ai/knowledge/debug/ for details`);
    }

    return result;
  }

  private async executeIncremental(existing: CodebaseMap): Promise<CodebaseMap> {
    const existingContextCount = existing.contexts?.length || 0;
    console.log(`   [Stage 2] 🔄 Incremental update (existing: ${existingContextCount} contexts)...`);

    if (existingContextCount < 10) {
      console.log(`   [Stage 2] ⚠️  Existing map too sparse (${existingContextCount} contexts), rebuilding via chunked`);
      return await this.executeChunked();
    }

    const startTime = Date.now();

    const detector = new ChangeDetector(this.workspace);
    const baselineFiles = existing.contexts.flatMap(c =>
      c.files.map(f => ({ path: f.path, hash: f.hash || '' }))
    );
    const currentFiles = await detector.listAllSourceFiles();
    const changes = await detector.detectChanges(baselineFiles, currentFiles);

    if (changes.length === 0) {
      console.log(`   [Stage 2] ⚡ No changes detected, skipping (${Math.round((Date.now()-startTime)/1000)}s)`);
      return existing;
    }

    console.log(`   [Stage 2] 📝 ${changes.length} changes detected`);

    const affectedContexts = this.findAffectedContexts(existing, changes);

    if (affectedContexts.length === 0) {
      console.log(`   [Stage 2] ⚡ Changes outside tracked contexts, skipping`);
      return existing;
    }

    console.log(`   [Stage 2] 🎯 ${affectedContexts.length} contexts affected`);

    const subsetMap: CodebaseMap = {
      ...existing,
      contexts: affectedContexts
    };
    const changesSummary = this.formatChangesSummary(changes, affectedContexts);

    const promptContent = CODEBASE_INCREMENTAL_PROMPT
      .replace('__EXISTING_MAP_JSON__', JSON.stringify(subsetMap, null, 2))
      .replace('__CHANGES_SUMMARY__', changesSummary);

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

    const duration = Date.now() - startTime;
    const content = response.content || '';
    console.log(`   [Stage 2] ⏱️  ${Math.round(duration/1000)}s, ${content.length} chars`);

    const parsed = extractJsonFromResponse<{ contexts: CodebaseMapContext[] }>(content);
    if (!parsed || !parsed.contexts) {
      console.log(`   [Stage 2] ⚠️  Incremental parse failed, falling back to chunked`);
      return await this.executeChunked();
    }

    if (parsed.contexts.length < existingContextCount * 0.5) {
      console.log(`   [Stage 2] ⚠️  Incremental result too small (${parsed.contexts.length} vs ${existingContextCount} contexts), falling back to chunked`);
      return await this.executeChunked();
    }

    const updatedMap = this.mergeUpdates(existing, parsed.contexts, changes);

    for (const ctx of updatedMap.contexts) {
      for (const file of ctx.files) {
        if (!file.hash) {
          file.hash = await detector.hashFile(file.path);
        }
      }
    }

    updatedMap.meta.generation_mode = 'incremental';
    updatedMap.meta.generated_at = new Date().toISOString().split('T')[0];
    updatedMap.meta.total_contexts = updatedMap.contexts.length;

    console.log(`   [Stage 2] ✅ Incremental: ${updatedMap.contexts.length} contexts, ${changes.length} changes`);
    return updatedMap;
  }

  private findAffectedContexts(map: CodebaseMap, changes: FileChange[]): CodebaseMapContext[] {
    const changedPaths = new Set(changes.map(c => c.path));
    const affected: CodebaseMapContext[] = [];

    for (const context of map.contexts) {
      const hasAffectedFile = context.files.some(f => changedPaths.has(f.path));
      if (hasAffectedFile) {
        affected.push(context);
      }
    }

    return affected;
  }

  private mergeUpdates(
    existing: CodebaseMap,
    updatedContexts: CodebaseMapContext[],
    changes: FileChange[]
  ): CodebaseMap {
    const updatedContextNames = new Set(updatedContexts.map(c => c.context_name));
    const deletedPaths = new Set(changes.filter(c => c.type === 'deleted').map(c => c.path));

    const merged: CodebaseMapContext[] = [];

    for (const context of existing.contexts) {
      if (updatedContextNames.has(context.context_name)) {
        const updated = updatedContexts.find(c => c.context_name === context.context_name)!;
        merged.push(updated);
      } else {
        const filtered = {
          ...context,
          files: context.files.filter(f => !deletedPaths.has(f.path))
        };
        merged.push(filtered);
      }
    }

    return {
      ...existing,
      contexts: merged
    };
  }

  private formatChangesSummary(changes: FileChange[], affectedContexts: CodebaseMapContext[]): string {
    let summary = `Total changes: ${changes.length}\n\n`;
    summary += `Added: ${changes.filter(c => c.type === 'added').length}\n`;
    summary += `Modified: ${changes.filter(c => c.type === 'modified').length}\n`;
    summary += `Deleted: ${changes.filter(c => c.type === 'deleted').length}\n\n`;

    summary += 'Affected contexts:\n';
    for (const ctx of affectedContexts) {
      const ctxChanges = changes.filter(c => ctx.files.some(f => f.path === c.path));
      summary += `- ${ctx.context_name}: ${ctxChanges.length} file changes\n`;
    }

    summary += '\nDetailed changes:\n';
    for (const change of changes.slice(0, 20)) {
      summary += `- [${change.type}] ${change.path}\n`;
    }
    if (changes.length > 20) {
      summary += `... and ${changes.length - 20} more\n`;
    }

    return summary;
  }
}
