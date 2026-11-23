/**
 * Contract for discovering project structure (file tree, key files).
 *
 * Used by StepExecutionEngine to give each step agent awareness of
 * the project's layout, so it can make semantically correct decisions
 * (e.g., where to create new files, which components to import).
 *
 * This is a NON-LLM, deterministic scan of the workspace filesystem.
 * It does NOT require LSP or AST — just reads directory entries.
 */
export interface ProjectStructureService {
  /**
   * Scan the workspace and return a markdown-rendered project tree.
   * Excludes node_modules, .next, dist, build, .git, .ai.
   * Limits depth to prevent runaway scans on huge projects.
   *
   * MUST NOT throw — returns empty string on any failure.
   */
  scan(workspacePath: string): Promise<string>;
}
