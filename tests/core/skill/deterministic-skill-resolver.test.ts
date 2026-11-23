import { SkillResolutionError } from '../../../src/domain/errors/skill-errors';
import { freezeProjectProfile, ProjectProfile } from '../../../src/domain/project-profile';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { DeterministicSkillResolver } from '../../../src/core/skill/deterministic-skill-resolver';
import { InMemorySkillRegistry } from '../../../src/core/skill/in-memory-skill-registry';
import { validateSkill } from '../../../src/domain/skill';

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return freezeProjectProfile({
    workspaceRoot: '/tmp/proj',
    projectType: 'unknown',
    detectedFrameworks: [],
    languages: [],
    packageManager: 'unknown',
    availableTestingTools: [],
    detectedDomains: [],
    capabilities: [],
    ...overrides,
  });
}

describe('DeterministicSkillResolver', () => {
  const registry = createDefaultSkillRegistry();
  const resolver = new DeterministicSkillResolver(registry);

  it('selects skills from an explicit execution directive', () => {
    const result = resolver.resolve({
      directive: { explicitSkillIds: ['backend.core'] },
      projectProfile: profile({ detectedDomains: ['frontend'], projectType: 'frontend' }),
    });

    expect(result.mode).toBe('explicit');
    expect(result.skills.map(s => s.id)).toEqual(['backend.core']);
    expect(result.reasons[0].source).toBe('explicit');
  });

  it('ignores project profile when explicit skills are provided', () => {
    const result = resolver.resolve({
      directive: { explicitSkillIds: ['frontend.core', 'testing.core'] },
      projectProfile: profile({ detectedDomains: ['backend'], projectType: 'backend' }),
    });

    expect(result.skills.map(s => s.id)).toEqual(['frontend.core', 'testing.core']);
  });

  it('throws when an explicit skill is missing', () => {
    expect(() => resolver.resolve({
      directive: { explicitSkillIds: ['frontend.unknown'] },
      projectProfile: profile(),
    })).toThrow(SkillResolutionError);
  });

  it('resolves from detected project domains without LLM input', () => {
    const result = resolver.resolve({
      directive: {},
      projectProfile: profile({
        projectType: 'frontend',
        detectedFrameworks: ['nextjs'],
        detectedDomains: ['frontend', 'testing'],
        capabilities: ['frontend', 'nextjs', 'testing'],
        availableTestingTools: ['jest'],
      }),
    });

    expect(result.mode).toBe('rules');
    expect(result.skills.map(s => s.id)).toEqual(['frontend.core', 'testing.core']);
    expect(result.reasons.every(r => r.source !== 'explicit')).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const input = {
      directive: {},
      projectProfile: profile({
        projectType: 'fullstack',
        detectedDomains: ['frontend', 'backend'],
        capabilities: ['frontend', 'backend'],
      }),
    };

    const first = resolver.resolve(input);
    const second = resolver.resolve(input);
    expect(first.skills.map(s => s.id)).toEqual(second.skills.map(s => s.id));
    expect(first.skills.map(s => s.id)).toEqual([
      'backend.api',
      'backend.core',
      'backend.database-verification',
      'backend.testing',
      'frontend.core',
    ]);
  });

  it('filters by requested domains', () => {
    const result = resolver.resolve({
      directive: { requestedDomains: ['backend'] },
      projectProfile: profile({
        detectedDomains: ['frontend', 'backend'],
        capabilities: ['frontend', 'backend'],
      }),
    });

    expect(result.skills.map(s => s.id)).toEqual([
      'backend.api',
      'backend.core',
      'backend.database-verification',
      'backend.testing',
    ]);
  });

  it('returns an empty set when nothing matches', () => {
    const result = resolver.resolve({
      directive: {},
      projectProfile: profile(),
    });
    expect(result.skills).toEqual([]);
    expect(result.mode).toBe('rules');
  });

  it('does not depend on an LLM or provider', () => {
    const result = resolver.resolve({
      directive: { explicitSkillIds: ['testing.core'] },
      projectProfile: profile(),
    });

    expect(result).not.toBeInstanceOf(Promise);
    expect(Object.getOwnPropertyNames(DeterministicSkillResolver.prototype)).toEqual(
      expect.arrayContaining(['resolve']),
    );
    expect(typeof resolver.resolve).toBe('function');
    expect(resolver.resolve.length).toBe(1);
  });

  it('applies requiredCapabilities as a hard constraint', () => {
    const custom = new InMemorySkillRegistry();
    custom.register(validateSkill({
      id: 'frontend.strict',
      name: 'Strict Frontend',
      domain: 'frontend',
      applicability: {
        domains: ['frontend'],
        requiredCapabilities: ['nextjs'],
      },
      requiredContext: { projectProfile: true },
      planningRules: { constraints: [] },
      executionRules: { constraints: [] },
      verificationRules: { requiredChecks: [] },
      versionSupport: { knowledgeRefs: [] },
    }));
    const strictResolver = new DeterministicSkillResolver(custom);

    const miss = strictResolver.resolve({
      directive: {},
      projectProfile: profile({ detectedDomains: ['frontend'], capabilities: ['frontend'] }),
    });
    expect(miss.skills).toEqual([]);

    const hit = strictResolver.resolve({
      directive: {},
      projectProfile: profile({
        detectedDomains: ['frontend'],
        capabilities: ['frontend', 'nextjs'],
      }),
    });
    expect(hit.skills.map(s => s.id)).toEqual(['frontend.strict']);
  });

  it('selects backend.nestjs only when NestJS is detected', () => {
    const without = resolver.resolve({
      directive: { requestedDomains: ['backend'] },
      projectProfile: profile({
        detectedDomains: ['backend'],
        capabilities: ['backend'],
      }),
    });
    expect(without.skills.map(s => s.id)).not.toContain('backend.nestjs');

    const withNest = resolver.resolve({
      directive: { requestedDomains: ['backend'] },
      projectProfile: profile({
        detectedDomains: ['backend'],
        detectedFrameworks: ['nestjs'],
        capabilities: ['backend', 'nestjs'],
      }),
    });
    expect(withNest.skills.map(s => s.id)).toContain('backend.nestjs');
  });
});
