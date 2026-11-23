/**
 * Deterministic Version Knowledge Resolver.
 *
 * Implements strict precedence:
 *   PROJECT .ai OVERRIDE > VERSION-SPECIFIC KNOWLEDGE > GENERIC SKILL KNOWLEDGE
 *
 * Enforces stale detection, conflict detection, unknown version handling,
 * and comprehensive provenance tracking.
 */

import {
  EffectiveVersionKnowledge,
  freezeEffectiveVersionKnowledge,
  freezeStaleVersionKnowledge,
  freezeVersionIntelligenceContext,
  freezeVersionKnowledgeConflict,
  ProjectDependency,
  ProjectDependencyOverride,
  StaleVersionKnowledge,
  VersionIntelligenceContext,
  VersionKnowledge,
  VersionKnowledgeConflict,
  VersionKnowledgeStatus,
} from '../../domain/version-intelligence';
import { GlobalVersionKnowledgeRegistry } from './global-knowledge';
import { parseSemver, satisfiesRange } from './semver';

export interface VersionResolverInput {
  readonly dependencies: ReadonlyArray<ProjectDependency>;
  readonly projectOverrides: ReadonlyArray<ProjectDependencyOverride>;
}

export class VersionKnowledgeResolver {
  constructor(private readonly registry: GlobalVersionKnowledgeRegistry) {}

