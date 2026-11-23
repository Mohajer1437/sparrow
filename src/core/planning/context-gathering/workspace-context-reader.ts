import * as fs from 'fs';
import * as path from 'path';
import {
  canonicalizeWorkspaceRoot,
  resolveWorkspacePath,
  toPosixRelative,
  WorkspacePathError,
} from '../../workspace/workspace-paths';

export interface WorkspaceFileStat {
  readonly relative: string;
  readonly absolute: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly sizeBytes: number;
  readonly fingerprint: string;
  readonly modifiedAt?: string;
}

/**
 * Read context files against one canonical workspace root.
 * Never uses process.cwd(). Never searches outside the workspace.
 */
export class WorkspaceContextReader {
  readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = canonicalizeWorkspaceRoot(workspaceRoot);
  }

  resolve(filePath: string) {
    return resolveWorkspacePath(this.root, filePath);
  }

  stat(filePath: string): WorkspaceFileStat {
    const resolved = this.resolve(filePath);
    try {
      const stats = fs.statSync(resolved.absolute);
      return {
        relative: resolved.relative,
        absolute: resolved.absolute,
        exists: true,
        isDirectory: stats.isDirectory(),
        sizeBytes: stats.isFile() ? stats.size : 0,
        fingerprint: `${stats.mtimeMs}:${stats.size}`,
        modifiedAt: stats.mtime.toISOString(),
      };
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error;
      return {
        relative: resolved.relative,
        absolute: resolved.absolute,
        exists: false,
        isDirectory: false,
        sizeBytes: 0,
        fingerprint: 'missing',
      };
    }
  }

  exists(filePath: string): boolean {
    try {
      return this.stat(filePath).exists;
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error;
      return false;
    }
  }

  read(filePath: string): string {
    const resolved = this.resolve(filePath);
    return fs.readFileSync(resolved.absolute, 'utf-8');
  }

  listFiles(directoryPath: string): string[] {
    const resolved = this.resolve(directoryPath);
    if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isDirectory()) {
      return [];
    }
    const entries = fs.readdirSync(resolved.absolute, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (shouldSkipName(entry.name)) continue;
      files.push(toPosixRelative(path.join(resolved.relative, entry.name)));
    }
    files.sort((a, b) => a.localeCompare(b));
    return files;
  }
}

function shouldSkipName(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === '.patch-backups';
}
