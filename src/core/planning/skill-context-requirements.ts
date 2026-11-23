import { Skill } from '../../domain/skill';

export interface AggregatedContextRequirements {
  readonly projectMetadataRequired: boolean;
  readonly aiContextOptional: boolean;
  readonly aiContextFileHints: ReadonlyArray<string>;
  readonly sourceFilesSelected: boolean;
  readonly codebaseMapOptional: boolean;
  readonly reasons: ReadonlyArray<string>;
}

/**
 * Maps resolved skills to generic context requirements.
 * Framework-specific rules are out of scope.
 */
export function aggregateSkillContextRequirements(
  skills: ReadonlyArray<Skill>,
): AggregatedContextRequirements {
  let projectMetadataRequired = false;
  let aiContextOptional = false;
  const aiHints: string[] = [];
  let sourceFilesSelected = false;
  let codebaseMapOptional = false;
  const reasons: string[] = [];

  for (const skill of skills) {
    if (skill.requiredContext.projectProfile) {
      projectMetadataRequired = true;
      reasons.push(`${skill.id} requires PROJECT_METADATA`);
    }
    if (skill.requiredContext.aiContextFiles && skill.requiredContext.aiContextFiles.length > 0) {
      aiContextOptional = true;
      for (const name of skill.requiredContext.aiContextFiles) {
        if (!aiHints.includes(name)) aiHints.push(name);
      }
      reasons.push(
        `${skill.id} optionally uses AI_CONTEXT (${skill.requiredContext.aiContextFiles.join(', ')})`,
      );
    }
    sourceFilesSelected = true;
    reasons.push(`${skill.id} selects SOURCE_FILES for targeted gathering`);
    if (skill.domain === 'backend') {
      codebaseMapOptional = true;
      reasons.push(`${skill.id} optionally uses CODEBASE_MAP`);
    }
  }

  return Object.freeze({
    projectMetadataRequired,
    aiContextOptional,
    aiContextFileHints: Object.freeze([...aiHints]),
    sourceFilesSelected,
    codebaseMapOptional,
    reasons: Object.freeze(reasons),
  });
}
