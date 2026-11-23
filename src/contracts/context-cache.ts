import { CachedProjectContext } from '../domain/project-context-cache';

/**
 * Cached file snapshot reused by targeted context gathering.
 * Invalidated when the file fingerprint changes.
 */
export interface CachedFileContent {
  readonly path: string;
  readonly content: string;
  readonly fingerprint: string;
  readonly sizeBytes: number;
  readonly metadata: {
    readonly modifiedAt?: string;
    readonly truncated?: boolean;
  };
}

/**
 * In-memory (or other) store for project context snapshots.
 * File entries reuse the same cache instance — not a second cache.
 */
export interface ContextCache {
  get(workspaceRoot: string): CachedProjectContext | undefined;
  set(workspaceRoot: string, context: CachedProjectContext): void;
  invalidate(workspaceRoot: string): void;
  invalidateAll(): void;
  getFile(workspaceRoot: string, relativePath: string): CachedFileContent | undefined;
  setFile(workspaceRoot: string, relativePath: string, entry: CachedFileContent): void;
  invalidateFile(workspaceRoot: string, relativePath: string): void;
  invalidateFiles(workspaceRoot: string): void;
}

/**
 * Extension point for cache freshness. Default implementation uses
 * filesystem fingerprints. Git-based analysis is deferred.
 */
export interface CacheInvalidationPolicy {
  shouldInvalidate(workspaceRoot: string, entry: CachedProjectContext): Promise<boolean>;
}

export interface ProjectFingerprinter {
  compute(workspaceRoot: string): Promise<string>;
}

export interface ProjectContextLoadOptions {
  readonly refresh?: boolean;
}

/**
 * Loads project profile + .ai metadata, with cache reuse / invalidation.
 * Consumed by PlannerContextPreparationService (Milestone B1).
 * Does not load source files or interpret .ai contents.
 */
export interface ProjectContextService {
  load(workspaceRoot: string, options?: ProjectContextLoadOptions): Promise<CachedProjectContext>;
  refresh(workspaceRoot: string): Promise<CachedProjectContext>;
}
