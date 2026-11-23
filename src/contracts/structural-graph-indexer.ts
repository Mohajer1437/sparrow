import { StructuralGraph } from '../domain/structural-knowledge';

/**
 * Builds and persists a deterministic structural index of the workspace.
 * Must not call an LLM or KnowledgePipeline.
 */
export interface StructuralGraphIndexer {
  /**
   * Scan the workspace and build an in-memory structural graph.
   */
  buildInitialIndex(): Promise<StructuralGraph>;

  /**
   * Persist graph to RuntimeRepository (under .ai/knowledge/structural-graph.json).
   */
  persist(graph: StructuralGraph): Promise<void>;

  /**
   * Build + persist. Convenience for CLI / bootstrap.
   */
  indexAndPersist(): Promise<StructuralGraph>;

  /**
   * Load previously persisted graph, or null if missing/invalid.
   */
  load(): Promise<StructuralGraph | null>;
}
