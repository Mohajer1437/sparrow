import { SkillRegistryError } from '../../../src/domain/errors/skill-errors';
import { SkillValidationError } from '../../../src/domain/errors/skill-errors';
import { validateSkill } from '../../../src/domain/skill';
import { InMemorySkillRegistry } from '../../../src/core/skill/in-memory-skill-registry';
import { createDefaultSkillRegistry, DEFAULT_SKILLS } from '../../../src/core/skill/default-skills';

function validSkill(id = 'frontend.core') {
  return validateSkill({
    id,
    name: 'Test Skill',
    domain: 'frontend',
    applicability: { domains: ['frontend'] },
    requiredContext: { projectProfile: true },
    planningRules: { constraints: [] },
    executionRules: { constraints: [] },
    verificationRules: { requiredChecks: [] },
    versionSupport: { knowledgeRefs: [] },
  });
}

describe('InMemorySkillRegistry', () => {
  let registry: InMemorySkillRegistry;

  beforeEach(() => {
    registry = new InMemorySkillRegistry();
  });

  it('registers a skill', () => {
    registry.register(validSkill());
    expect(registry.has('frontend.core')).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('retrieves a skill by id', () => {
    registry.register(validSkill('backend.core'));
    const skill = registry.get('backend.core');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('Test Skill');
    expect(skill?.domain).toBe('frontend');
  });

  it('returns undefined for a missing skill', () => {
    expect(registry.get('missing.skill')).toBeUndefined();
    expect(registry.has('missing.skill')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    registry.register(validSkill());
    expect(() => registry.register(validSkill())).toThrow(SkillRegistryError);
    expect(() => registry.register(validSkill())).toThrow('Skill already registered: frontend.core');
  });

  it('rejects invalid skill definitions on register', () => {
    expect(() => registry.register({ id: 'bad' } as any)).toThrow(SkillValidationError);
    expect(registry.list()).toHaveLength(0);
  });

  it('lists registered skills as an immutable array', () => {
    registry.register(validSkill('frontend.core'));
    registry.register(validSkill('backend.core'));
    const listed = registry.list();
    expect(listed.map(s => s.id).sort()).toEqual(['backend.core', 'frontend.core']);
    expect(Object.isFrozen(listed)).toBe(true);
  });

  it('registers the built-in core skills', () => {
    const defaults = createDefaultSkillRegistry();
    expect(defaults.get('frontend.core')?.domain).toBe('frontend');
    expect(defaults.get('backend.core')?.domain).toBe('backend');
    expect(defaults.get('testing.core')?.domain).toBe('testing');
    expect(defaults.list()).toHaveLength(DEFAULT_SKILLS.length);
  });
});
