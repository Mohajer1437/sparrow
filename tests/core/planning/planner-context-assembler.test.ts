import { DefaultPlannerContextAssembler } from '../../../src/core/planning/planner-context-assembler';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../../src/domain/context-gathering-limits';
import { emptyGatheredContext } from '../../../src/domain/gathered-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { formatPlannerContextSummary } from '../../../src/domain/planner-context';

const registry = createDefaultSkillRegistry();
const assembler = new DefaultPlannerContextAssembler();
const builder = new PlannerContextStrategyBuilder();

describe('PlannerContext assembly', () => {
  const projectProfile = freezeProjectProfile({
    workspaceRoot: '/tmp/web',
    projectType: 'frontend',
    detectedFrameworks: ['nextjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: ['jest'],
    detectedDomains: ['frontend'],
    capabilities: ['frontend', 'nextjs'],
  });
  const resolvedSkills = {
    skills: [registry.get('frontend.core')!],
    reasons: [{ skillId: 'frontend.core', source: 'system-rule' as const, detail: 'frontend' }],
    mode: 'rules' as const,
  };
  const aiContext = freezeAiContextDiscovery({
    workspaceRoot: '/tmp/web',
    rootPath: '/tmp/web/.ai',
    exists: false,
    files: [],
  });
  const strategy = builder.build({
    userTask: 'Fix login page loading state',
    executionDirective: { requestedDomains: ['frontend'] },
    projectProfile,
    resolvedSkills,
    productQa: {
      objective: 'Login loading state is honest',
      acceptanceCriteria: ['Spinner hides after load'],
      verificationRequirements: ['browser'],
    },
    aiContext,
  });

  const context = assembler.assemble({
    userTask: 'Fix login page loading state',
    executionDirective: { requestedDomains: ['frontend'] },
    projectProfile,
    resolvedSkills,
    aiContext,
    strategy,
    gathered: emptyGatheredContext('/tmp/web', DEFAULT_CONTEXT_GATHERING_LIMITS),
    productQa: {
      objective: 'Login loading state is honest',
      acceptanceCriteria: ['Spinner hides after load'],
      verificationRequirements: ['browser'],
    },
  });

  it('includes the user task', () => {
    expect(context.userTask).toBe('Fix login page loading state');
  });

  it('includes the project profile', () => {
    expect(context.projectProfile.projectType).toBe('frontend');
    expect(context.projectProfile.detectedFrameworks).toEqual(['nextjs']);
  });

  it('includes resolved skills', () => {
    expect(context.resolvedSkills.skills.map(s => s.id)).toEqual(['frontend.core']);
  });

  it('includes selected sources', () => {
    expect(context.sources.filter(s => s.status === 'SELECTED').map(s => s.type))
      .toEqual(context.strategy.selectedSources);
    expect(context.strategy.selectedSources).toEqual(
      expect.arrayContaining(['USER_TASK', 'PRODUCT_QA', 'PROJECT_METADATA', 'SOURCE_FILES']),
    );
  });

  it('includes excluded sources', () => {
    expect(context.strategy.excludedSources).toEqual(
      expect.arrayContaining(['FAILURE_CONTRACT', 'CODEBASE_MAP']),
    );
  });

  it('includes missing context', () => {
    expect(context.strategy.missingOptional).toContain('AI_CONTEXT');
  });

  it('keeps strategy metadata traceable', () => {
    expect(context.strategy.reasoning.length).toBeGreaterThan(0);
    expect(context.gathered.workspaceRoot).toBe('/tmp/web');
    expect(formatPlannerContextSummary(context)).toContain('repairMode=false');
    expect(formatPlannerContextSummary(context)).toContain('gathered=');
    expect(formatPlannerContextSummary(context)).toContain('frontend.core');
    expect(Object.isFrozen(context)).toBe(true);
  });
});
