import { DefaultTaskPlanner } from '../../../src/core/planning/default-task-planner';
import { DefaultPlannerContextAssembler } from '../../../src/core/planning/planner-context-assembler';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { PLANNER_SYSTEM_PROMPT } from '../../../src/core/planning/planner-prompt';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../../src/domain/context-gathering-limits';
import { freezeGatheredContext, validateGatheredContextRecord } from '../../../src/domain/gathered-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { PlannerOutputRejectedError } from '../../../src/domain/errors/todo-plan-errors';

const registry = createDefaultSkillRegistry();

function makePlanner() {
  const mockProvider = { generate: jest.fn() } as any;
  const mockWorkspaceMemory = {
    load: jest.fn().mockResolvedValue({
      architecturalMap: null, codebaseMap: null, knowledgeBase: null,
      loadedAt: new Date().toISOString(), isEmpty: true,
    }),
    hasKnowledge: jest.fn().mockResolvedValue(false),
    getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
  } as any;
  const mockMemoryContextBuilder = { build: jest.fn().mockReturnValue('') } as any;
  return {
    planner: new DefaultTaskPlanner(mockProvider, mockWorkspaceMemory, mockMemoryContextBuilder),
    mockProvider,
  };
}

function makeContext() {
  const resolvedSkills = {
    skills: [registry.get('frontend.core')!],
    reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'test' }],
    mode: 'explicit' as const,
  };
  const projectProfile = freezeProjectProfile({
    workspaceRoot: 'E:/proj',
    projectType: 'frontend',
    detectedFrameworks: ['nextjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: [],
    detectedDomains: ['frontend'],
    capabilities: ['frontend'],
  });
  const aiContext = freezeAiContextDiscovery({
    workspaceRoot: 'E:/proj',
    rootPath: 'E:/proj/.ai',
    exists: true,
    files: [],
  });
  const input = {
    userTask: 'Inspect app/page.tsx',
    executionDirective: { requestedDomains: ['frontend' as const] },
    projectProfile,
    resolvedSkills,
    aiContext,
  };
  return new DefaultPlannerContextAssembler().assemble({
    ...input,
    strategy: new PlannerContextStrategyBuilder().build(input),
    gathered: freezeGatheredContext({
      workspaceRoot: 'E:/proj',
      records: [
        validateGatheredContextRecord({
          source: 'SOURCE_FILES',
          reference: 'app/page.tsx',
          status: 'COLLECTED',
          reason: 'explicitly referenced by task',
          collectionMethod: 'WORKSPACE_READ',
          content: 'export default function Home() { return null; }',
          truncated: false,
          sizeBytes: 48,
          priority: 1,
        }),
        validateGatheredContextRecord({
          source: 'AI_CONTEXT',
          reference: '.ai/frontend/auth.md',
          status: 'COLLECTED',
          reason: 'domain=frontend',
          collectionMethod: 'AI_CONTEXT_LOAD',
          content: 'Keep existing login middleware.',
          truncated: false,
          sizeBytes: 30,
          priority: 2,
        }),
      ],
      totalBytes: 78,
      fileCount: 2,
      truncatedCount: 0,
      limitReached: false,
      limits: DEFAULT_CONTEXT_GATHERING_LIMITS,
    }),
  });
}

