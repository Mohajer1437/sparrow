import { SkillValidationError } from '../../src/domain/errors/skill-errors';
import { validateSkill } from '../../src/domain/skill';

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'frontend.core',
    name: 'Frontend Core',
    domain: 'frontend',
    applicability: { domains: ['frontend'] },
    requiredContext: { projectProfile: true },
    planningRules: { constraints: ['plan against existing UI'] },
    executionRules: { constraints: ['limit to frontend trees'] },
    verificationRules: { requiredChecks: ['deterministic'] },
    versionSupport: { knowledgeRefs: [] },
    ...overrides,
  };
}

describe('Skill contract', () => {
  it('creates a valid frozen skill', () => {
    const skill = validateSkill(validDraft());
    expect(skill.id).toBe('frontend.core');
    expect(skill.name).toBe('Frontend Core');
    expect(skill.domain).toBe('frontend');
    expect(skill.applicability.domains).toEqual(['frontend']);
    expect(skill.requiredContext.projectProfile).toBe(true);
    expect(skill.planningRules.constraints).toContain('plan against existing UI');
    expect(skill.executionRules.constraints).toContain('limit to frontend trees');
    expect(skill.verificationRules.requiredChecks).toEqual(['deterministic']);
    expect(skill.versionSupport.knowledgeRefs).toEqual([]);
    expect(skill.verificationRules.backendVerification).toBeUndefined();
    expect(Object.isFrozen(skill)).toBe(true);
    expect(Object.isFrozen(skill.applicability)).toBe(true);
    expect(Object.isFrozen(skill.planningRules.constraints)).toBe(true);
  });

  it('accepts optional project overrides', () => {
    const skill = validateSkill(validDraft({
      projectOverrides: {
        disabledRules: ['legacy-rule'],
        additionalConstraints: ['use existing design system'],
      },
    }));
    expect(skill.projectOverrides?.disabledRules).toEqual(['legacy-rule']);
    expect(skill.projectOverrides?.additionalConstraints).toEqual(['use existing design system']);
  });

  it('rejects a missing id', () => {
    expect(() => validateSkill(validDraft({ id: '' }))).toThrow(SkillValidationError);
  });

  it('rejects a non-namespaced id', () => {
    expect(() => validateSkill(validDraft({ id: 'frontend' }))).toThrow(SkillValidationError);
    expect(() => validateSkill(validDraft({ id: 'Frontend.core' }))).toThrow(SkillValidationError);
  });

  it('allows hyphenated skill segments', () => {
    const skill = validateSkill(validDraft({
      id: 'backend.database-verification',
      domain: 'backend',
      applicability: { domains: ['backend'] },
    }));
    expect(skill.id).toBe('backend.database-verification');
  });

  it('rejects a missing name', () => {
    expect(() => validateSkill(validDraft({ name: '  ' }))).toThrow(SkillValidationError);
  });

  it('rejects an invalid domain', () => {
    expect(() => validateSkill(validDraft({ domain: 'nextjs' }))).toThrow(SkillValidationError);
    expect(() => validateSkill(validDraft({ domain: 'unknown' }))).toThrow(SkillValidationError);
  });

  it('rejects missing applicability domains', () => {
    expect(() => validateSkill(validDraft({ applicability: { domains: [] } }))).toThrow(SkillValidationError);
    expect(() => validateSkill(validDraft({ applicability: {} }))).toThrow(SkillValidationError);
  });

  it('rejects a non-object payload', () => {
    expect(() => validateSkill(null)).toThrow(SkillValidationError);
    expect(() => validateSkill('frontend.core')).toThrow(SkillValidationError);
  });

  it('rejects missing required nested contracts', () => {
    const draft = validDraft();
    delete (draft as any).planningRules;
    expect(() => validateSkill(draft)).toThrow(SkillValidationError);
  });

  it('accepts declarative backend verification rules', () => {
    const skill = validateSkill(validDraft({
      id: 'backend.api',
      domain: 'backend',
      applicability: { domains: ['backend'] },
      verificationRules: {
        requiredChecks: ['api'],
        backendVerification: {
          endpointDiscovery: true,
          authentication: true,
          requiredChecks: ['endpoint', 'auth'],
          discoveryHints: ['@Controller'],
          testCommands: ['api'],
        },
      },
    }));
    expect(skill.verificationRules.backendVerification?.endpointDiscovery).toBe(true);
    expect(skill.verificationRules.backendVerification?.requiredChecks).toEqual(['endpoint', 'auth']);
    expect(Object.isFrozen(skill.verificationRules.backendVerification)).toBe(true);
  });

  it('rejects non-boolean backend verification flags', () => {
    expect(() => validateSkill(validDraft({
      verificationRules: {
        requiredChecks: ['api'],
        backendVerification: { authentication: 'yes' },
      },
    }))).toThrow(SkillValidationError);
  });
});
