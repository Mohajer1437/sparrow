import { WorkspaceKnowledge } from '../domain/workspace-knowledge';

/**
 * R2.1: WorkspaceMemory Contract
 *
 * The single source of truth for project knowledge at runtime.
 *
 * Responsibilities:
 *   - Locate the knowledge directory (.ai/knowledge/)
 *   - Load existing knowledge files (READ ONLY)
 *   - Return typed WorkspaceKnowledge object
 *   - NEVER throw on missing/invalid files
 *
 * Non-responsibilities:
 *   - Does NOT generate knowledge
 *   - Does NOT call LLM
 *   - Does NOT modify files
 *   - Does NOT scan project
 *   - Does NOT summarize
 *
 * Future consumers (R2.2+):
 *   - TaskExecutor (inject knowledge into context)
 *   - ConversationOrchestrator (memory-aware planning)
 *   - Planner/Reviewer (R3)
 */
export interface WorkspaceMemory {
  /**
   * Load all available project knowledge.
   *
   * Returns a WorkspaceKnowledge object where each field is either
   * the parsed data or null (if file missing/invalid).
   *
   * NEVER throws. Always returns a valid WorkspaceKnowledge.
   */
  load(): Promise<WorkspaceKnowledge>;

  /**
   * Check if any knowledge files exist.
   * Lightweight check without parsing.
   */
  hasKnowledge(): Promise<boolean>;

  /**
   * Get the path to the knowledge directory.
   */
  getKnowledgeDir(): string;
}
