import { SkillRegistry } from '../../contracts/skill-registry';
import {
  ExecutionDirective,
  SkillResolution,
  SkillResolutionInput,
  SkillResolutionReason,
  SkillResolver,
} from '../../contracts/skill-resolver';
import { SkillResolutionError } from '../../domain/errors/skill-errors';
import { ProjectProfile } from '../../domain/project-profile';
import { Skill, SkillDomain } from '../../domain/skill';

/**
 * Deterministic skill selection.
 *
 * Never asks an LLM which skill to use. Selection uses, in order:
 * 1. Explicit skill ids on the execution directive
 * 2. Requested domains on the directive
 * 3. Project profile domains, frameworks, languages, and capabilities
 */
export class DeterministicSkillResolver implements SkillResolver {
  constructor(private readonly registry: SkillRegistry) {}

  resolve(input: SkillResolutionInput): SkillResolution {
    const directive = input.directive ?? {};
    const explicitIds = unique(directive.explicitSkillIds ?? []);

    if (explicitIds.length > 0) {
      return this.resolveExplicit(explicitIds);
    }

    return this.resolveByRules(directive, input.projectProfile);
  }

  private resolveExplicit(ids: ReadonlyArray<string>): SkillResolution {
    const skills: Skill[] = [];
    const reasons: SkillResolutionReason[] = [];

    for (const id of ids) {
      const skill = this.registry.get(id);
      if (!skill) {
        throw new SkillResolutionError(`Unknown skill: ${id}`);
      }
      skills.push(skill);
      reasons.push({
        skillId: id,
        source: 'explicit',
        detail: 'Selected by explicit execution directive',
      });
    }

    return freezeResolution({
      skills: Object.freeze(skills),
      reasons: Object.freeze(reasons),
      mode: 'explicit',
    });
  }

  private resolveByRules(
    directive: ExecutionDirective,
    profile: ProjectProfile,
  ): SkillResolution {
    const requestedDomains = unique(directive.requestedDomains ?? []);
    const candidates = this.registry.list().slice().sort((a, b) => a.id.localeCompare(b.id));
    const skills: Skill[] = [];
    const reasons: SkillResolutionReason[] = [];

    for (const skill of candidates) {
      if (requestedDomains.length > 0 && !requestedDomains.includes(skill.domain)) {
        continue;
      }

      const match = matchSkill(skill, profile);
      if (!match.applicable) {
        continue;
      }

      skills.push(skill);
      reasons.push({
        skillId: skill.id,
        source: match.source,
        detail: match.detail,
      });
    }

    return freezeResolution({
      skills: Object.freeze(skills),
      reasons: Object.freeze(reasons),
      mode: 'rules',
    });
  }
}

function matchSkill(
  skill: Skill,
  profile: ProjectProfile,
): { applicable: boolean; source: 'system-rule' | 'project-capability'; detail: string } {
  const applicability = skill.applicability;

  const domainOverlap = applicability.domains.some(domain => profile.detectedDomains.includes(domain));
  if (!domainOverlap) {
    return { applicable: false, source: 'system-rule', detail: 'domain mismatch' };
  }

  if (applicability.frameworks && applicability.frameworks.length > 0) {
    const frameworkOverlap = applicability.frameworks.some(fw => profile.detectedFrameworks.includes(fw));
    if (!frameworkOverlap) {
      return { applicable: false, source: 'system-rule', detail: 'framework mismatch' };
    }
  }

  if (applicability.languages && applicability.languages.length > 0) {
    const languageOverlap = applicability.languages.some(lang => profile.languages.includes(lang));
    if (!languageOverlap) {
      return { applicable: false, source: 'system-rule', detail: 'language mismatch' };
    }
  }

  if (applicability.requiredCapabilities && applicability.requiredCapabilities.length > 0) {
    const missing = applicability.requiredCapabilities.filter(cap => !profile.capabilities.includes(cap));
    if (missing.length > 0) {
      return { applicable: false, source: 'project-capability', detail: `missing capabilities: ${missing.join(', ')}` };
    }
  }

  const capabilityOverlap = applicability.domains.some(domain => profile.capabilities.includes(domain));
  if (capabilityOverlap) {
    return {
      applicable: true,
      source: 'project-capability',
      detail: `Matched project domains [${applicability.domains.join(', ')}]`,
    };
  }

  return {
    applicable: true,
    source: 'system-rule',
    detail: `Matched detected domains [${applicability.domains.join(', ')}]`,
  };
}

function unique<T>(items: ReadonlyArray<T>): T[] {
  return Array.from(new Set(items));
}

function freezeResolution(resolution: SkillResolution): SkillResolution {
  return Object.freeze({
    skills: Object.freeze([...resolution.skills]),
    reasons: Object.freeze(resolution.reasons.map(reason => Object.freeze({ ...reason }))),
    mode: resolution.mode,
  });
}

export function createEmptyDirective(): ExecutionDirective {
  return Object.freeze({});
}

export function domainsOf(skills: ReadonlyArray<Skill>): ReadonlyArray<SkillDomain> {
  return Object.freeze(unique(skills.map(skill => skill.domain)));
}
