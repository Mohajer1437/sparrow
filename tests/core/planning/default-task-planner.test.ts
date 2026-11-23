import { DefaultTaskPlanner } from '../../../src/core/planning/default-task-planner';
import { Provider } from '../../../src/contracts/provider';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';
import { MemoryContextBuilder } from '../../../src/contracts/memory-context-builder';
import { PlannerOutputRejectedError } from '../../../src/domain/errors/todo-plan-errors';

describe('DefaultTaskPlanner', () => {
  let mockProvider: jest.Mocked<Provider>;
  let mockWorkspaceMemory: jest.Mocked<WorkspaceMemory>;
  let mockMemoryContextBuilder: jest.Mocked<MemoryContextBuilder>;
  let planner: DefaultTaskPlanner;

  const VALID_PLAN_JSON = {
    id: 'plan-test-1',
    objective: 'Add authentication middleware',
    complexity: 'medium',
    reasoning: 'Need to analyze existing auth flow then add middleware.',
    steps: [
      {
        id: 'step-1',
        description: 'Analyze existing authentication flow',
        type: 'analysis',
        requiredTools: ['grep', 'read_file'],
        expectedOutcome: 'Understanding of current auth architecture',
      },
      {
        id: 'step-2',
        description: 'Implement middleware',
        type: 'modify',
        requiredTools: ['write_file'],
        expectedOutcome: 'New middleware file created',
      },
    ],
    affectedDomains: ['Auth', 'Middleware'],
    validationStrategy: {
      requiredTests: ['auth.test.ts'],
      successCriteria: ['Middleware intercepts requests', 'Auth tokens validated'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const AVAILABLE_TOOLS = ['grep', 'read_file', 'write_file', 'search_files', 'list_directory'];

  beforeEach(() => {
    mockProvider = { generate: jest.fn() } as any;
    mockWorkspaceMemory = {
      load: jest.fn().mockResolvedValue({
        architecturalMap: null, codebaseMap: null, knowledgeBase: null,
        loadedAt: new Date().toISOString(), isEmpty: true,
      }),
      hasKnowledge: jest.fn().mockResolvedValue(false),
      getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
    } as any;
    mockMemoryContextBuilder = { build: jest.fn().mockReturnValue('') } as any;

    planner = new DefaultTaskPlanner(
      mockProvider, mockWorkspaceMemory, mockMemoryContextBuilder
    );
  });

  describe('simple tasks', () => {
    it('creates plan for simple task', async () => {
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);
      const plan = await planner.plan({
        task: 'Add authentication middleware to the existing NestJS application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan).not.toBeNull();
      expect(plan!.objective).toBe('Add authentication middleware');
      expect(plan!.steps.length).toBe(2);
      expect(plan!.complexity).toBe('medium');
    });

    it('creates multi-step plan for complex task', async () => {
      const complexPlan = { ...VALID_PLAN_JSON, complexity: 'complex', steps: [...VALID_PLAN_JSON.steps, {
        id: 'step-3', description: 'Run integration tests', type: 'test',
        requiredTools: [], expectedOutcome: 'All tests pass',
      }]};
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(complexPlan) } as any);
      const plan = await planner.plan({
        task: 'Redesign the authentication system with JWT tokens and refresh token rotation, including tests',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan).not.toBeNull();
      expect(plan!.complexity).toBe('medium');
      expect(plan!.steps.length).toBe(3);
    });
  });

  describe('memory awareness', () => {
    it('uses workspace memory context', async () => {
      mockWorkspaceMemory.load.mockResolvedValue({
        architecturalMap: { meta: { project_name: 'test', architecture_style: 'Clean', generated_at: '' },
          system_overview: { description: '', core_modules: [] }, module_map: [] },
        codebaseMap: null, knowledgeBase: null, loadedAt: '', isEmpty: false,
      });
      mockMemoryContextBuilder.build.mockReturnValue('PROJECT CONTEXT:\nArchitecture: Clean');
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);

      await planner.plan({
        task: 'Add authentication middleware to the application following existing architectural patterns',
        availableTools: AVAILABLE_TOOLS,
      });

      expect(mockWorkspaceMemory.load).toHaveBeenCalled();
      expect(mockMemoryContextBuilder.build).toHaveBeenCalled();

      const call = mockProvider.generate.mock.calls[0][0];
      const userMessage = call.messages.find((m: any) => m.role === 'user');

      // FIX: Explicit check before accessing content (Array.find() can return undefined)
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toContain('PROJECT CONTEXT:');
    });

    it('handles missing memory gracefully', async () => {
      mockWorkspaceMemory.load.mockRejectedValue(new Error('Disk failure'));
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });

      expect(plan).not.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Memory loading failed'));
      warnSpy.mockRestore();
    });
  });

  describe('validation', () => {
    it('generates validation steps', async () => {
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);
      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan!.validationStrategy).toBeDefined();
      expect(plan!.validationStrategy.requiredTests).toContain('unit-test');
    });

    it('removes unavailable tools from steps', async () => {
      const planWithBadTool = { ...VALID_PLAN_JSON, steps: [{
        id: 'step-1', description: 'Use magical tool', type: 'analysis',
        requiredTools: ['grep', 'magical_nonexistent_tool'], expectedOutcome: 'Done',
      }]};
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(planWithBadTool) } as any);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan!.steps[0].requiredTools).toEqual(['grep']);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('removed unavailable tools'));
      warnSpy.mockRestore();
    });
  });

  describe('does not execute tools', () => {
    it('does not execute tools', async () => {
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);
      await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      const call = mockProvider.generate.mock.calls[0][0];
      expect(call.tools).toBeUndefined();
    });
  });

  describe('trivial task skipping', () => {
    it('skips planning for very short tasks', async () => {
      const plan = await planner.plan({ task: 'hi', availableTools: AVAILABLE_TOOLS });
      expect(plan).toBeNull();
      expect(mockProvider.generate).not.toHaveBeenCalled();
    });

    it('still plans short repair tasks', async () => {
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(VALID_PLAN_JSON) } as any);
      const plan = await planner.plan({
        task: '[REPAIR] fix',
        availableTools: AVAILABLE_TOOLS,
        failureContract: 'typecheck failed',
      });
      expect(plan).not.toBeNull();
      expect(mockProvider.generate).toHaveBeenCalled();
    });

    it('skips planning for empty tasks', async () => {
      const plan = await planner.plan({ task: '', availableTools: AVAILABLE_TOOLS });
      expect(plan).toBeNull();
    });
  });

  describe('error handling', () => {
    it('returns null when provider fails', async () => {
      mockProvider.generate.mockRejectedValue(new Error('LLM unavailable'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Planning failed'));
      warnSpy.mockRestore();
    });

    it('rejects malformed planner JSON instead of returning a plan', async () => {
      mockProvider.generate.mockResolvedValue({ content: 'This is not JSON' } as any);
      await expect(planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      })).rejects.toBeInstanceOf(PlannerOutputRejectedError);
    });

    it('never throws on any failure mode', async () => {
      mockProvider.generate.mockRejectedValue(new Error('Catastrophic failure'));
      jest.spyOn(console, 'warn').mockImplementation();
      await expect(planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      })).resolves.toBeNull();
      jest.restoreAllMocks();
    });
  });

  describe('plan normalization', () => {
    it('fills missing fields with safe defaults', async () => {
      const minimalPlan = { id: 'plan-minimal', objective: 'Do something',
        steps: [{ description: 'A step' }] };
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(minimalPlan) } as any);
      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan).not.toBeNull();
      expect(plan!.complexity).toBe('simple');
      expect(plan!.steps[0].id).toBe('todo-1');
      expect(plan!.steps[0].type).toBe('analysis');
    });

    it('normalizes invalid complexity to default', async () => {
      const planWithBadComplexity = { ...VALID_PLAN_JSON, complexity: 'invalid-value' };
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(planWithBadComplexity) } as any);
      const plan = await planner.plan({
        task: 'Add authentication middleware to the application with proper JWT validation',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan!.complexity).toBe('medium');
    });

    it('unions implicated repair files into expectedFiles even when the LLM lists only the original task file', async () => {
      const repairPlan = {
        ...VALID_PLAN_JSON,
        steps: [{
          id: 'step-1',
          description: 'Update app/page.tsx footer',
          type: 'modify',
          requiredTools: ['write_file'],
          expectedOutcome: 'Footer text updated',
          expectedFiles: ['app/page.tsx'],
        }],
      };
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(repairPlan) } as any);
      const plan = await planner.plan({
        task: '[REPAIR] In app/page.tsx set the home-page footer',
        availableTools: AVAILABLE_TOOLS,
        failureContract: 'FAILURE CONTRACT\nFile: app/layout.tsx\nImplicated files (must be in the repair plan): app/layout.tsx, app/CrashBeacon.tsx\npageerror: Error: controlled VnV crash beacon',
      });
      expect(plan!.steps[0].expectedFiles).toEqual(expect.arrayContaining([
        'app/page.tsx',
        'app/layout.tsx',
        'app/CrashBeacon.tsx',
      ]));
    });
  });

  describe('structured TodoPlan output', () => {
    const TODO_JSON = {
      goal: 'Inspect app/page.tsx',
      contextSummary: 'Next.js frontend. Gathered app/page.tsx.',
      affectedFiles: ['app/page.tsx'],
      constraints: ['Do not expand scope'],
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect the home page',
          description: 'Read app/page.tsx and summarize its structure.',
          reason: 'Named by the task and present in gathered SOURCE_FILES.',
          files: ['app/page.tsx'],
          dependencies: [],
          skillIds: ['frontend.core'],
          verificationRequirements: ['browser'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    it('returns an ExecutionPlan that carries the validated TodoPlan', async () => {
      mockProvider.generate.mockResolvedValue({ content: JSON.stringify(TODO_JSON) } as any);
      const plan = await planner.plan({
        task: 'Inspect app/page.tsx and explain how the current page is structured without modifying files',
        availableTools: AVAILABLE_TOOLS,
      });
      expect(plan).not.toBeNull();
      expect(plan!.todoPlan?.goal).toBe('Inspect app/page.tsx');
      expect(plan!.todoPlan?.todos[0].id).toBe('todo-1');
      expect(plan!.todoPlan?.todos[0].files).toEqual(['app/page.tsx']);
      expect(plan!.steps[0].id).toBe('todo-1');
    });

    it('rejects duplicate todo IDs', async () => {
      mockProvider.generate.mockResolvedValue({
        content: JSON.stringify({
          ...TODO_JSON,
          todos: [TODO_JSON.todos[0], TODO_JSON.todos[0]],
        }),
      } as any);
      await expect(planner.plan({
        task: 'Inspect app/page.tsx and explain how the current page is structured without modifying files',
        availableTools: AVAILABLE_TOOLS,
      })).rejects.toBeInstanceOf(PlannerOutputRejectedError);
    });

    it('rejects unknown skill IDs from the model', async () => {
      mockProvider.generate.mockResolvedValue({
        content: JSON.stringify({
          ...TODO_JSON,
          todos: [{ ...TODO_JSON.todos[0], skillIds: ['invented.skill'] }],
        }),
      } as any);
      await expect(planner.plan({
        task: 'Inspect app/page.tsx and explain how the current page is structured without modifying files',
        availableTools: AVAILABLE_TOOLS,
      })).rejects.toBeInstanceOf(PlannerOutputRejectedError);
    });
  });
});
