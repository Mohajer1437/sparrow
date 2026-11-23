/**
 * Milestone E: Version Intelligence Domain Contracts
 *
 * Deterministic, normalized representation of project dependencies,
 * version normalization, version knowledge contracts, project .ai overrides,
 * stale/conflict detection, and effective version knowledge.
 */

export const DEPENDENCY_CATEGORIES = [
  'framework',
  'runtime',
  'orm',
  'database',
  'testing',
  'build',
  'lint',
  'ui',
  'utility',
  'unknown',
] as const;
export type DependencyCategory = (typeof DEPENDENCY_CATEGORIES)[number];

export const VERSION_SOURCES = ['manifest', 'lockfile', 'runtime', 'unknown'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

export const DEPENDENCY_TYPES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'unknown',
] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const VERSION_KNOWLEDGE_STATUSES = [
  'RESOLVED',
  'PROJECT_OVERRIDE',
  'STALE_KNOWLEDGE',
  'CONFLICT',
  'VERSION_KNOWN_KNOWLEDGE_UNAVAILABLE',
  'VERSION_UNKNOWN',
  'GENERIC_FALLBACK',
] as const;
export type VersionKnowledgeStatus = (typeof VERSION_KNOWLEDGE_STATUSES)[number];

export const VERSION_KNOWLEDGE_SOURCES = ['global', 'project-override', 'generic'] as const;
export type VersionKnowledgeSource = (typeof VERSION_KNOWLEDGE_SOURCES)[number];

/**
 * Normalized representation of an individual project dependency.
 */
export interface ProjectDependency {
  readonly name: string;
  readonly normalizedName: string;
  readonly category: DependencyCategory;
  readonly declaredVersion?: string;
  readonly resolvedVersion?: string;
  readonly versionSource: VersionSource;
  readonly dependencyType: DependencyType;
}

/**
 * Framework version record for ProjectProfile (backwards-compatible extension).
 */
export interface FrameworkVersionInfo {
  readonly name: string;
  readonly declaredVersion?: string;
  readonly resolvedVersion?: string;
  readonly versionSource: VersionSource;
}

/**
 * Normalized semver representation.
 */
export interface NormalizedVersion {
  readonly raw: string;
  readonly major?: number;
  readonly minor?: number;
  readonly patch?: number;
  readonly prerelease?: string;
  readonly isRange: boolean;
  readonly isExact: boolean;
  readonly isUnknown: boolean;
  readonly normalizedString: string;
}

/**
 * Global or modular version knowledge definition.
 */
