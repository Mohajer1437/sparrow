import * as crypto from 'crypto';
import { Workspace } from '../../../contracts/workspace';

export interface FileChange {
  type: 'added' | 'modified' | 'deleted';
  path: string;
  hash?: string;
}

export interface ModuleChanges {
  moduleName: string;
  directoryPath: string;
  changes: FileChange[];
}

export class ChangeDetector {
  constructor(private readonly workspace: Workspace) {}

  /**
   * Computes SHA-256 hash of file content (first 16 chars for compactness)
   */
  async hashFile(filePath: string): Promise<string> {
    try {
      const content = await this.workspace.readFile(filePath);
      return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
    } catch {
      return '';
    }
  }

  /**
   * Detects changes between current workspace state and a baseline.
   */
  async detectChanges(
    baselineFiles: Array<{ path: string; hash: string }>,
    currentFiles: string[]
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const baselineMap = new Map(baselineFiles.map(f => [f.path, f.hash]));
    const currentSet = new Set(currentFiles);

    // Check for modified or deleted files
    for (const baseline of baselineFiles) {
      if (!currentSet.has(baseline.path)) {
        changes.push({ type: 'deleted', path: baseline.path });
      } else {
        const currentHash = await this.hashFile(baseline.path);
        if (currentHash !== baseline.hash) {
          changes.push({ type: 'modified', path: baseline.path, hash: currentHash });
        }
      }
    }

    // Check for added files
    for (const currentFile of currentFiles) {
      if (!baselineMap.has(currentFile)) {
        const hash = await this.hashFile(currentFile);
        changes.push({ type: 'added', path: currentFile, hash });
      }
    }

    return changes;
  }

  /**
   * Groups file changes by module (based on directory structure).
   */
  groupChangesByModule(changes: FileChange[]): ModuleChanges[] {
    const moduleMap = new Map<string, ModuleChanges>();

    for (const change of changes) {
      const moduleName = this.extractModuleName(change.path);
      if (!moduleName) continue;

      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, {
          moduleName,
          directoryPath: this.extractDirectoryPath(change.path),
          changes: []
        });
      }
      moduleMap.get(moduleName)!.changes.push(change);
    }

    return Array.from(moduleMap.values());
  }

  private extractModuleName(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    if (parts[0] !== 'src' || parts.length < 3) return null;

    const topLevel = parts[1];

    if (topLevel === 'core' && parts.length >= 3) {
      const subModule = parts[2];
      return `Core: ${subModule.charAt(0).toUpperCase() + subModule.slice(1)}`;
    }

    if (topLevel === 'cli') return 'CLI';
    if (topLevel === 'contracts') return 'Contracts';
    if (topLevel === 'domain') return 'Domain';

    return topLevel.charAt(0).toUpperCase() + topLevel.slice(1);
  }

  private extractDirectoryPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts[0] === 'src' && parts.length >= 2) {
      return `src/${parts[1]}`;
    }
    return 'src';
  }

  /**
   * Lists all TypeScript / TSX source files in the project.
   * Discovers real top-level roots present on disk (including server/, types/).
   * Excludes tests, node_modules, .ai, etc.
   */
  async listAllSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    const dirsToScan: string[] = [];
    try {
      const rootEntries = await this.workspace.listEntries('.');
      const rootDirs = rootEntries.filter(e => e.endsWith('/')).map(e => e.slice(0, -1));
      // Prefer known code roots that actually exist — do not hard-exclude server/.
      const preferredRoots = [
        'src', 'app', 'lib', 'components', 'pages', 'routes', 'scripts',
        'server', 'types', 'config',
      ];
      for (const r of preferredRoots) {
        if (rootDirs.includes(r)) dirsToScan.push(r);
      }
    } catch { /* ignore */ }
    if (dirsToScan.length === 0) dirsToScan.push('.');

    while (dirsToScan.length > 0) {
      const dir = dirsToScan.pop()!;
      try {
        const entries = await this.workspace.listEntries(dir);
        for (const entry of entries) {
          if (entry.endsWith('/')) {
            const dirName = entry.slice(0, -1);
            if ([
              'node_modules', '__tests__', 'tests', '.ai', 'dist', 'build',
              '.next', 'coverage',
            ].includes(dirName)) {
              continue;
            }
            const childDir = dir === '.' ? dirName : `${dir}/${dirName}`;
            dirsToScan.push(childDir.replace(/\\/g, '/'));
          } else if (isStructuralSourceFile(entry)) {
            const fullPath = dir === '.' ? entry : `${dir}/${entry}`;
            files.push(fullPath.replace(/\\/g, '/'));
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

/** Production source files eligible for the structural graph. */
export function isStructuralSourceFile(fileName: string): boolean {
  const lower = fileName.toLowerCase().replace(/\\/g, '/');
  const base = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  if (base.endsWith('.d.ts')) return false;
  if (base.endsWith('.test.ts') || base.endsWith('.test.tsx')) return false;
  if (base.endsWith('.spec.ts') || base.endsWith('.spec.tsx')) return false;
  return base.endsWith('.ts') || base.endsWith('.tsx');
}
