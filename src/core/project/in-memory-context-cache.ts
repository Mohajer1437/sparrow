import * as path from 'path';
import { CacheInvalidationPolicy, CachedFileContent, ContextCache } from '../../contracts/context-cache';
import {
  CachedProjectContext,
  freezeCachedProjectContext,
} from '../../domain/project-context-cache';

export class InMemoryContextCache implements ContextCache {
  private readonly entries = new Map<string, CachedProjectContext>();
  private readonly files = new Map<string, CachedFileContent>();

  get(workspaceRoot: string): CachedProjectContext | undefined {
    return this.entries.get(normalizeKey(workspaceRoot));
  }

  set(workspaceRoot: string, context: CachedProjectContext): void {
    this.entries.set(normalizeKey(workspaceRoot), freezeCachedProjectContext(context));
  }

  invalidate(workspaceRoot: string): void {
    this.entries.delete(normalizeKey(workspaceRoot));
  }

  invalidateFiles(workspaceRoot: string): void {
    const prefix = fileKeyPrefix(normalizeKey(workspaceRoot));
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) {
        this.files.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.entries.clear();
    this.files.clear();
  }

  getFile(workspaceRoot: string, relativePath: string): CachedFileContent | undefined {
    return this.files.get(fileKey(workspaceRoot, relativePath));
  }

  setFile(workspaceRoot: string, relativePath: string, entry: CachedFileContent): void {
    this.files.set(fileKey(workspaceRoot, relativePath), Object.freeze({
      path: entry.path,
      content: entry.content,
      fingerprint: entry.fingerprint,
      sizeBytes: entry.sizeBytes,
      metadata: Object.freeze({ ...entry.metadata }),
    }));
  }

  invalidateFile(workspaceRoot: string, relativePath: string): void {
    this.files.delete(fileKey(workspaceRoot, relativePath));
  }
}

export class FingerprintInvalidationPolicy implements CacheInvalidationPolicy {
  constructor(private readonly computeFingerprint: (workspaceRoot: string) => Promise<string>) {}

  async shouldInvalidate(workspaceRoot: string, entry: CachedProjectContext): Promise<boolean> {
    const current = await this.computeFingerprint(workspaceRoot);
    return current !== entry.fingerprint;
  }
}

function normalizeKey(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function fileKeyPrefix(workspaceKey: string): string {
  return `${workspaceKey}::file::`;
}

function fileKey(workspaceRoot: string, relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return `${fileKeyPrefix(normalizeKey(workspaceRoot))}${normalizedPath}`;
}
