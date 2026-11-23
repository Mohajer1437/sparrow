import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { SkillResolution } from '../../../src/contracts/skill-resolver';

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

function frontendSkills(): SkillResolution {
  const skill = registry.get('frontend.core')!;
  return {
    skills: [skill],
    reasons: [{ skillId: skill.id, source: 'system-rule', detail: 'frontend' }],
    mode: 'rules',
  };
}

function baseInput() {
  return {
    userTask: 'Repair login spinner',
    executionDirective: {},
    projectProfile: freezeProjectProfile({
      workspaceRoot: '/tmp/web',
      projectType: 'frontend' as const,
      detectedFrameworks: ['nextjs'],
      languages: ['typescript'],
      packageManager: 'npm' as const,
      availableTestingTools: [],
      detectedDomains: ['frontend' as const],
      capabilities: ['frontend', 'nextjs'],
    }),
    resolvedSkills: frontendSkills(),
    aiContext: freezeAiContextDiscovery({
      workspaceRoot: '/tmp/web',
      rootPath: '/tmp/web/.ai',
      exists: false,
      files: [],
    }),
  };
}

describe('Context strategy repair mode', () => {
  it('activates repair mode when a Failure Contract exists', () => {
    const strategy = builder.build({
      ...baseInput(),
      failureContract: {
        id: 'fail-1',
        summary: 'Login spinner never hides',
        primaryFailureId: 'check-spinner',
        incidentalCount: 2,
      },
    });
    expect(strategy.repairMode).toBe(true);
    const failure = strategy.sources.find(s => s.type === 'FAILURE_CONTRACT');
    expect(failure?.status).toBe('SELECTED');
    expect(failure?.required).toBe(true);
    expect(failure?.priority).toBe(3);
    expect(strategy.primaryFailureId).toBe('check-spinner');
  });

  it('represents the primary failure without requiring incidental failures', () => {
    const strategy = builder.build({
      ...baseInput(),
      failureContract: {
        id: 'fail-1',
        summary: 'primary vs incidental',
        primaryFailureId: 'check-primary',
        incidentalCount: 3,
      },
    });
    expect(strategy.primaryFailureId).toBe('check-primary');
    expect(strategy.incidentalFailureCount).toBe(3);
    expect(strategy.reasoning.some(r => r.includes('Incidental failures'))).toBe(true);
    expect(strategy.requiredSources).toEqual(['USER_TASK', 'FAILURE_CONTRACT', 'PROJECT_METADATA']);
    expect(strategy.requiredSources).toHaveLength(3);
  });

  it('does not silently enable repair mode without a Failure Contract', () => {
    const strategy = builder.build(baseInput());
    expect(strategy.repairMode).toBe(false);
    expect(strategy.primaryFailureId).toBeUndefined();
    expect(strategy.incidentalFailureCount).toBe(0);
    const failure = strategy.sources.find(s => s.type === 'FAILURE_CONTRACT');
    expect(failure?.status).toBe('EXCLUDED');
    expect(failure?.exclusionReason).toMatch(/Normal mode/);
  });

  it('ignores an empty failure contract id', () => {
    const strategy = builder.build({
      ...baseInput(),
      failureContract: {
        id: '  ',
        summary: 'invalid',
        incidentalCount: 0,
      },
    });
    expect(strategy.repairMode).toBe(false);
    expect(strategy.sources.find(s => s.type === 'FAILURE_CONTRACT')?.status).toBe('EXCLUDED');
  });
});