  /**
   * Resolves effective version knowledge for all detected project dependencies.
   */
  resolve(input: VersionResolverInput): VersionIntelligenceContext {
    const effectiveKnowledge: EffectiveVersionKnowledge[] = [];
    const conflicts: VersionKnowledgeConflict[] = [];
    const staleItems: StaleVersionKnowledge[] = [];

    // Map overrides by normalized technology name
    const overridesByTech = new Map<string, ProjectDependencyOverride>();
    for (const override of input.projectOverrides) {
      overridesByTech.set(override.technology.toLowerCase(), override);
    }

    // Process all detected dependencies
    const processedTechs = new Set<string>();

    for (const dep of input.dependencies) {
      const tech = dep.normalizedName.toLowerCase();
      if (processedTechs.has(tech)) {
        continue;
      }
      processedTechs.add(tech);

      const effectiveVersion = dep.resolvedVersion || dep.declaredVersion;
      const normalizedVer = parseSemver(effectiveVersion);
      const override = overridesByTech.get(tech);

      // Check if global knowledge exists for this technology
      const matchingGlobalKnowledge = this.registry.findMatches(tech, effectiveVersion);
      const primaryGlobal = matchingGlobalKnowledge[0];

      // Case 1: Unknown version
      if (normalizedVer.isUnknown) {
        if (override) {
          // If project override exists even without exact detected version, use it
          effectiveKnowledge.push(
            freezeEffectiveVersionKnowledge({
              technology: dep.normalizedName,
              declaredVersion: dep.declaredVersion,
              resolvedVersion: dep.resolvedVersion,
              normalizedVersion: 'UNKNOWN',
              versionSource: dep.versionSource,
              status: 'PROJECT_OVERRIDE',
              effectiveSource: 'project-override',
              matchedKnowledgeRef: override.filePath,
              summary: override.summary,
              guidance: override.guidance,
              overridePath: override.filePath,
              provenance: `Project override ${override.filePath} applied for ${dep.normalizedName} (version unknown)`,
            }),
          );
        } else {
          effectiveKnowledge.push(
            freezeEffectiveVersionKnowledge({
              technology: dep.normalizedName,
              declaredVersion: dep.declaredVersion,
              resolvedVersion: dep.resolvedVersion,
              normalizedVersion: 'UNKNOWN',
              versionSource: dep.versionSource,
              status: 'VERSION_UNKNOWN',
              effectiveSource: 'generic',
              summary: `Detected ${dep.normalizedName} but exact version is UNKNOWN.`,
              guidance: [
                `No version-specific assumptions can be made for ${dep.normalizedName}. Rely on generic project patterns.`,
              ],
              provenance: `Technology ${dep.normalizedName} detected with UNKNOWN version`,
            }),
          );
        }
        continue;
      }

      // Case 2: Version is known, evaluate override and global knowledge
      if (override) {
        // Check stale condition: override defines applicableVersion and installed version violates it
        const isStale = override.applicableVersion && effectiveVersion
          ? !satisfiesRange(effectiveVersion, override.applicableVersion)
          : false;

        if (isStale) {
          const staleReason = `Project has installed ${dep.normalizedName} version ${effectiveVersion}, but .ai override ${override.filePath} targets ${override.applicableVersion}`;
          const staleRecord: StaleVersionKnowledge = freezeStaleVersionKnowledge({
            technology: dep.normalizedName,
            installedVersion: effectiveVersion ?? 'unknown',
            declaredApplicableVersion: override.applicableVersion,
            overridePath: override.filePath,
            reason: staleReason,
          });
          staleItems.push(staleRecord);

          // Stale override does NOT silently win. Use matching global version knowledge if available, noting the stale status
          if (primaryGlobal) {
            effectiveKnowledge.push(
              freezeEffectiveVersionKnowledge({
                technology: dep.normalizedName,
                declaredVersion: dep.declaredVersion,
                resolvedVersion: dep.resolvedVersion,
                normalizedVersion: normalizedVer.normalizedString,
                versionSource: dep.versionSource,
                status: 'STALE_KNOWLEDGE',
                effectiveSource: 'global',
                matchedKnowledgeRef: primaryGlobal.knowledgeRef,
                matchedVersionRange: primaryGlobal.versionRange,
                summary: `${primaryGlobal.summary} (Warning: Stale project override detected in ${override.filePath})`,
                guidance: primaryGlobal.guidance,
                compatibilityNotes: primaryGlobal.compatibilityNotes,
                overridePath: override.filePath,
                staleReason,
                provenance: `Resolved from global knowledge ${primaryGlobal.id} (range: ${primaryGlobal.versionRange}) due to stale project override in ${override.filePath}`,
              }),
            );
          } else {
            effectiveKnowledge.push(
              freezeEffectiveVersionKnowledge({
                technology: dep.normalizedName,
                declaredVersion: dep.declaredVersion,
                resolvedVersion: dep.resolvedVersion,
                normalizedVersion: normalizedVer.normalizedString,
                versionSource: dep.versionSource,
                status: 'STALE_KNOWLEDGE',
                effectiveSource: 'generic',
                summary: `Project override in ${override.filePath} is STALE for ${dep.normalizedName} ${effectiveVersion}. No matching global knowledge found.`,
                guidance: [
                  `Warning: .ai override ${override.filePath} is stale for installed version ${effectiveVersion}. Do not blindly apply outdated guidance.`,
                ],
                overridePath: override.filePath,
                staleReason,
                provenance: `Stale project override ${override.filePath} for ${dep.normalizedName} ${effectiveVersion}`,
              }),
            );
          }
          continue;
        }

        // Non-stale override: Project override wins!
        // Check for conflict with global knowledge
        let conflictReason: string | undefined;
        if (primaryGlobal) {
          const conflict: VersionKnowledgeConflict = freezeVersionKnowledgeConflict({
            technology: dep.normalizedName,
            resolvedVersion: effectiveVersion,
            globalKnowledgeId: primaryGlobal.id,
            globalGuidance: primaryGlobal.guidance,
            overridePath: override.filePath,
            overrideGuidance: override.guidance,
            resolution: `Project override ${override.filePath} takes precedence over global knowledge ${primaryGlobal.id}`,
          });
          conflicts.push(conflict);
          conflictReason = `Project override in ${override.filePath} overrides global guidance from ${primaryGlobal.id}`;
        }

        effectiveKnowledge.push(
          freezeEffectiveVersionKnowledge({
            technology: dep.normalizedName,
            declaredVersion: dep.declaredVersion,
            resolvedVersion: dep.resolvedVersion,
            normalizedVersion: normalizedVer.normalizedString,
            versionSource: dep.versionSource,
            status: 'PROJECT_OVERRIDE',
            effectiveSource: 'project-override',
            matchedKnowledgeRef: override.filePath,
            summary: override.summary,
            guidance: override.guidance,
            compatibilityNotes: override.notes,
            overridePath: override.filePath,
            conflictReason,
            provenance: primaryGlobal
              ? `Project override ${override.filePath} took precedence over global knowledge ${primaryGlobal.id} for ${dep.normalizedName} ${effectiveVersion}`
              : `Project override ${override.filePath} applied for ${dep.normalizedName} ${effectiveVersion}`,
          }),
        );
        continue;
      }

      // Case 3: No project override, check global knowledge
      if (primaryGlobal) {
        effectiveKnowledge.push(
          freezeEffectiveVersionKnowledge({
            technology: dep.normalizedName,
            declaredVersion: dep.declaredVersion,
            resolvedVersion: dep.resolvedVersion,
            normalizedVersion: normalizedVer.normalizedString,
            versionSource: dep.versionSource,
            status: 'RESOLVED',
            effectiveSource: 'global',
            matchedKnowledgeRef: primaryGlobal.knowledgeRef,
            matchedVersionRange: primaryGlobal.versionRange,
            summary: primaryGlobal.summary,
            guidance: primaryGlobal.guidance,
            compatibilityNotes: primaryGlobal.compatibilityNotes,
            provenance: `Resolved from global knowledge ${primaryGlobal.id} (matched range: ${primaryGlobal.versionRange}) for ${dep.normalizedName} ${effectiveVersion}`,
          }),
        );
      } else {
        // Case 4: Version known, but no global knowledge available
        effectiveKnowledge.push(
          freezeEffectiveVersionKnowledge({
            technology: dep.normalizedName,
            declaredVersion: dep.declaredVersion,
            resolvedVersion: dep.resolvedVersion,
            normalizedVersion: normalizedVer.normalizedString,
            versionSource: dep.versionSource,
            status: 'VERSION_KNOWN_KNOWLEDGE_UNAVAILABLE',
            effectiveSource: 'generic',
            summary: `Installed version ${dep.normalizedName} ${effectiveVersion} is known, but no version-specific knowledge definition exists.`,
            guidance: [
              `Rely on generic project patterns and source code evidence for ${dep.normalizedName} ${effectiveVersion}. Do not invent version-specific APIs.`,
            ],
            provenance: `No matching version knowledge for ${dep.normalizedName} ${effectiveVersion}`,
          }),
        );
      }
    }

    // Process any orphaned project overrides whose dependencies weren't in manifest
    for (const override of input.projectOverrides) {
      const tech = override.technology.toLowerCase();
      if (!processedTechs.has(tech)) {
        processedTechs.add(tech);
        effectiveKnowledge.push(
          freezeEffectiveVersionKnowledge({
            technology: override.technology,
            declaredVersion: undefined,
            resolvedVersion: undefined,
            normalizedVersion: 'UNKNOWN',
            versionSource: 'unknown',
            status: 'PROJECT_OVERRIDE',
            effectiveSource: 'project-override',
            matchedKnowledgeRef: override.filePath,
            summary: override.summary,
            guidance: override.guidance,
            overridePath: override.filePath,
            provenance: `Project override ${override.filePath} provided for ${override.technology} (not declared in package manifest)`,
          }),
        );
      }
    }

    // Sort effective knowledge deterministically
    effectiveKnowledge.sort((a, b) => a.technology.localeCompare(b.technology));

    const summaryParts: string[] = [];
    const resolvedCount = effectiveKnowledge.filter(e => e.status === 'RESOLVED').length;
    const overrideCount = effectiveKnowledge.filter(e => e.status === 'PROJECT_OVERRIDE').length;
    const staleCount = staleItems.length;
    const conflictCount = conflicts.length;

    summaryParts.push(`dependencies=${input.dependencies.length}`);
    summaryParts.push(`effectiveKnowledge=${effectiveKnowledge.length}`);
    summaryParts.push(`resolved=${resolvedCount}`);
    summaryParts.push(`overrides=${overrideCount}`);
    if (staleCount > 0) summaryParts.push(`stale=${staleCount}`);
    if (conflictCount > 0) summaryParts.push(`conflicts=${conflictCount}`);

    return freezeVersionIntelligenceContext({
      dependencies: input.dependencies,
      effectiveKnowledge,
      conflicts,
      staleItems,
      summary: summaryParts.join('; '),
    });
  }
}
