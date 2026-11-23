import * as fs from 'fs/promises';
import * as path from 'path';
import { TaskExecutor } from '../../execution/task-executor';
import { KnowledgeRole } from '../knowledge-role';
import { ToolDefinition } from '../../../contracts/provider';
import { KnownProviders } from '../../../domain/provider-id';
import { extractJsonFromResponse } from '../utils/json-validator';
import { CODEBASE_CHUNK_PROMPT } from '../prompts/codebase-chunk-prompt';

export interface ChunkDefinition {
  id: number;
  name: string;
  description: string;
  directories: string[];
}

export interface ChunkContext {
  context_name: string;
  tags: string[];
  description: string;
  dependencies: string[];
  files: Array<{
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
  }>;
}

export interface ChunkResult {
  chunk: ChunkDefinition;
  contexts: ChunkContext[];
  attempts: number;
  wasSplit: boolean;
}

export interface FailedChunk {
  chunk: ChunkDefinition;
  reason: string;
  attempts: number;
  debugLogPath?: string;
}

/**
 * Predefined chunks for the codebase.
 * Chunk 4 has been split into 4a and 4b to reduce size.
 */
export const DEFAULT_CHUNKS: ChunkDefinition[] = [
  {
    id: 1,
    name: 'CLI & Commands',
    description: 'CLI entry points, command handlers, REPL, and workspace resolver',
    directories: ['src/cli']
  },
  {
    id: 2,
    name: 'Contracts & Domain',
    description: 'Public interfaces, type contracts, and domain models',
    directories: ['src/contracts', 'src/domain']
  },
  {
    id: 3,
    name: 'Core Part 1',
    description: 'Configuration, context engine, and conversation orchestration',
    directories: ['src/core/configuration', 'src/core/context', 'src/core/conversation']
  },
  {
    id: 4,
    name: 'Core Part 2a',
    description: 'Discovery and execution services',
    directories: ['src/core/discovery', 'src/core/execution']
  },
  {
    id: 5,
    name: 'Core Part 2b',
    description: 'Knowledge pipeline and prompt building',
    directories: ['src/core/knowledge', 'src/core/prompt']
  },
  {
    id: 6,
    name: 'Core Part 3',
    description: 'Provider, runtime, session, tool, and workspace implementations',
    directories: ['src/core/provider', 'src/core/runtime', 'src/core/session', 'src/core/tool', 'src/core/workspace', 'src/core/app-factory.ts']
  }
];

const DEBUG_DIR = '.ai/knowledge/debug';

export class ChunkManager {
  constructor(
    private readonly taskExecutor: TaskExecutor,
    private readonly tools: ReadonlyArray<ToolDefinition>,
    private readonly model: string = 'qwen3-32b'
  ) {}

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save raw LLM response to debug file for analysis.
   */
  private async saveDebugLog(
    chunk: ChunkDefinition,
    content: string,
    attempt: number,
    error?: string
  ): Promise<string | undefined> {
    try {
      await fs.mkdir(DEBUG_DIR, { recursive: true });
      const debugPath = path.join(DEBUG_DIR, `chunk_${chunk.id}_${chunk.name.replace(/\s+/g, '_')}_attempt_${attempt}.txt`);
      const header = `=== DEBUG LOG ===\nChunk: ${chunk.id} - ${chunk.name}\nAttempt: ${attempt}\nTimestamp: ${new Date().toISOString()}\nError: ${error || 'JSON parse failed'}\nContent length: ${content.length} chars\n\n=== RAW CONTENT ===\n`;
      await fs.writeFile(debugPath, header + content, 'utf-8');
      console.log(`   📄 Debug saved: ${debugPath}`);
      return debugPath;
    } catch (e: any) {
      console.log(`   ⚠️  Could not save debug log: ${e.message}`);
      return undefined;
    }
  }

  /**
   * Process a single chunk with retry logic.
   * Returns null if all attempts fail (caller decides whether to split).
   */
  private async tryProcessChunk(
    chunk: ChunkDefinition,
    maxAttempts: number = 2
  ): Promise<{ contexts: ChunkContext[]; attempts: number; lastContent?: string; lastError?: string } | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const promptContent = CODEBASE_CHUNK_PROMPT
          .replace('__CHUNK_NAME__', chunk.name)
          .replace('__CHUNK_DESCRIPTION__', chunk.description)
          .replace('__CHUNK_DIRECTORIES__', chunk.directories.join(', '));

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
        const parsed = extractJsonFromResponse<{ contexts: ChunkContext[] }>(content);

        if (!parsed || !parsed.contexts) {
          if (attempt < maxAttempts) {
            console.log(`   ⚠️  Parse failed (attempt ${attempt}/${maxAttempts}), retrying in 2s...`);
            await this.sleep(2000);
            continue;
          }
          return { contexts: [], attempts: attempt, lastContent: content, lastError: 'JSON parse failed' };
        }

