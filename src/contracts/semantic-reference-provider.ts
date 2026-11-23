import { ProjectSnapshot } from '../domain/snapshot';

/**
 * A semantic reference to a file, discovered via static analysis (LSP, AST, etc.).
 *
 * Used to enrich context with files that are semantically relevant to the task,
 * beyond simple text matching.
 */
export interface SemanticReference {
  /** Absolute or workspace-relative path to the file */
  readonly path: string;

  /** Name of the symbol (class, function, interface) that was referenced */
  readonly symbolName?: string;

  /** Relevance score in [0, 1] — higher means more relevant */
  readonly relevanceScore: number;

  /** Human-readable reason why this file was selected */
  readonly reason: string;
}

/**
 * Contract for providers that can discover semantically relevant files
 * for a given task using static code analysis.
 *
 * Implementations:
 * - NullSemanticReferenceProvider (default, always returns [])
 * - LspSemanticReferenceProvider (future, uses TypeScript Language Server)
 *
 * Consumers should always check isAvailable() before calling findRelevantFiles().
 * Implementations MUST handle errors gracefully and never throw — return [] on failure.
 */
export interface SemanticReferenceProvider {
  /**
   * Check if the provider is available and ready to use.
   * For LSP: checks if tsconfig.json exists and server is running.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Find files semantically relevant to the task.
   * MUST NOT throw — return [] on any failure.
   */
  findRelevantFiles(
    task: string,
    snapshot: ProjectSnapshot,
  ): Promise<ReadonlyArray<SemanticReference>>;
}
