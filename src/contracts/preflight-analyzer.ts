/**
 * G.2: PreflightAnalyzer Contract
 */

import { TaskIntent } from '../domain/pre-execution/intent';

export type FrameworkType =
  | 'nextjs' | 'react' | 'vue' | 'angular' | 'svelte'
  | 'express' | 'fastify' | 'nestjs' | 'unknown';

export type RuntimeType = 'node' | 'deno' | 'bun' | 'unknown';

export type PackageManagerType = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export interface ProjectInspection {
  readonly framework: FrameworkType;
  readonly detectedFrameworks?: ReadonlyArray<string>;
  readonly runtime: RuntimeType;
  readonly packageManager: PackageManagerType;
  readonly hasTypeScript: boolean;
  readonly hasTests: boolean;
  readonly hasESLint: boolean;
  readonly hasPrettier: boolean;
  readonly structure: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly scripts: ReadonlyMap<string, string>;
  readonly inspectedAt: string;
}

export interface FeasibilityAnalysis {
  readonly feasible: boolean;
  readonly reason?: string;
  readonly missingRequirements: ReadonlyArray<string>;
  readonly blockers: ReadonlyArray<string>;
}

export interface PreflightResult {
  readonly inspection: ProjectInspection;
  readonly feasibility: FeasibilityAnalysis;
  readonly warnings: ReadonlyArray<string>;
  readonly recommendations: ReadonlyArray<string>;
}

export interface PreflightAnalyzer {
  analyze(intent: TaskIntent): Promise<PreflightResult>;
}
