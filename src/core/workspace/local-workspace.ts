import fs from 'fs/promises';
import path from 'path';
import { Workspace, Snapshot, FileDiff } from '../../contracts/workspace';
import { canonicalizeWorkspaceRoot, resolveWorkspacePath, WorkspacePathError } from './workspace-paths';

const PROTECTED_DIRS = ['.ai', '.git', 'node_modules', '.patch-backups', 'dist', '.vscode'];

export class LocalWorkspace implements Workspace {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = canonicalizeWorkspaceRoot(rootDir);
  }

  getRoot(): string {
    return this.rootDir;
  }

  // TODO: If path validation, protected directory validation, and filesystem logic grow,
  // consider extracting them into a WorkspacePolicy or separate validation services.
  private resolveAndValidate(filePath: string): string {
    const resolved = resolveWorkspacePath(this.rootDir, filePath);
    const parts = resolved.relative.split('/').filter(p => p && p !== '.');
    for (const part of parts) {
      if (PROTECTED_DIRS.includes(part)) {
        throw new Error(`Access denied: ${part} is a protected directory`);
      }
    }
    return resolved.absolute;
  }

  async readFile(filePath: string): Promise<string> {
    const resolved = this.resolveAndValidate(filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolveAndValidate(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const resolved = this.resolveAndValidate(filePath);
      await fs.access(resolved);
      return true;
    } catch (error) {
      if (error instanceof WorkspacePathError && error.code === 'TRAVERSAL') {
        throw error;
      }
      return false;
    }
  }

  async listFiles(directoryPath: string): Promise<string[]> {
    try {
      const resolved = this.resolveAndValidate(directoryPath);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(path.join(directoryPath, entry.name));
        } else if (entry.isDirectory() && !PROTECTED_DIRS.includes(entry.name)) {
          const subFiles = await this.listFiles(path.join(directoryPath, entry.name));
          files.push(...subFiles);
        }
      }
      return files;
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        // Directory not accessible (e.g. $RECYCLE.BIN on Windows) - skip silently
        return [];
      }
      throw error;
    }
  }

  async createSnapshot(description?: string): Promise<Snapshot> {
    throw new Error('Snapshot functionality is reserved for Milestone S6.');
  }

  async rollback(snapshotId: string): Promise<void> {
    throw new Error('Rollback functionality is reserved for Milestone S6.');
  }

  async diff(snapshotIdA: string, snapshotIdB?: string): Promise<FileDiff[]> {
    throw new Error('Diff functionality is reserved for Milestone S6.');
  }


  async deleteFile(filePath: string): Promise<void> {
    const resolved = this.resolveAndValidate(filePath);
    const fsPromises = await import('fs/promises'); await fsPromises.unlink(resolved);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolveAndValidate(dirPath);
    const fsPromises = await import('fs/promises'); await fsPromises.mkdir(resolved, { recursive: options?.recursive ?? false });
  }


  async isDirectory(filePath: string): Promise<boolean> {
    const resolved = this.resolveAndValidate(filePath);
    const fsPromises = await import('fs/promises'); const stats = await fsPromises.stat(resolved);
    return stats.isDirectory();
  }

  async listEntries(dirPath: string): Promise<string[]> {
    const resolved = this.resolveAndValidate(dirPath);
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const result: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!PROTECTED_DIRS.includes(entry.name)) {
            result.push(entry.name + '/');
          }
        } else {
          result.push(entry.name);
        }
      }
      return result.sort();
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        return [];
      }
      throw error;
    }
  }

}
