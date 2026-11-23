import * as fs from 'fs';
import * as path from 'path';
import { ProjectFingerprinter } from '../../contracts/context-cache';

const FINGERPRINT_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'nest-cli.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'next.config.cjs',
  path.join('.ai', 'dependencies.md'),
  path.join('.ai', 'dependencies.json'),
];

const FINGERPRINT_DIRS = [
  '.ai',
  path.join('.ai', 'dependencies'),
  'app',
  'pages',
  path.join('src', 'modules'),
];

/**
 * Filesystem fingerprint for cache invalidation.
 * Invalidation occurs when manifests, lockfiles, or .ai/dependencies change.
 */
export class FilesystemProjectFingerprinter implements ProjectFingerprinter {
  async compute(workspaceRoot: string): Promise<string> {
    const root = path.resolve(workspaceRoot);
    const parts: string[] = [root];

    for (const relative of FINGERPRINT_FILES) {
      const target = path.join(root, relative);
      parts.push(statToken(relative, target));
    }

    for (const relative of FINGERPRINT_DIRS) {
      const target = path.join(root, relative);
      parts.push(dirToken(relative, target));
    }

    // Also fingerprint individual files in .ai/dependencies if present
    const depDir = path.join(root, '.ai', 'dependencies');
    if (fs.existsSync(depDir)) {
      try {
        const entries = fs.readdirSync(depDir);
        for (const entry of entries.sort()) {
          const itemPath = path.join(depDir, entry);
          parts.push(statToken(path.posix.join('.ai', 'dependencies', entry), itemPath));
        }
      } catch {
        // Ignore read errors
      }
    }

    return parts.join('|');
  }
}

function statToken(label: string, target: string): string {
  try {
    const stats = fs.statSync(target);
    return `${label}:${stats.mtimeMs}:${stats.size}`;
  } catch {
    return `${label}:missing`;
  }
}

function dirToken(label: string, target: string): string {
  try {
    const stats = fs.statSync(target);
    return `${label}:${stats.isDirectory() ? 'dir' : 'file'}:${stats.mtimeMs}`;
  } catch {
    return `${label}:missing`;
  }
}
