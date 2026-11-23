import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeProjectProfile, unknownProjectProfile } from '../../../src/domain/project-profile';
import { SkillResolution } from '../../../src/contracts/skill-resolver';
import { ContextStrategyInput } from '../../../src/contracts/context-strategy';

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

function skills(ids: string[]): SkillResolution {
  return {
    skills: ids.map(id => {
      const skill = registry.get(id);
      if (!skill) throw new Error('missing ' + id);
      return skill;
    }),
    reasons: ids.map(id => ({ skillId: id, source: 'explicit' as const, detail: 'test' })),
    mode: ids.length ? 'explicit' : 'rules',
  };
}

function frontendProfile() {
  return freezeProjectProfile({
    workspaceRoot: '/tmp/web',
    projectType: 'frontend',
    detectedFrameworks: ['nextjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: ['jest'],
    detectedDomains: ['frontend', 'testing'],
    capabilities: ['frontend', 'nextjs', 'testing'],
  });
}

function backendProfile() {
  return freezeProjectProfile({
    workspaceRoot: '/tmp/api',
    projectType: 'backend',
    detectedFrameworks: ['nestjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: [],
    detectedDomains: ['backend'],
    capabilities: ['backend', 'nestjs'],
  });
}

function ai(exists: boolean, present: string[] = []) {
  return freezeAiContextDiscovery({
    workspaceRoot: '/tmp/web',
    rootPath: '/tmp/web/.ai',
    exists,
    files: ['project', 'frontend', 'backend', 'dependencies', 'maps'].map(name => ({
      name: name as 'project',
      relativePath: '.ai/' + name,
      exists: exists && present.includes(name),
    })),
  });
}

function input(overrides: Partial<ContextStrategyInput> = {}): ContextStrategyInput {
  return {
    userTask: 'Fix login page loading state',
    executionDirective: {},
    projectProfile: frontendProfile(),
    resolvedSkills: skills(['frontend.core']),
    aiContext: ai(false),
    ...overrides,
  };
}

describe('PlannerContextStrategyBuilder', () => {
  it('builds a frontend strategy with selected source files and excluded backend graph', () => {
    const strategy = builder.build(input());
    expect(strategy.repairMode).toBe(false);
    expect(strategy.selectedSources).toEqual(['USER_TASK', 'PROJECT_METADATA', 'SOURCE_FILES']);
    expect(strategy.deferredSources).toEqual([]);
    expect(strategy.excludedSources).toEqual(expect.arrayContaining(['FAILURE_CONTRACT', 'CODEBASE_MAP']));
    expect(strategy.missingOptional).toContain('AI_CONTEXT');
    const codebase = strategy.sources.find(s => s.type === 'CODEBASE_MAP');
    expect(codebase?.exclusionReason).toMatch(/not required/i);
  });

  it('builds a backend strategy that optionally defers the codebase map', () => {
    const strategy = builder.build(input({
      projectProfile: backendProfile(),
      resolvedSkills: skills(['backend.core']),
      userTask: 'Add health endpoint',
    }));
    expect(strategy.selectedSources).toEqual(['USER_TASK', 'PROJECT_METADATA', 'SOURCE_FILES']);
    expect(strategy.deferredSources).toEqual(['CODEBASE_MAP']);
    expect(strategy.excludedSources).not.toContain('CODEBASE_MAP');
  });

  it('follows an explicit execution directive rather than the project type', () => {
    const strategy = builder.build(input({
      executionDirective: { explicitSkillIds: ['backend.core'] },
      resolvedSkills: skills(['backend.core']),
      projectProfile: frontendProfile(),
    }));
    expect(strategy.deferredSources).toContain('CODEBASE_MAP');
    expect(strategy.excludedSources).not.toContain('CODEBASE_MAP');
    expect(strategy.reasoning.some(r => r.includes('backend.core'))).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const payload = input({
      productQa: {
        objective: 'Login works',
        acceptanceCriteria: ['spinner hides'],
        verificationRequirements: ['browser'],
      },
    });
    const first = builder.build(payload);
    const second = builder.build(payload);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    expect(first.sources.map(s => s.type)).toEqual(second.sources.map(s => s.type));
  });

  it('does not depend on an LLM or provider', () => {
    const result = builder.build(input());
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof builder.build).toBe('function');
    expect(builder.build.length).toBe(1);
    expect(Object.getOwnPropertyNames(PlannerContextStrategyBuilder.prototype)).toEqual(
      expect.arrayContaining(['build']),
    );
  });

  it('applies generic skill context requirements', () => {
    const frontend = builder.build(input({ resolvedSkills: skills(['frontend.core']) }));
    expect(frontend.reasoning.some(r => r.includes('frontend.core requires PROJECT_METADATA'))).toBe(true);
    expect(frontend.reasoning.some(r => r.includes('optionally uses AI_CONTEXT'))).toBe(true);

    const backend = builder.build(input({
      projectProfile: backendProfile(),
      resolvedSkills: skills(['backend.core']),
    }));
    expect(backend.reasoning.some(r => r.includes('optionally uses CODEBASE_MAP'))).toBe(true);
  });

  it('reports missing required context', () => {
    const strategy = builder.build(input({
      userTask: '   ',
      projectProfile: unknownProjectProfile('/tmp/empty'),
      resolvedSkills: { skills: [], reasons: [], mode: 'rules' },
    }));
    expect(strategy.missingRequired).toEqual(expect.arrayContaining(['USER_TASK', 'PROJECT_METADATA']));
    expect(strategy.selectedSources).not.toContain('USER_TASK');
  });

  it('selects relevant .ai context and leaves unrelated domain files unselected', () => {
    const selected = builder.build(input({
      aiContext: ai(true, ['project', 'frontend']),
    }));
    expect(selected.selectedSources).toContain('AI_CONTEXT');
    const selectedSource = selected.sources.find(s => s.type === 'AI_CONTEXT');
    expect(selectedSource?.selectionReason).toMatch(/frontend/);

    const unrelated = builder.build(input({
      aiContext: ai(true, ['backend']),
    }));
    const unrelatedSource = unrelated.sources.find(s => s.type === 'AI_CONTEXT');
    expect(unrelatedSource?.status).toBe('AVAILABLE_BUT_NOT_SELECTED');
    expect(unrelatedSource?.selectionReason).toMatch(/No relevant \.ai metadata/);
  });

  it('selects source files for targeted gathering', () => {
    const strategy = builder.build(input());
    const sourceFiles = strategy.sources.find(s => s.type === 'SOURCE_FILES');
    expect(sourceFiles?.status).toBe('SELECTED');
    expect(sourceFiles?.required).toBe(false);
    expect(sourceFiles?.selectionReason).toMatch(/targeted source-file gathering/i);
  });
});
