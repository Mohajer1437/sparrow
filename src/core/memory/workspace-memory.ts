import { WorkspaceMemory } from '../../contracts/workspace-memory';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import {
  WorkspaceKnowledge,
  ArchitecturalMapData,
  CodebaseMapData,
  KnowledgeBaseData,
} from '../../domain/workspace-knowledge';

const KNOWLEDGE_DIR = 'knowledge';
const ARCH_MAP_FILE = 'knowledge/architectural-map.json';
const CODEBASE_MAP_FILE = 'knowledge/codebase-map.json';
const KNOWLEDGE_BASE_FILE = 'knowledge/knowledge_base.json';

/**
 * R2.1: DefaultWorkspaceMemory
 *
 * READ-ONLY runtime service that loads existing project knowledge
 * from the .ai/knowledge/ directory via RuntimeRepository.
 *
 * Design principles:
 *   - Never throws (returns null for missing/invalid files)
 *   - Never writes (pure read)
 *   - Never calls LLM
 *   - Logs warnings for invalid JSON (does not crash)
 *   - Returns deeply frozen objects (immutability)
 */
export class DefaultWorkspaceMemory implements WorkspaceMemory {
  constructor(
    private readonly runtime: RuntimeRepository
  ) {}

  getKnowledgeDir(): string {
    return KNOWLEDGE_DIR;
  }

  async hasKnowledge(): Promise<boolean> {
    try {
      const dirExists = await this.runtime.exists(KNOWLEDGE_DIR);
      if (!dirExists) return false;

      const [archExists, codebaseExists, kbExists] = await Promise.all([
        this.runtime.exists(ARCH_MAP_FILE),
        this.runtime.exists(CODEBASE_MAP_FILE),
        this.runtime.exists(KNOWLEDGE_BASE_FILE),
      ]);

      return archExists || codebaseExists || kbExists;
    } catch {
      return false;
    }
  }

  async load(): Promise<WorkspaceKnowledge> {
    const [architecturalMap, codebaseMap, knowledgeBase] = await Promise.all([
      this.loadFile<ArchitecturalMapData>(ARCH_MAP_FILE, 'architectural-map'),
      this.loadFile<CodebaseMapData>(CODEBASE_MAP_FILE, 'codebase-map'),
      this.loadFile<KnowledgeBaseData>(KNOWLEDGE_BASE_FILE, 'knowledge-base'),
    ]);

    const isEmpty = architecturalMap === null
      && codebaseMap === null
      && knowledgeBase === null;

    const knowledge: WorkspaceKnowledge = Object.freeze({
      architecturalMap: architecturalMap ? Object.freeze(architecturalMap) : null,
      codebaseMap: codebaseMap ? Object.freeze(codebaseMap) : null,
      knowledgeBase: knowledgeBase ? Object.freeze(knowledgeBase) : null,
      loadedAt: new Date().toISOString(),
      isEmpty,
    });

    return knowledge;
  }

  /**
   * Load and parse a single JSON file.
   * Returns null if file doesn't exist or JSON is invalid.
   * Logs a warning for invalid JSON (never crashes).
   */
  private async loadFile<T>(filePath: string, label: string): Promise<T | null> {
    try {
      const exists = await this.runtime.exists(filePath);
      if (!exists) {
        return null;
      }

      const raw = await this.runtime.readFile(filePath);

      if (!raw || raw.trim().length === 0) {
        return null;
      }

      const parsed = JSON.parse(raw) as T;
      return parsed;
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        console.warn(
          `[WorkspaceMemory] Warning: Invalid JSON in ${label} (${filePath}). ` +
          `Returning null. Error: ${error.message}`
        );
      } else if (error.code === 'ENOENT' || error.message?.includes('ENOENT')) {
        // File doesn't exist - this is normal, not a warning
        return null;
      } else {
        console.warn(
          `[WorkspaceMemory] Warning: Could not load ${label} (${filePath}). ` +
          `Returning null. Error: ${error.message}`
        );
      }
      return null;
    }
  }
}
