import { SkillDomain } from './skill';
import {
  FrameworkVersionInfo,
  freezeFrameworkVersionInfo,
  freezeProjectDependency,
  ProjectDependency,
} from './version-intelligence';

/**
 * Milestone A4 / E4: Project Profile Foundation & Version Intelligence
 *
 * Lightweight, deterministic representation of project capabilities and framework/dependency versions.
 */

export const PROJECT_TYPES = ['frontend', 'backend', 'fullstack', 'library', 'unknown'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'unknown'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface ProjectProfile {
  readonly workspaceRoot: string;
  readonly projectType: ProjectType;
  readonly detectedFrameworks: ReadonlyArray<string>;
  readonly frameworkVersions?: ReadonlyArray<FrameworkVersionInfo>;
  readonly dependencies?: ReadonlyArray<ProjectDependency>;
  readonly languages: ReadonlyArray<string>;
  readonly packageManager: PackageManager;
  readonly availableTestingTools: ReadonlyArray<string>;
  readonly detectedDomains: ReadonlyArray<SkillDomain>;
  readonly capabilities: ReadonlyArray<string>;
}

export interface ProjectDetectionContribution {
  readonly languages?: ReadonlyArray<string>;
  readonly testingTools?: ReadonlyArray<string>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly detectedDomains?: ReadonlyArray<SkillDomain>;
  readonly detectedFrameworks?: ReadonlyArray<string>;
  readonly frameworkVersions?: ReadonlyArray<FrameworkVersionInfo>;
  readonly dependencies?: ReadonlyArray<ProjectDependency>;
}

/**
 * Optional detector plugin. Must be deterministic and must not call an LLM.
 */
export interface ProjectDetectionExtension {
  contribute(workspaceRoot: string, profile: ProjectProfile): Promise<ProjectDetectionContribution>;
}

export function unknownProjectProfile(workspaceRoot: string): ProjectProfile {
  return Object.freeze({
    workspaceRoot,
    projectType: 'unknown',
    detectedFrameworks: Object.freeze([]),
    frameworkVersions: Object.freeze([]),
    dependencies: Object.freeze([]),
    languages: Object.freeze([]),
    packageManager: 'unknown',
    availableTestingTools: Object.freeze([]),
    detectedDomains: Object.freeze([]),
    capabilities: Object.freeze([]),
  });
}

export function freezeProjectProfile(profile: ProjectProfile): ProjectProfile {
  return Object.freeze({
    workspaceRoot: profile.workspaceRoot,
    projectType: profile.projectType,
    detectedFrameworks: Object.freeze([...profile.detectedFrameworks]),
    frameworkVersions: profile.frameworkVersions
      ? Object.freeze(profile.frameworkVersions.map(freezeFrameworkVersionInfo))
      : undefined,
    dependencies: profile.dependencies
      ? Object.freeze(profile.dependencies.map(freezeProjectDependency))
      : undefined,
    languages: Object.freeze([...profile.languages]),
    packageManager: profile.packageManager,
    availableTestingTools: Object.freeze([...profile.availableTestingTools]),
    detectedDomains: Object.freeze([...profile.detectedDomains]),
    capabilities: Object.freeze([...profile.capabilities]),
  });
}
