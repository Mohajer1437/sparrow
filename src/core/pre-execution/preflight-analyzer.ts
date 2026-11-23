/**
 * G.2: DefaultPreflightAnalyzer — Project Inspection
 * FIXED: Uses rootPath from constructor, not workspace.rootPath
 */

import { PreflightAnalyzer, ProjectInspection, FeasibilityAnalysis, PreflightResult, FrameworkType, RuntimeType, PackageManagerType } from '../../contracts/preflight-analyzer';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { Workspace } from '../../contracts/workspace';
import { canonicalizeWorkspaceRoot } from '../workspace/workspace-paths';

const FRAMEWORK_SIGNATURES: ReadonlyMap<FrameworkType, ReadonlyArray<string>> = new Map<FrameworkType, ReadonlyArray<string>>([
  ['nextjs', Object.freeze(['next', 'nextjs'])],
  ['react', Object.freeze(['react', 'react-dom'])],
  ['vue', Object.freeze(['vue', 'nuxt'])],
  ['angular', Object.freeze(['@angular/core', '@angular/cli'])],
  ['svelte', Object.freeze(['svelte', 'sveltekit'])],
  ['express', Object.freeze(['express'])],
  ['fastify', Object.freeze(['fastify'])],
  ['nestjs', Object.freeze(['@nestjs/core'])],
]);

export class DefaultPreflightAnalyzer implements PreflightAnalyzer {
  private readonly rootPath: string;

  constructor(
    private readonly workspace: Workspace,
    rootPath: string,
  ) {
    this.rootPath = canonicalizeWorkspaceRoot(rootPath);
  }

  async analyze(intent: TaskIntent): Promise<PreflightResult> {
    const inspection = await this.inspectProject();
    const feasibility = await this.analyzeFeasibility(intent, inspection);
    const warnings = this.generateWarnings(intent, inspection);
    const recommendations = this.generateRecommendations(intent, inspection);

    return Object.freeze({
      inspection,
      feasibility,
      warnings: Object.freeze(warnings),
      recommendations: Object.freeze(recommendations),
    });
  }

  private async inspectProject(): Promise<ProjectInspection> {
    let packageJson: any = null;
    try {
      const content = await this.workspace.readFile('package.json');
      packageJson = JSON.parse(content);
    } catch (error) {}

    const frameworkDetection = this.detectAllFrameworks(packageJson);
    const framework = frameworkDetection.primary;
    const detectedFrameworks = Object.freeze(frameworkDetection.all);
    const runtime = await this.detectRuntime();
    const packageManager = await this.detectPackageManager();
    const hasTypeScript = await this.hasFile('tsconfig.json');
    const hasTests = await this.hasDirectory('tests') ||
                     await this.hasDirectory('__tests__') ||
                     await this.hasDirectory('test');
    const hasESLint = await this.hasFile('.eslintrc.js') ||
                      await this.hasFile('.eslintrc.json') ||
                      await this.hasFile('eslint.config.js');
    const hasPrettier = await this.hasFile('.prettierrc') ||
                        await this.hasFile('.prettierrc.json') ||
                        await this.hasFile('prettier.config.js');
    const structure = await this.scanStructure();

    const dependencies = packageJson?.dependencies
      ? Object.keys(packageJson.dependencies)
      : [];

    const scripts = new Map<string, string>();
    if (packageJson?.scripts) {
      for (const [key, value] of Object.entries(packageJson.scripts)) {
        scripts.set(key, value as string);
      }
    }

    return Object.freeze({
      framework,
      detectedFrameworks,
      runtime,
      packageManager,
      hasTypeScript,
      hasTests,
      hasESLint,
      hasPrettier,
      structure: Object.freeze(structure),
      dependencies: Object.freeze(dependencies),
      scripts: Object.freeze(scripts),
      inspectedAt: new Date().toISOString(),
    });
  }

  private detectAllFrameworks(packageJson: any): { primary: FrameworkType; all: FrameworkType[] } {
    if (!packageJson) return { primary: 'unknown', all: [] };
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const detected: FrameworkType[] = [];
    for (const [framework, signatures] of FRAMEWORK_SIGNATURES.entries()) {
      for (const sig of signatures) {
        if (allDeps[sig] && !detected.includes(framework)) {
          detected.push(framework);
        }
      }
    }
    return {
      primary: detected[0] ?? 'unknown',
      all: detected,
    };
  }

  private detectFramework(packageJson: any): FrameworkType {
    return this.detectAllFrameworks(packageJson).primary;
  }

  private async detectRuntime(): Promise<RuntimeType> {
    if (await this.hasFile('deno.json')) return 'deno';
    if (await this.hasFile('bun.lockb')) return 'bun';
    return 'node';
  }

  private async detectPackageManager(): Promise<PackageManagerType> {
    if (await this.hasFile('yarn.lock')) return 'yarn';
    if (await this.hasFile('pnpm-lock.yaml')) return 'pnpm';
    if (await this.hasFile('bun.lockb')) return 'bun';
    if (await this.hasFile('package-lock.json')) return 'npm';
    return 'unknown';
  }

  private async hasFile(fileName: string): Promise<boolean> {
    try {
      return await this.workspace.exists(fileName);
    } catch {
      return false;
    }
  }

  private async hasDirectory(dirName: string): Promise<boolean> {
    try {
      return await this.workspace.isDirectory(dirName);
    } catch {
      return false;
    }
  }

  private async scanStructure(): Promise<string[]> {
    const keyDirs = ['src', 'app', 'components', 'lib', 'utils', 'types', 'tests', '__tests__', 'test'];
    const found: string[] = [];
    for (const dir of keyDirs) {
      if (await this.hasDirectory(dir)) {
        found.push(dir);
      }
    }
    return found;
  }

  private async analyzeFeasibility(
    intent: TaskIntent,
    inspection: ProjectInspection,
  ): Promise<FeasibilityAnalysis> {
    const missing: string[] = [];
    const blockers: string[] = [];

    if (inspection.dependencies.length === 0 && intent.type !== 'INVESTIGATION') {
      missing.push('package.json not found or has no dependencies');
    }

    if (intent.initialScope.length > 0) {
      for (const file of intent.initialScope) {
        try {
          const exists = await this.workspace.exists(file);
          if (!exists) missing.push(`Target file not found: ${file}`);
        } catch {
          missing.push(`Target file not found: ${file}`);
        }
      }
    }

    const feasible = missing.length === 0 && blockers.length === 0;

    return Object.freeze({
      feasible,
      reason: feasible ? undefined : 'Missing requirements or blockers detected',
      missingRequirements: Object.freeze(missing),
      blockers: Object.freeze(blockers),
    });
  }

  private generateWarnings(intent: TaskIntent, inspection: ProjectInspection): string[] {
    const warnings: string[] = [];
    if (!inspection.hasTests) warnings.push('Project has no test directory');
    if (!inspection.hasESLint) warnings.push('Project has no ESLint configuration');
    if (!inspection.hasPrettier) warnings.push('Project has no Prettier configuration');
    if (inspection.packageManager === 'unknown') warnings.push('Package manager could not be detected');
    if (inspection.framework === 'unknown') warnings.push('Framework could not be detected');
    return warnings;
  }

  private generateRecommendations(intent: TaskIntent, inspection: ProjectInspection): string[] {
    const recommendations: string[] = [];
    if (!inspection.hasTests && intent.type === 'FEATURE') {
      recommendations.push('Consider adding tests for the new feature');
    }
    return recommendations;
  }
}
