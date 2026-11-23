import { ProjectProfile } from '../domain/project-profile';
import { Skill, SkillDomain } from '../domain/skill';

/**
 * User/system execution directive used for deterministic skill selection.
 * The resolver never interprets task text with an LLM.
 */
export interface ExecutionDirective {
  readonly explicitSkillIds?: ReadonlyArray<string>;
  readonly requestedDomains?: ReadonlyArray<SkillDomain>;
}

export type SkillResolutionSource = 'explicit' | 'system-rule' | 'project-capability';

export interface SkillResolutionReason {
  readonly skillId: string;
  readonly source: SkillResolutionSource;
  readonly detail: string;
}

export interface SkillResolution {
  readonly skills: ReadonlyArray<Skill>;
  readonly reasons: ReadonlyArray<SkillResolutionReason>;
  readonly mode: 'explicit' | 'rules';
}

export interface SkillResolutionInput {
  readonly directive: ExecutionDirective;
  readonly projectProfile: ProjectProfile;
}

/**
 * Deterministic skill selection. Must not call an LLM.
 * Resolution is synchronous so it cannot depend on a model provider.
 */
export interface SkillResolver {
  resolve(input: SkillResolutionInput): SkillResolution;
}