export interface VersionKnowledge {
  readonly id: string;
  readonly technology: string;
  readonly versionRange: string;
  readonly knowledgeRef: string;
  readonly title: string;
  readonly summary: string;
  readonly guidance: ReadonlyArray<string>;
  readonly compatibilityNotes?: ReadonlyArray<string>;
  readonly breakingChanges?: ReadonlyArray<string>;
  readonly testingGuidance?: ReadonlyArray<string>;
  readonly priority?: number;
  readonly source: 'global' | 'project-override';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Project-specific dependency override loaded from .ai/dependencies/.
 */
export interface ProjectDependencyOverride {
  readonly technology: string;
  readonly applicableVersion?: string;
  readonly summary: string;
  readonly guidance: ReadonlyArray<string>;
  readonly notes?: ReadonlyArray<string>;
  readonly filePath: string;
  readonly lastVerified?: string;
  readonly scope?: string;
  readonly source: 'project-override';
}

/**
 * Effective version knowledge resolved for a detected dependency.
 */
export interface EffectiveVersionKnowledge {
  readonly technology: string;
  readonly declaredVersion?: string;
  readonly resolvedVersion?: string;
  readonly normalizedVersion: string;
  readonly versionSource: VersionSource;
  readonly status: VersionKnowledgeStatus;
  readonly effectiveSource: VersionKnowledgeSource;
  readonly matchedKnowledgeRef?: string;
  readonly matchedVersionRange?: string;
  readonly summary: string;
  readonly guidance: ReadonlyArray<string>;
  readonly compatibilityNotes?: ReadonlyArray<string>;
  readonly overridePath?: string;
  readonly staleReason?: string;
  readonly conflictReason?: string;
  readonly provenance: string;
}

/**
 * Conflict detected between global version knowledge and a project override.
 */
export interface VersionKnowledgeConflict {
  readonly technology: string;
  readonly resolvedVersion?: string;
  readonly globalKnowledgeId: string;
  readonly globalGuidance: ReadonlyArray<string>;
  readonly overridePath: string;
  readonly overrideGuidance: ReadonlyArray<string>;
  readonly resolution: string;
}

/**
 * Stale knowledge detected in project .ai/dependencies/.
 */
export interface StaleVersionKnowledge {
  readonly technology: string;
  readonly installedVersion: string;
  readonly declaredApplicableVersion?: string;
  readonly overridePath: string;
  readonly reason: string;
}

/**
 * Comprehensive Version Intelligence context attached to PlannerContext.
 */
export interface VersionIntelligenceContext {
  readonly dependencies: ReadonlyArray<ProjectDependency>;
  readonly effectiveKnowledge: ReadonlyArray<EffectiveVersionKnowledge>;
  readonly conflicts: ReadonlyArray<VersionKnowledgeConflict>;
  readonly staleItems: ReadonlyArray<StaleVersionKnowledge>;
  readonly summary: string;
}

export function freezeProjectDependency(dep: ProjectDependency): ProjectDependency {
  return Object.freeze({
    name: dep.name,
    normalizedName: dep.normalizedName,
    category: dep.category,
    declaredVersion: dep.declaredVersion,
    resolvedVersion: dep.resolvedVersion,
    versionSource: dep.versionSource,
    dependencyType: dep.dependencyType,
  });
}

export function freezeFrameworkVersionInfo(info: FrameworkVersionInfo): FrameworkVersionInfo {
  return Object.freeze({
    name: info.name,
    declaredVersion: info.declaredVersion,
    resolvedVersion: info.resolvedVersion,
    versionSource: info.versionSource,
  });
}

export function freezeVersionKnowledge(item: VersionKnowledge): VersionKnowledge {
  return Object.freeze({
    id: item.id,
    technology: item.technology,
    versionRange: item.versionRange,
    knowledgeRef: item.knowledgeRef,
    title: item.title,
    summary: item.summary,
    guidance: Object.freeze([...item.guidance]),
    compatibilityNotes: item.compatibilityNotes
      ? Object.freeze([...item.compatibilityNotes])
      : undefined,
    breakingChanges: item.breakingChanges ? Object.freeze([...item.breakingChanges]) : undefined,
    testingGuidance: item.testingGuidance ? Object.freeze([...item.testingGuidance]) : undefined,
    priority: item.priority,
    source: item.source,
    metadata: item.metadata ? Object.freeze({ ...item.metadata }) : undefined,
  });
}

export function freezeProjectDependencyOverride(
  override: ProjectDependencyOverride,
): ProjectDependencyOverride {
  return Object.freeze({
    technology: override.technology,
    applicableVersion: override.applicableVersion,
    summary: override.summary,
    guidance: Object.freeze([...override.guidance]),
    notes: override.notes ? Object.freeze([...override.notes]) : undefined,
    filePath: override.filePath,
    lastVerified: override.lastVerified,
    scope: override.scope,
    source: override.source,
  });
}

export function freezeEffectiveVersionKnowledge(
  effective: EffectiveVersionKnowledge,
): EffectiveVersionKnowledge {
  return Object.freeze({
    technology: effective.technology,
    declaredVersion: effective.declaredVersion,
    resolvedVersion: effective.resolvedVersion,
    normalizedVersion: effective.normalizedVersion,
    versionSource: effective.versionSource,
    status: effective.status,
    effectiveSource: effective.effectiveSource,
    matchedKnowledgeRef: effective.matchedKnowledgeRef,
    matchedVersionRange: effective.matchedVersionRange,
    summary: effective.summary,
    guidance: Object.freeze([...effective.guidance]),
    compatibilityNotes: effective.compatibilityNotes
      ? Object.freeze([...effective.compatibilityNotes])
      : undefined,
    overridePath: effective.overridePath,
    staleReason: effective.staleReason,
    conflictReason: effective.conflictReason,
    provenance: effective.provenance,
  });
}

export function freezeVersionKnowledgeConflict(
  conflict: VersionKnowledgeConflict,
): VersionKnowledgeConflict {
  return Object.freeze({
    technology: conflict.technology,
    resolvedVersion: conflict.resolvedVersion,
    globalKnowledgeId: conflict.globalKnowledgeId,
    globalGuidance: Object.freeze([...conflict.globalGuidance]),
    overridePath: conflict.overridePath,
    overrideGuidance: Object.freeze([...conflict.overrideGuidance]),
    resolution: conflict.resolution,
  });
}

export function freezeStaleVersionKnowledge(
  stale: StaleVersionKnowledge,
): StaleVersionKnowledge {
  return Object.freeze({
    technology: stale.technology,
    installedVersion: stale.installedVersion,
    declaredApplicableVersion: stale.declaredApplicableVersion,
    overridePath: stale.overridePath,
    reason: stale.reason,
  });
}

export function freezeVersionIntelligenceContext(
  context: VersionIntelligenceContext,
): VersionIntelligenceContext {
  return Object.freeze({
    dependencies: Object.freeze(context.dependencies.map(freezeProjectDependency)),
    effectiveKnowledge: Object.freeze(context.effectiveKnowledge.map(freezeEffectiveVersionKnowledge)),
    conflicts: Object.freeze(context.conflicts.map(freezeVersionKnowledgeConflict)),
    staleItems: Object.freeze(context.staleItems.map(freezeStaleVersionKnowledge)),
    summary: context.summary,
  });
}
