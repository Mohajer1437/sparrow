/**
 * Deterministic dependency inventory builder.
 * Extracts and normalizes declared and resolved dependency versions from manifests and lockfiles.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyCategory,
  DependencyType,
  FrameworkVersionInfo,
  freezeFrameworkVersionInfo,
  freezeProjectDependency,
  ProjectDependency,
  VersionSource,
} from '../../domain/version-intelligence';
import { inspectWorkspaceLockfiles } from './lockfile-parser';

interface PackageJsonStructure {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const KNOWN_TECHNOLOGY_ALIASES: ReadonlyArray<{ readonly match: RegExp; readonly normalizedName: string; readonly category: DependencyCategory }> = [
  { match: /^next(?:\.?js)?$/i, normalizedName: 'nextjs', category: 'framework' },
  { match: /^(?:@nestjs\/(?:core|common|microservices|platform-express|platform-fastify|websockets|testing)|nest(?:\.?js)?)$/i, normalizedName: 'nestjs', category: 'framework' },
  { match: /^(?:@prisma\/client|prisma)$/i, normalizedName: 'prisma', category: 'orm' },
  { match: /^typeorm$/i, normalizedName: 'typeorm', category: 'orm' },
  { match: /^sequelize$/i, normalizedName: 'sequelize', category: 'orm' },
  { match: /^drizzle-orm$/i, normalizedName: 'drizzle', category: 'orm' },
  { match: /^mongoose$/i, normalizedName: 'mongoose', category: 'orm' },
  { match: /^knex$/i, normalizedName: 'knex', category: 'orm' },
  { match: /^express$/i, normalizedName: 'express', category: 'framework' },
  { match: /^fastify$/i, normalizedName: 'fastify', category: 'framework' },
  { match: /^react(?:-dom)?$/i, normalizedName: 'react', category: 'framework' },
  { match: /^vue$/i, normalizedName: 'vue', category: 'framework' },
  { match: /^@angular\/core$/i, normalizedName: 'angular', category: 'framework' },
  { match: /^svelte$/i, normalizedName: 'svelte', category: 'framework' },
  { match: /^remix$/i, normalizedName: 'remix', category: 'framework' },
  { match: /^nuxt$/i, normalizedName: 'nuxt', category: 'framework' },
  { match: /^astro$/i, normalizedName: 'astro', category: 'framework' },
  { match: /^typescript$/i, normalizedName: 'typescript', category: 'runtime' },
  { match: /^jest$/i, normalizedName: 'jest', category: 'testing' },
  { match: /^vitest$/i, normalizedName: 'vitest', category: 'testing' },
  { match: /^mocha$/i, normalizedName: 'mocha', category: 'testing' },
  { match: /^(?:@playwright\/test|playwright)$/i, normalizedName: 'playwright', category: 'testing' },
  { match: /^cypress$/i, normalizedName: 'cypress', category: 'testing' },
  { match: /^@testing-library\//i, normalizedName: 'testing-library', category: 'testing' },
  { match: /^supertest$/i, normalizedName: 'supertest', category: 'testing' },
  { match: /^pg$/i, normalizedName: 'postgres', category: 'database' },
  { match: /^mysql2?$/i, normalizedName: 'mysql', category: 'database' },
  { match: /^(?:better-)?sqlite3$/i, normalizedName: 'sqlite', category: 'database' },
  { match: /^(?:ioredis|redis)$/i, normalizedName: 'redis', category: 'database' },
  { match: /^mongodb$/i, normalizedName: 'mongodb', category: 'database' },
  { match: /^tailwindcss$/i, normalizedName: 'tailwindcss', category: 'ui' },
  { match: /^vite$/i, normalizedName: 'vite', category: 'build' },
  { match: /^webpack$/i, normalizedName: 'webpack', category: 'build' },
  { match: /^turbopack$/i, normalizedName: 'turbopack', category: 'build' },
  { match: /^esbuild$/i, normalizedName: 'esbuild', category: 'build' },
  { match: /^rollup$/i, normalizedName: 'rollup', category: 'build' },
  { match: /^tsup$/i, normalizedName: 'tsup', category: 'build' },
  { match: /^eslint$/i, normalizedName: 'eslint', category: 'lint' },
  { match: /^prettier$/i, normalizedName: 'prettier', category: 'lint' },
  { match: /^biome$/i, normalizedName: 'biome', category: 'lint' },
];

/**
 * Categorizes a dependency name into a standard category.
 */
