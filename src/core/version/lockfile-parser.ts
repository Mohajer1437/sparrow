/**
 * Deterministic lockfile parsers for package-lock.json, yarn.lock, and pnpm-lock.yaml.
 * Resolves exact installed versions of project dependencies without executing external tools.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ResolvedLockfileEntry {
  readonly resolvedVersion: string;
  readonly lockfileName: 'package-lock.json' | 'yarn.lock' | 'pnpm-lock.yaml';
}

/**
 * Inspects lockfiles in a workspace root and returns a map of package names to resolved versions.
 */
export function inspectWorkspaceLockfiles(
  workspaceRoot: string,
  preferredPm?: string,
): Map<string, ResolvedLockfileEntry> {
  const result = new Map<string, ResolvedLockfileEntry>();

  const lockfileOrder: Array<{ name: 'package-lock.json' | 'yarn.lock' | 'pnpm-lock.yaml'; parser: (content: string) => Map<string, string> }> = [];

  if (preferredPm === 'pnpm') {
    lockfileOrder.push({ name: 'pnpm-lock.yaml', parser: parsePnpmLock });
  } else if (preferredPm === 'yarn') {
    lockfileOrder.push({ name: 'yarn.lock', parser: parseYarnLock });
  } else if (preferredPm === 'npm') {
    lockfileOrder.push({ name: 'package-lock.json', parser: parsePackageLock });
  }

  // Add all in deterministic fallback order
  const standard: Array<{ name: 'package-lock.json' | 'yarn.lock' | 'pnpm-lock.yaml'; parser: (content: string) => Map<string, string> }> = [
    { name: 'package-lock.json', parser: parsePackageLock },
    { name: 'pnpm-lock.yaml', parser: parsePnpmLock },
    { name: 'yarn.lock', parser: parseYarnLock },
  ];

  for (const item of standard) {
    if (!lockfileOrder.some(existing => existing.name === item.name)) {
      lockfileOrder.push(item);
    }
  }

  for (const { name, parser } of lockfileOrder) {
    const lockfilePath = path.join(workspaceRoot, name);
    try {
      if (fs.existsSync(lockfilePath)) {
        const content = fs.readFileSync(lockfilePath, 'utf-8');
        const parsed = parser(content);
        for (const [pkg, version] of parsed.entries()) {
          if (!result.has(pkg)) {
            result.set(pkg, { resolvedVersion: version, lockfileName: name });
          }
        }
        // If we found entries in the primary lockfile, break early to avoid mixing versions
        if (result.size > 0) {
          break;
        }
      }
    } catch {
      // Ignore unparseable lockfiles and proceed
    }
  }

  return result;
}

/**
 * Parses package-lock.json (supports lockfileVersion 1, 2, and 3).
 */
export function parsePackageLock(content: string): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const json = JSON.parse(content);
    if (!json || typeof json !== 'object') return result;

    // lockfileVersion 2/3 packages section
    if (json.packages && typeof json.packages === 'object') {
      for (const [key, pkgData] of Object.entries(json.packages)) {
        if (!key || key === '' || typeof pkgData !== 'object' || !pkgData) continue;
        const version = (pkgData as { version?: string }).version;
        if (typeof version === 'string' && version.trim()) {
          const pkgName = extractPackageNameFromKey(key);
          if (pkgName && !result.has(pkgName)) {
            result.set(pkgName, version.trim());
          }
        }
      }
    }

    // lockfileVersion 1/2 dependencies section
    if (json.dependencies && typeof json.dependencies === 'object') {
      for (const [pkgName, depData] of Object.entries(json.dependencies)) {
        if (typeof depData !== 'object' || !depData) continue;
        const version = (depData as { version?: string }).version;
        if (typeof version === 'string' && version.trim() && !result.has(pkgName)) {
          result.set(pkgName, version.trim());
        }
      }
    }
  } catch {
    // Malformed JSON
  }
  return result;
}