        return { contexts: parsed.contexts, attempts: attempt };
      } catch (err: any) {
        if (attempt < maxAttempts) {
          console.log(`   ⚠️  Error: ${err.message} (attempt ${attempt}/${maxAttempts}), retrying in 3s...`);
          await this.sleep(3000);
          continue;
        }
        return { contexts: [], attempts: attempt, lastError: err.message };
      }
    }
    return null;
  }

  /**
   * Split a chunk into smaller sub-chunks (one per directory).
   */
  private splitChunk(chunk: ChunkDefinition): ChunkDefinition[] {
    if (chunk.directories.length <= 1) {
      // Cannot split further
      return [];
    }

    return chunk.directories.map((dir, idx) => ({
      id: chunk.id * 100 + idx,  // Unique ID
      name: `${chunk.name} (sub ${idx + 1}: ${path.basename(dir)})`,
      description: `Sub-chunk of ${chunk.name} focusing on ${dir}`,
      directories: [dir]
    }));
  }

  /**
   * Process a chunk with full recovery strategy:
   * 1. Try with retries
   * 2. If fails, split into sub-chunks and retry
   * 3. If still fails, save debug log and return empty
   */
  async processChunk(chunk: ChunkDefinition): Promise<ChunkResult | FailedChunk> {
    console.log(`   [Chunk ${chunk.id}] ${chunk.name}...`);
    const startTime = Date.now();

    // Layer 1: Try with retries
    const result = await this.tryProcessChunk(chunk, 2);

    if (result && result.contexts.length > 0) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      console.log(`   [Chunk ${chunk.id}] ✅ ${duration}s, ${result.contexts.length} contexts (${result.attempts} attempt${result.attempts > 1 ? 's' : ''})`);
      return { chunk, contexts: result.contexts, attempts: result.attempts, wasSplit: false };
    }

    // Layer 2: Try to split if chunk has multiple directories
    if (chunk.directories.length > 1) {
      console.log(`   [Chunk ${chunk.id}] 🔄 Splitting into ${chunk.directories.length} sub-chunks...`);
      const subChunks = this.splitChunk(chunk);
      const subContexts: ChunkContext[] = [];
      let subSuccess = 0;

      for (const subChunk of subChunks) {
        const subResult = await this.tryProcessChunk(subChunk, 1);
        if (subResult && subResult.contexts.length > 0) {
          subContexts.push(...subResult.contexts);
          subSuccess++;
          console.log(`   [Sub-chunk] ✅ ${subChunk.name}: ${subResult.contexts.length} contexts`);
        } else {
          console.log(`   [Sub-chunk] ❌ ${subChunk.name}: failed`);
        }
      }

      if (subSuccess > 0) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`   [Chunk ${chunk.id}] ✅ Split successful: ${subContexts.length} contexts from ${subSuccess}/${subChunks.length} sub-chunks (${duration}s)`);
        return { chunk, contexts: subContexts, attempts: 1, wasSplit: true };
      }
    }

    // Layer 3: Save debug log and report failure
    const duration = Math.round((Date.now() - startTime) / 1000);
    let debugLogPath: string | undefined;

    if (result?.lastContent) {
      debugLogPath = await this.saveDebugLog(chunk, result.lastContent, result.attempts, result.lastError);
    }

    console.log(`   [Chunk ${chunk.id}] ❌ Failed after ${duration}s (${result?.attempts || 0} attempts)`);
    console.log(`   [Chunk ${chunk.id}]    Reason: ${result?.lastError || 'Unknown'}`);

    return {
      chunk,
      reason: result?.lastError || 'Unknown failure',
      attempts: result?.attempts || 0,
      debugLogPath
    } as FailedChunk;
  }

  /**
   * Type guard: is this a successful result?
   */
  private isSuccess(result: ChunkResult | FailedChunk): result is ChunkResult {
    return 'contexts' in result && Array.isArray((result as ChunkResult).contexts);
  }

  /**
   * Process all chunks with recovery strategy and detailed summary.
   */
  async processAllChunks(chunks: ChunkDefinition[] = DEFAULT_CHUNKS): Promise<{
    results: ChunkResult[];
    failed: FailedChunk[];
  }> {
    const results: ChunkResult[] = [];
    const failed: FailedChunk[] = [];

    console.log(`\n📦 Processing ${chunks.length} chunks with auto-recovery...\n`);

    for (let i = 0; i < chunks.length; i++) {
      const result = await this.processChunk(chunks[i]);

      if (this.isSuccess(result)) {
        results.push(result);
      } else {
        failed.push(result);
      }
    }

    // Summary
    console.log(`\n📊 Chunk Processing Summary:`);
    console.log(`   ✅ Success: ${results.length}/${chunks.length}`);
    console.log(`      - Direct success: ${results.filter(r => !r.wasSplit).length}`);
    console.log(`      - Recovered via split: ${results.filter(r => r.wasSplit).length}`);
    console.log(`      - Average attempts: ${(results.reduce((s, r) => s + r.attempts, 0) / Math.max(results.length, 1)).toFixed(1)}`);

    if (failed.length > 0) {
      console.log(`   ❌ Failed: ${failed.length}`);
      for (const f of failed) {
        console.log(`      - ${f.chunk.name}: ${f.reason} (${f.attempts} attempts)`);
        if (f.debugLogPath) {
          console.log(`        Debug: ${f.debugLogPath}`);
        }
      }
    }

    return { results, failed };
  }

  /**
   * Merge multiple chunk results into a single contexts array.
   */
  static mergeChunks(results: ChunkResult[]): ChunkContext[] {
    const merged: ChunkContext[] = [];
    for (const result of results) {
      merged.push(...result.contexts);
    }
    return merged;
  }
}