export function categorizeDependency(pkgName: string): DependencyCategory {
  for (const alias of KNOWN_TECHNOLOGY_ALIASES) {
    if (alias.match.test(pkgName)) {
      return alias.category;
    }
  }

  const lower = pkgName.toLowerCase();
  if (lower.includes('test') || lower.includes('mock') || lower.includes('chai') || lower.includes('sinon')) {
    return 'testing';
  }
  if (lower.includes('lint') || lower.includes('format') || lower.includes('stylelint')) {
    return 'lint';
  }
  if (lower.includes('ui') || lower.includes('icon') || lower.includes('theme') || lower.includes('css')) {
    return 'ui';
  }
  if (lower.includes('build') || lower.includes('bundle') || lower.includes('transpile') || lower.includes('plugin')) {
    return 'build';
  }
  if (lower.includes('database') || lower.includes('driver') || lower.includes('client')) {
    return 'database';
  }

  return 'utility';
}

/**
 * Normalizes a dependency package name to a canonical technology identifier.
 */
export function normalizeTechnologyName(pkgName: string): string {
  for (const alias of KNOWN_TECHNOLOGY_ALIASES) {
    if (alias.match.test(pkgName)) {
      return alias.normalizedName;
    }
  }
  return pkgName.toLowerCase().replace(/[@/\\_-]/g, '-');
}

/**
 * Builds a deterministic dependency inventory for the given workspace.
 */
export function buildDependencyInventory(
  workspaceRoot: string,
  packageManager?: string,
): ReadonlyArray<ProjectDependency> {
  const pkgJsonPath = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    return Object.freeze([]);
  }

  let pkg: PackageJsonStructure;
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf-8');
    pkg = JSON.parse(raw) as PackageJsonStructure;
  } catch {
    return Object.freeze([]);
  }

  if (!pkg || typeof pkg !== 'object') {
    return Object.freeze([]);
  }

  const lockfileVersions = inspectWorkspaceLockfiles(workspaceRoot, packageManager);
  const result: ProjectDependency[] = [];
  const seenPackages = new Set<string>();

  const sections: Array<{ readonly key: keyof PackageJsonStructure; readonly type: DependencyType }> = [
    { key: 'dependencies', type: 'dependencies' },
    { key: 'devDependencies', type: 'devDependencies' },
    { key: 'peerDependencies', type: 'peerDependencies' },
    { key: 'optionalDependencies', type: 'optionalDependencies' },
  ];

  for (const { key, type } of sections) {
    const depsObj = pkg[key];
    if (depsObj && typeof depsObj === 'object') {
      for (const [name, declaredVer] of Object.entries(depsObj)) {
        if (!name || typeof declaredVer !== 'string' || seenPackages.has(name)) {
          continue;
        }
        seenPackages.add(name);

        const lockEntry = lockfileVersions.get(name);
        const resolvedVer = lockEntry?.resolvedVersion;
        const versionSource: VersionSource = resolvedVer
          ? 'lockfile'
          : declaredVer
          ? 'manifest'
          : 'unknown';

        const dependency = freezeProjectDependency({
          name,
          normalizedName: normalizeTechnologyName(name),
          category: categorizeDependency(name),
          declaredVersion: declaredVer.trim(),
          resolvedVersion: resolvedVer?.trim(),
          versionSource,
          dependencyType: type,
        });

        result.push(dependency);
      }
    }
  }

  // Sort deterministically by normalizedName then name
  result.sort((a, b) => {
    const cmp = a.normalizedName.localeCompare(b.normalizedName);
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
  });

  return Object.freeze(result);
}

/**
 * Extracts FrameworkVersionInfo records for detected frameworks from the dependency inventory.
 */
export function extractFrameworkVersionInfo(
  detectedFrameworks: ReadonlyArray<string>,
  dependencies: ReadonlyArray<ProjectDependency>,
): ReadonlyArray<FrameworkVersionInfo> {
  const result: FrameworkVersionInfo[] = [];

  for (const framework of detectedFrameworks) {
    const match = dependencies.find(dep => dep.normalizedName === framework || dep.name === framework);
    if (match) {
      result.push(
        freezeFrameworkVersionInfo({
          name: framework,
          declaredVersion: match.declaredVersion,
          resolvedVersion: match.resolvedVersion,
          versionSource: match.versionSource,
        }),
      );
    } else {
      result.push(
        freezeFrameworkVersionInfo({
          name: framework,
          declaredVersion: undefined,
          resolvedVersion: undefined,
          versionSource: 'unknown',
        }),
      );
    }
  }

  return Object.freeze(result);
}
