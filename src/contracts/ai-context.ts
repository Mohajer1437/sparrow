import { AiContextDiscovery, AiContextFileName } from '../domain/ai-context';

/**
 * Discover .ai context metadata and optionally load raw file bytes.
 * Full interpretation of context files is deferred.
 */
export interface AiContextLoader {
  discover(workspaceRoot: string): Promise<AiContextDiscovery>;

  /**
   * Load raw text of a known context file.
   * Returns null when the file is missing, a directory, or unreadable.
   * Does not parse or interpret contents.
   */
  loadRaw(workspaceRoot: string, name: AiContextFileName): Promise<string | null>;

  /**
   * Load raw text of a discovered `.ai` path (nested files included).
   * Path must resolve inside the workspace `.ai` directory.
   */
  loadRawPath?(workspaceRoot: string, relativePath: string): Promise<string | null>;
}
