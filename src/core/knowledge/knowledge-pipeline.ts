import { RuntimeRepository } from '../../contracts/runtime-repository';
import { TaskExecutor } from '../execution/task-executor';
import { Workspace } from '../../contracts/workspace';
import { ToolDefinition } from '../../contracts/provider';
import { ArchitecturalMapStage } from './stages/architectural-map-stage';
import { CodebaseMapStage } from './stages/codebase-map-stage';
import { KnowledgeBaseStage } from './stages/knowledge-base-stage';
import { parseJsonSafely } from './utils/json-validator';

export interface KnowledgePipelineResult {
  success: boolean;
  files: {
    architecturalMap: string;
    codebaseMap: string;
    knowledgeBase: string;
  };
  modes?: {
    architecturalMap?: 'full' | 'incremental' | 'chunked';
    codebaseMap?: 'full' | 'incremental' | 'chunked';
    knowledgeBase?: 'full' | 'incremental';
  };
  errors?: string[];
}

export class KnowledgePipeline {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly taskExecutor: TaskExecutor,
    private readonly workspace: Workspace,
    private readonly tools: ReadonlyArray<ToolDefinition>,
    private readonly model: string = 'qwen3-32b'
  ) {}

  async execute(): Promise<KnowledgePipelineResult> {
    const errors: string[] = [];

    try {
      let existingArchMap: any;
      let existingCodebaseMap: any;

      try {
        const archJson = await this.runtime.readFile('knowledge/architectural-map.json');
        existingArchMap = parseJsonSafely(archJson);
        if (!existingArchMap || !existingArchMap.module_map || existingArchMap.module_map.length === 0) {
          console.log(`⚠️  Existing architectural-map.json invalid or empty (full mode)`);
          existingArchMap = undefined;
        } else {
          console.log(`📖 Loaded existing architectural-map.json (${existingArchMap.module_map.length} modules)`);
        }
      } catch {
        console.log(`📝 No existing architectural-map.json (full mode)`);
      }

      try {
        const codebaseJson = await this.runtime.readFile('knowledge/codebase-map.json');
        existingCodebaseMap = parseJsonSafely(codebaseJson);
        if (!existingCodebaseMap || !existingCodebaseMap.contexts || existingCodebaseMap.contexts.length === 0) {
          console.log(`⚠️  Existing codebase-map.json invalid or empty (full mode)`);
          existingCodebaseMap = undefined;
        } else {
          console.log(`📖 Loaded existing codebase-map.json (${existingCodebaseMap.contexts.length} contexts)`);
        }
      } catch {
        console.log(`📝 No existing codebase-map.json (full/chunked mode)`);
      }

      // Stage 1: Architectural Map
      const archStage = new ArchitecturalMapStage(this.taskExecutor, this.tools, this.workspace, this.model);
      const archMap = await archStage.execute(existingArchMap);
      await this.runtime.writeFile('knowledge/architectural-map.json', JSON.stringify(archMap, null, 2));

      // Stage 2: Codebase Map
      const codebaseStage = new CodebaseMapStage(this.taskExecutor, this.tools, this.workspace, this.model);
      const codebaseMap = await codebaseStage.execute(existingCodebaseMap);
      await this.runtime.writeFile('knowledge/codebase-map.json', JSON.stringify(codebaseMap, null, 2));

      // Stage 3: Knowledge Base
      let existingKnowledge: string | undefined;
      try {
        existingKnowledge = await this.runtime.readFile('knowledge/knowledge_base.json');
      } catch {
        // File doesn't exist
      }

      const kbStage = new KnowledgeBaseStage(this.taskExecutor, this.tools, this.model);
      const knowledgeBase = await kbStage.execute(existingKnowledge);
      await this.runtime.writeFile('knowledge/knowledge_base.json', JSON.stringify(knowledgeBase, null, 2));

      return {
        success: true,
        files: {
          architecturalMap: 'knowledge/architectural-map.json',
          codebaseMap: 'knowledge/codebase-map.json',
          knowledgeBase: 'knowledge/knowledge_base.json'
        },
        modes: {
          architecturalMap: archMap.meta.generation_mode,
          codebaseMap: codebaseMap.meta.generation_mode,
          knowledgeBase: knowledgeBase.meta.generation_mode
        }
      };
    } catch (err: any) {
      errors.push(err.message || String(err));
      return {
        success: false,
        files: {
          architecturalMap: '',
          codebaseMap: '',
          knowledgeBase: ''
        },
        errors
      };
    }
  }
}
