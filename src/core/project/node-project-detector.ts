import * as fs from 'fs';
import * as path from 'path';
import { ProjectDetector, ProjectDetectorOptions } from '../../contracts/project-detector';
import {
  freezeProjectProfile,
  PackageManager,
  ProjectDetectionExtension,
  ProjectProfile,
  ProjectType,
  unknownProjectProfile,
} from '../../domain/project-profile';
import { SkillDomain } from '../../domain/skill';
import {
  buildDependencyInventory,
  extractFrameworkVersionInfo,
} from '../version/dependency-inventory';

const NEXT_CONFIG_FILES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'next.config.cjs',
];

const TESTING_PACKAGES: ReadonlyArray<{ pkg: string; tool: string }> = [
  { pkg: 'jest', tool: 'jest' },
  { pkg: 'vitest', tool: 'vitest' },
  { pkg: 'mocha', tool: 'mocha' },
  { pkg: 'playwright', tool: 'playwright' },
  { pkg: '@playwright/test', tool: 'playwright' },
  { pkg: 'cypress', tool: 'cypress' },
  { pkg: '@testing-library/react', tool: 'testing-library' },
];

interface PackageJsonLite {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * Deterministic detector for Node, Next.js, and NestJS projects.
 * Enriches ProjectProfile with dependency inventory and framework versions (Milestone E).
 */
export class NodeProjectDetector implements ProjectDetector {
  private readonly extensions: ReadonlyArray<ProjectDetectionExtension>;

  constructor(options: ProjectDetectorOptions = {}) {
    this.extensions = options.extensions ?? [];
  }

  async detect(workspaceRoot: string): Promise<ProjectProfile> {
    const root = path.resolve(workspaceRoot);
    if (!isDirectory(root)) {
      return unknownProjectProfile(root);
    }

    const pkg = readPackageJson(root);
    const hasPackageJson = pkg !== null;

    const isNext = hasPackageJson && isNextJs(root, pkg);
    const isNest = hasPackageJson && isNestJs(root, pkg);

    const detectedFrameworks: string[] = [];
    const detectedDomains: SkillDomain[] = [];
    const capabilities: string[] = [];

    if (isNext) {
      detectedFrameworks.push('nextjs');
      detectedDomains.push('frontend');
      capabilities.push('frontend', 'nextjs');
    }

    if (isNest) {
      detectedFrameworks.push('nestjs');
      detectedDomains.push('backend');
      capabilities.push('backend', 'nestjs');
    }

    const languages = detectLanguages(root, pkg);
    const packageManager = detectPackageManager(root);
    const availableTestingTools = detectTestingTools(pkg);

    if (availableTestingTools.length > 0) {
      detectedDomains.push('testing');
      capabilities.push('testing');
      for (const tool of availableTestingTools) {
        capabilities.push(`testing.${tool}`);
      }
    }

    const dependencies = buildDependencyInventory(root, packageManager);
    const frameworkVersions = extractFrameworkVersionInfo(unique(detectedFrameworks), dependencies);

    const projectType = resolveProjectType(isNext, isNest);

    let profile = freezeProjectProfile({
      workspaceRoot: root,
      projectType,
      detectedFrameworks: unique(detectedFrameworks),
      frameworkVersions,
      dependencies,
      languages: unique(languages),
      packageManager,
      availableTestingTools: unique(availableTestingTools),
      detectedDomains: unique(detectedDomains),
      capabilities: unique(capabilities),
    });

    for (const extension of this.extensions) {
      const contribution = await extension.contribute(root, profile);
      const combinedFrameworks = unique([
        ...profile.detectedFrameworks,
        ...(contribution.detectedFrameworks ?? []),
      ]);
      const combinedDependencies = contribution.dependencies ?? profile.dependencies ?? [];
      const updatedFrameworkVersions = extractFrameworkVersionInfo(combinedFrameworks, combinedDependencies);

      profile = freezeProjectProfile({
        ...profile,
        languages: unique([...profile.languages, ...(contribution.languages ?? [])]),
        availableTestingTools: unique([...profile.availableTestingTools, ...(contribution.testingTools ?? [])]),
        capabilities: unique([...profile.capabilities, ...(contribution.capabilities ?? [])]),
        detectedDomains: unique([...profile.detectedDomains, ...(contribution.detectedDomains ?? [])]),
        detectedFrameworks: combinedFrameworks,
        frameworkVersions: updatedFrameworkVersions,
        dependencies: combinedDependencies,
      });
    }

    return profile;
  }
}

function resolveProjectType(isNext: boolean, isNest: boolean): ProjectType {
  if (isNext && isNest) return 'fullstack';
  if (isNext) return 'frontend';
  if (isNest) return 'backend';
  return 'unknown';
}

function isNextJs(root: string, pkg: PackageJsonLite): boolean {
  const hasConfig = NEXT_CONFIG_FILES.some(file => exists(path.join(root, file)));
  const hasNextDep = hasDependency(pkg, 'next');
  const hasApp = isDirectory(path.join(root, 'app'));
  const hasPages = isDirectory(path.join(root, 'pages'));
  return hasConfig || hasNextDep || ((hasApp || hasPages) && hasNextDep);
}

function isNestJs(root: string, pkg: PackageJsonLite): boolean {
  const hasNestCli = exists(path.join(root, 'nest-cli.json'));
  const hasNestDep = hasDependency(pkg, '@nestjs/core') || hasDependency(pkg, '@nestjs/common');
  const hasModules = isDirectory(path.join(root, 'src', 'modules'));
  return hasNestCli || hasNestDep || (hasModules && hasNestDep);
}

function detectLanguages(root: string, pkg: PackageJsonLite | null): string[] {
  const languages: string[] = [];
  if (exists(path.join(root, 'tsconfig.json')) || hasDependency(pkg, 'typescript')) {
    languages.push('typescript');
  }
  if (pkg !== null) {
    languages.push('javascript');
  }
  return languages;
}

function detectPackageManager(root: string): PackageManager {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'package-lock.json'))) return 'npm';
  if (exists(path.join(root, 'package.json'))) return 'npm';
  return 'unknown';
}

function detectTestingTools(pkg: PackageJsonLite | null): string[] {
  if (!pkg) return [];
  const tools: string[] = [];
  for (const entry of TESTING_PACKAGES) {
    if (hasDependency(pkg, entry.pkg)) {
      tools.push(entry.tool);
    }
  }
  return tools;
}

function readPackageJson(root: string): PackageJsonLite | null {
  const filePath = path.join(root, 'package.json');
  if (!exists(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PackageJsonLite;
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasDependency(pkg: PackageJsonLite | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function exists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function unique<T>(items: ReadonlyArray<T>): T[] {
  return Array.from(new Set(items));
}