describe('TodoPlan planner context integration', () => {
  const TASK = 'Inspect app/page.tsx and create a structured plan for a small safe improvement. Do not modify files.';

  it('produces a TodoPlan from project metadata, gathered files, .ai context, skills, and directive', async () => {
    const { planner, mockProvider } = makePlanner();
    mockProvider.generate.mockResolvedValue({
      content: JSON.stringify({
        goal: 'Inspect app/page.tsx',
        contextSummary: 'Next.js frontend. Gathered app/page.tsx and .ai/frontend/auth.md.',
        affectedFiles: ['app/page.tsx'],
        constraints: ['Do not expand beyond app/page.tsx', 'Use frontend.core only'],
        todos: [{
          id: 'todo-1',
          title: 'Inspect the gathered home page',
          description: 'Use the gathered app/page.tsx source to describe current structure.',
          reason: 'SOURCE_FILES collected app/page.tsx; AI_CONTEXT selected frontend auth notes.',
          files: ['app/page.tsx'],
          dependencies: [],
          skillIds: ['frontend.core'],
          verificationRequirements: ['browser'],
          risk: 'LOW',
          action: 'inspect',
        }],
      }),
    } as any);

    const plan = await planner.plan({
      task: TASK,
      availableTools: ['read_file'],
      plannerContext: makeContext(),
    });
    expect(plan?.todoPlan?.affectedFiles).toEqual(['app/page.tsx']);
    expect(plan?.todoPlan?.todos[0].skillIds).toEqual(['frontend.core']);
    const user = String(mockProvider.generate.mock.calls[0][0].messages.find((m: { role: string }) => m.role === 'user').content);
    expect(user).toContain('app/page.tsx');
    expect(user).toContain('.ai/frontend/auth.md');
    expect(user).toContain('frontend.core');
    expect(user).toContain('requestedDomains: frontend');
  });

  it('keeps primary repair failure as the plan target and does not promote incidental noise', async () => {
    const { planner, mockProvider } = makePlanner();
    mockProvider.generate.mockResolvedValue({
      content: JSON.stringify({
        goal: 'Repair the primary spinner failure',
        contextSummary: 'Primary failure is spinner visibility. Incidental console noise in src/noise.ts is not a search target.',
        affectedFiles: ['src/auth/middleware.ts'],
        constraints: ['Repair PRIMARY failure only'],
        todos: [{
          id: 'todo-1',
          title: 'Fix spinner hiding in auth middleware',
          description: 'Modify src/auth/middleware.ts so the spinner is no longer stuck visible.',
          reason: 'PRIMARY failure points at src/auth/middleware.ts. Incidental src/noise.ts must not become a todo.',
          files: ['src/auth/middleware.ts'],
          dependencies: [],
          skillIds: ['frontend.core'],
          verificationRequirements: ['browser'],
          risk: 'HIGH',
          action: 'modify',
        }],
      }),
    } as any);
    const plan = await planner.plan({
      task: '[REPAIR] spinner still visible',
      availableTools: ['write_file', 'read_file'],
      failureContract: 'PRIMARY spinner. incidental src/noise.ts',
      plannerContext: makeContext(),
    });
    const files = plan?.todoPlan?.todos.flatMap(todo => todo.files) ?? [];
    expect(files).toContain('src/auth/middleware.ts');
    expect(files).not.toContain('src/noise.ts');
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/incidental\/noise failures/i);
  });

  it('rejects a dependency cycle from the model', async () => {
    const { planner, mockProvider } = makePlanner();
    mockProvider.generate.mockResolvedValue({
      content: JSON.stringify({
        goal: 'Inspect page',
        contextSummary: 'gathered',
        affectedFiles: ['app/page.tsx', 'middleware.ts'],
        constraints: [],
        todos: [
          {
            id: 'todo-1',
            title: 'A',
            description: 'A',
            reason: 'A',
            files: ['app/page.tsx'],
            dependencies: ['todo-2'],
            skillIds: ['frontend.core'],
            verificationRequirements: ['browser'],
            risk: 'LOW',
            action: 'inspect',
          },
          {
            id: 'todo-2',
            title: 'B',
            description: 'B',
            reason: 'B',
            files: ['middleware.ts'],
            dependencies: ['todo-1'],
            skillIds: ['frontend.core'],
            verificationRequirements: ['browser'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      }),
    } as any);
    await expect(planner.plan({
      task: TASK,
      availableTools: ['read_file'],
      plannerContext: makeContext(),
    })).rejects.toBeInstanceOf(PlannerOutputRejectedError);
  });
});