function extractPackageNameFromKey(key: string): string | null {
  // e.g. "node_modules/next" -> "next"
  // e.g. "node_modules/@nestjs/core" -> "@nestjs/core"
  // e.g. "node_modules/foo/node_modules/bar" -> "bar"
  const normalized = key.replace(/\\/g, '/');
  const lastIndex = normalized.lastIndexOf('node_modules/');
  if (lastIndex === -1) {
    // Might be direct name if key is package name
    return normalized.startsWith('.') ? null : normalized;
  }
  return normalized.substring(lastIndex + 'node_modules/'.length);
}

/**
 * Parses yarn.lock (supports v1 classic and v2/v3 berry formats).
 */
export function parseYarnLock(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');

  let currentPackages: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }

    // Header line (not indented)
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      currentPackages = [];
      // Example: "next@^14.2.0", next@14.2.35:
      // Example: "@nestjs/core@^10.0.0":
      const cleaned = line.trim().replace(/:$/, '');
      const parts = cleaned.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
      for (const part of parts) {
        const pkgName = extractYarnPackageName(part);
        if (pkgName) {
          currentPackages.push(pkgName);
        }
      }
      continue;
    }

    // Indented properties
    const trimmed = line.trim();
    if (currentPackages.length > 0) {
      // version "14.2.35" or version: 14.2.35 or version: "14.2.35"
      const versionMatch = /^version(?::|\s+)\s*"?([^"\s]+)"?/.exec(trimmed);
      if (versionMatch) {
        const version = versionMatch[1];
        for (const pkg of currentPackages) {
          if (!result.has(pkg)) {
            result.set(pkg, version);
          }
        }
        currentPackages = [];
      }
    }
  }

  return result;
}

function extractYarnPackageName(descriptor: string): string | null {
  // e.g. "next@^14.2.0" -> "next"
  // e.g. "@nestjs/core@npm:^10.0.0" -> "@nestjs/core"
  const atIndex = descriptor.lastIndexOf('@');
  if (atIndex <= 0) return null;
  return descriptor.substring(0, atIndex);
}

/**
 * Parses pnpm-lock.yaml.
 */
export function parsePnpmLock(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');

  let inPackagesSection = false;
  let inImportersSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    if (line.startsWith('packages:')) {
      inPackagesSection = true;
      inImportersSection = false;
      continue;
    }

    if (line.startsWith('importers:') || line.startsWith('dependencies:')) {
      inImportersSection = true;
      inPackagesSection = false;
      continue;
    }

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inPackagesSection = false;
      inImportersSection = false;
      continue;
    }

    if (inPackagesSection) {
      // e.g. "  /next@14.2.35(react-dom@18.3.0)(react@18.3.0):"
      // or "  next@14.2.35:"
      // or "  /@nestjs/core@10.3.0:"
      // or "  '/next@14.2.35':"
      const cleanLine = trimmed.replace(/^['"]/, '').replace(/^\//, '');
      const pkgMatch = /^(@?[^@\s:'"]+)@([0-9A-Za-z.-]+)(?:\(.*?\)|\(.*?\)\(.*?\))?['"]?:/.exec(cleanLine);
      if (pkgMatch) {
        const pkgName = pkgMatch[1];
        const version = pkgMatch[2];
        if (!result.has(pkgName)) {
          result.set(pkgName, version);
        }
      }
    }

    if (inImportersSection) {
      // e.g. "      version: 14.2.35" or "      next: 14.2.35"
      const depMatch = /^\s{4,6}(@?[a-zA-Z0-9._-]+):\s*['"]?([0-9A-Za-z.-]+)['"]?$/.exec(line);
      if (depMatch) {
        const pkgName = depMatch[1];
        const version = depMatch[2];
        if (!result.has(pkgName) && /^[0-9]/.test(version)) {
          result.set(pkgName, version);
        }
      }
    }
  }

  return result;
}
