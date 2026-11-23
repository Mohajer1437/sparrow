import {
  CONTEXT_SOURCE_PRIORITY,
  compareContextSourcePriority,
  isHigherPriority,
} from '../../src/domain/context-source';
import { PlannerContextStrategyBuilder } from '../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../src/domain/ai-context';
import { freezeProjectProfile, unknownProjectProfile } from '../../src/domain/project-profile';
import { SkillResolution } from '../../src/contracts/skill-resolver';

const registry = createDefaultSkillRegistry();

function skills(ids: string[]): SkillResolution {
  return {
    skills: ids.map(id => {
      const skill = registry.get(id);
      if (!skill) throw new Error('missing ' + id);
      return skill;
    }),
    reasons: ids.map(id => ({ skillId: id, source: 'explicit' as const, detail: 'test' })),
    mode: 'explicit',
  };
}

function emptyAi(root = '/tmp/proj') {
  return freezeAiContextDiscovery({
    workspaceRoot: root,
    rootPath: root + '/.ai',
    exists: false,
    files: [],
  });
}

describe('Context priority rules', () => {
  it('ranks User Task above Product QA', () => {
    expect(isHigherPriority('USER_TASK', 'PRODUCT_QA')).toBe(true);
    expect(CONTEXT_SOURCE_PRIORITY.USER_TASK).toBeLessThan(CONTEXT_SOURCE_PRIORITY.PRODUCT_QA);
  });

  it('ranks Product QA above Failure Contract in normal mode', () => {
    expect(isHigherPriority('PRODUCT_QA', 'FAILURE_CONTRACT')).toBe(true);
    const strategy = new PlannerContextStrategyBuilder().build({
      userTask: 'Fix login',
      executionDirective: {},
      projectProfile: freezeProjectProfile({
        ...unknownProjectProfile('/tmp/web'),
        projectType: 'frontend',
        detectedFrameworks: ['nextjs'],
        detectedDomains: ['frontend'],
        capabilities: ['frontend', 'nextjs'],
      }),
      resolvedSkills: skills(['frontend.core']),
      productQa: {
        objective: 'Login works',
        acceptanceCriteria: ['Login page renders'],
        verificationRequirements: [],
      },
      aiContext: emptyAi('/tmp/web'),
    });
    expect(strategy.repairMode).toBe(false);
    const productQa = strategy.sources.find(s => s.type === 'PRODUCT_QA');
    const failure = strategy.sources.find(s => s.type === 'FAILURE_CONTRACT');
    expect(productQa?.status).toBe('SELECTED');
    expect(failure?.status).toBe('EXCLUDED');
    expect(productQa!.priority).toBeLessThan(failure!.priority);
  });

  it('keeps Failure Contract at priority 3 and selects it in repair mode', () => {
    const strategy = new PlannerContextStrategyBuilder().build({
      userTask: 'Fix login',
      executionDirective: {},
      projectProfile: freezeProjectProfile({
        ...unknownProjectProfile('/tmp/web'),
        projectType: 'frontend',
        detectedFrameworks: ['nextjs'],
        detectedDomains: ['frontend'],
        capabilities: ['frontend'],
      }),
      resolvedSkills: skills(['frontend.core']),
      productQa: {
        objective: 'Login works',
        acceptanceCriteria: ['Login page renders'],
        verificationRequirements: [],
      },
      failureContract: {
        id: 'fail-1',
        summary: 'primary login failure',
        primaryFailureId: 'check-login',
        incidentalCount: 0,
      },
      aiContext: emptyAi('/tmp/web'),
    });
    expect(strategy.repairMode).toBe(true);
    const failure = strategy.sources.find(s => s.type === 'FAILURE_CONTRACT');
    expect(failure?.status).toBe('SELECTED');
    expect(failure?.required).toBe(true);
    expect(failure?.priority).toBe(3);
    expect(isHigherPriority('USER_TASK', 'FAILURE_CONTRACT')).toBe(true);
    expect(isHigherPriority('PRODUCT_QA', 'FAILURE_CONTRACT')).toBe(true);
  });

  it('ranks Project Metadata above .ai, .ai above Source Files, Source Files above Codebase Map', () => {
    expect(compareContextSourcePriority('PROJECT_METADATA', 'AI_CONTEXT')).toBeLessThan(0);
    expect(compareContextSourcePriority('AI_CONTEXT', 'SOURCE_FILES')).toBeLessThan(0);
    expect(compareContextSourcePriority('SOURCE_FILES', 'CODEBASE_MAP')).toBeLessThan(0);
    expect(CONTEXT_SOURCE_PRIORITY.PROJECT_METADATA).toBe(4);
    expect(CONTEXT_SOURCE_PRIORITY.AI_CONTEXT).toBe(5);
    expect(CONTEXT_SOURCE_PRIORITY.SOURCE_FILES).toBe(6);
    expect(CONTEXT_SOURCE_PRIORITY.CODEBASE_MAP).toBe(7);
  });
});
