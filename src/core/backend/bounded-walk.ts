import { promises as fs } from 'fs';
import * as path from 'path';
import { BackendVerificationLimits } from '../../domain/backend-verification-limits';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'coverage', 'graphify-out']);

export async function boundedWalk(input: {
  readonly root: string;
  readonly limits: BackendVerificationLimits;
  readonly extensions: ReadonlyArray<string>;
  readonly fileNameHint?: RegExp;
}): Promise<string[]> {
  const out: string[] = [];
  await walk(input.root, input.root, out, input);
  return out;
}

async function walk(
  root: string,
  dir: string,
  out: string[],
  input: {
    readonly limits: BackendVerificationLimits;
    readonly extensions: ReadonlyArray<string>;
    readonly fileNameHint?: RegExp;
  },
): Promise<void> {
  if (out.length >= input.limits.maxDiscoveryFiles) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= input.limits.maxDiscoveryFiles) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out, input);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!input.extensions.includes(ext)) continue;
    if (input.fileNameHint && !input.fileNameHint.test(entry.name)) continue;
    out.push(full);
  }
}

export async function readPackageJson(workspacePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function frameworksFromPackage(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) return [];
  const deps = {
    ...(asRecord(pkg.dependencies)),
    ...(asRecord(pkg.devDependencies)),
  };
  const found: string[] = [];
  if (deps['@nestjs/core'] || deps['@nestjs/common']) found.push('nestjs');
  if (deps.express) found.push('express');
  if (deps.fastify) found.push('fastify');
  if (deps.next) found.push('nextjs');
  return found;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
