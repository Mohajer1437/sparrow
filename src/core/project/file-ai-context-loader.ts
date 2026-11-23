import * as fs from 'fs';
import * as path from 'path';
import { AiContextLoader } from '../../contracts/ai-context';
import {
  AI_CONTEXT_FILE_NAMES,
  AiContextDiscoveredFile,
  AiContextDiscovery,
  AiContextFileMetadata,
  AiContextFileName,
  freezeAiContextDiscovery,
} from '../../domain/ai-context';
import {
  canonicalizeWorkspaceRoot,
  isPathInsideRoot,
  resolveWorkspacePath,
  toPosixRelative,
} from '../workspace/workspace-paths';

const FILE_EXTENSIONS = ['', '.md', '.json'];
const NESTED_DISCOVER_EXTENSIONS = new Set(['.md', '.txt']);
const SKIP_AI_DIRS = new Set([
  'audit', 'logs', 'pipeline', 'backups', 'tmp', 'cache', 'sessions', 'node_modules', '.git',
]);
const MAX_DISCOVERED_FILES = 80;
const MAX_DISCOVER_DEPTH = 4;

/**
 * Discovers `.ai` and known future context files.
 * Nested listing is metadata-only; content is loaded by the gatherer.
 */
export class FileAiContextLoader implements AiContextLoader {
  async discover(workspaceRoot: string): Promise<AiContextDiscovery> {
    const root = canonicalizeWorkspaceRoot(workspaceRoot);
    const aiRoot = path.join(root, '.ai');
    const exists = isDirectory(aiRoot);

    const files: AiContextFileMetadata[] = AI_CONTEXT_FILE_NAMES.map(name => {
      if (!exists) {
        return Object.freeze({
          name,
          relativePath: toPosixRelative(path.join('.ai', name)),
          exists: false,
        });
      }
      const resolved = resolveContextFile(aiRoot, name);
      if (!resolved) {
        return Object.freeze({
          name,
          relativePath: toPosixRelative(path.join('.ai', name)),
          exists: false,
        });
      }
      return Object.freeze({
        ...resolved,
        relativePath: toPosixRelative(resolved.relativePath),
      });
    });

    const discoveredFiles = exists ? listNestedAiFiles(root, aiRoot) : [];

    return freezeAiContextDiscovery({
      workspaceRoot: root,
      rootPath: aiRoot,
      exists,
      files,
      discoveredFiles,
    });
  }

  async loadRaw(workspaceRoot: string, name: AiContextFileName): Promise<string | null> {
    const root = canonicalizeWorkspaceRoot(workspaceRoot);
    const aiRoot = path.join(root, '.ai');
    if (!isDirectory(aiRoot)) return null;

    const resolved = resolveContextFile(aiRoot, name);
    if (!resolved || !resolved.exists || resolved.isDirectory) return null;

    try {
      const target = resolveWorkspacePath(root, resolved.relativePath);
      return fs.readFileSync(target.absolute, 'utf-8');
    } catch {
      return null;
    }
  }

  async loadRawPath(workspaceRoot: string, relativePath: string): Promise<string | null> {
    const root = canonicalizeWorkspaceRoot(workspaceRoot);
    try {
      const resolved = resolveWorkspacePath(root, relativePath);
      const posix = resolved.relative;
      if (posix !== '.ai' && !posix.startsWith('.ai/')) {
        return null;
      }
      const stats = fs.statSync(resolved.absolute);
      if (!stats.isFile()) return null;
      return fs.readFileSync(resolved.absolute, 'utf-8');
    } catch {
      return null;
    }
  }
}

function resolveContextFile(aiRoot: string, name: AiContextFileName): AiContextFileMetadata | null {
  for (const ext of FILE_EXTENSIONS) {
    const fileName = `${name}${ext}`;
    const absolutePath = path.join(aiRoot, fileName);
    try {
      const stats = fs.statSync(absolutePath);
      return {
        name,
        relativePath: path.join('.ai', fileName),
        exists: true,
        isDirectory: stats.isDirectory(),
        sizeBytes: stats.isFile() ? stats.size : undefined,
        modifiedAt: stats.mtime.toISOString(),
      };
    } catch {
      continue;
    }
  }
  return null;
}

function listNestedAiFiles(workspaceRoot: string, aiRoot: string): AiContextDiscoveredFile[] {
  const found: AiContextDiscoveredFile[] = [];
  walkAi(workspaceRoot, aiRoot, aiRoot, 0, found);
  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found.slice(0, MAX_DISCOVERED_FILES).map(file => Object.freeze(file));
}

function walkAi(
  workspaceRoot: string,
  aiRoot: string,
  current: string,
  depth: number,
  out: AiContextDiscoveredFile[],
): void {
  if (depth > MAX_DISCOVER_DEPTH || out.length >= MAX_DISCOVERED_FILES) return;
  if (!isPathInsideRoot(workspaceRoot, current)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_DISCOVERED_FILES) return;
    if (entry.name.startsWith('.') && entry.name !== '.ai') continue;
    if (entry.isDirectory() && SKIP_AI_DIRS.has(entry.name.toLowerCase())) continue;
    const absolute = path.join(current, entry.name);
    if (!isPathInsideRoot(workspaceRoot, absolute)) continue;
    const relative = toPosixRelative(path.relative(workspaceRoot, absolute));

    if (entry.isDirectory()) {
      walkAi(workspaceRoot, aiRoot, absolute, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!NESTED_DISCOVER_EXTENSIONS.has(ext)) continue;
    try {
      const stats = fs.statSync(absolute);
      out.push({
        relativePath: relative,
        exists: true,
        isDirectory: false,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
