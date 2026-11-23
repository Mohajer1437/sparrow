import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { PlannerOutputRejectedError } from '../../../src/domain/errors/todo-plan-errors';
import { PlannerContext } from '../../../src/domain/planner-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeContextStrategy } from '../../../src/domain/context-strategy';
import { CONTEXT_SOURCE_PRIORITY, validateContextSource } from '../../../src/domain/context-source';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../../src/domain/context-gathering-limits';
import { emptyGatheredContext } from '../../../src/domain/gathered-context';

function fakePlannerContext(): PlannerContext {
  const sources = [
    validateContextSource({
      type: 'USER_TASK',
      priority: CONTEXT_SOURCE_PRIORITY.USER_TASK,
      required: true,
      available: true,
      status: 'SELECTED',
      selectionReason: 'task',
    }),
    validateContextSource({
      type: 'PROJECT_METADATA',
      priority: CONTEXT_SOURCE_PRIORITY.PROJECT_METADATA,
      required: true,
      available: true,
      status: 'SELECTED',
      selectionReason: 'profile',
    }),
  ];
  const strategy = freezeContextStrategy({
    repairMode: false,
    sources,
    selectedSources: ['USER_TASK', 'PROJECT_METADATA'],
    requiredSources: ['USER_TASK', 'PROJECT_METADATA'],
    optionalSources: [],
    excludedSources: [],
    deferredSources: [],
    missingRequired: [],
    missingOptional: [],
    reasoning: ['test'],
    incidentalFailureCount: 0,
  });
  return {
    userTask: 'Add feature',
    executionDirective: {},
    projectProfile: freezeProjectProfile({
      workspaceRoot: '/tmp/web',
      projectType: 'frontend',
      detectedFrameworks: ['nextjs'],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: [],
      detectedDomains: ['frontend'],
      capabilities: ['frontend'],
    }),
    resolvedSkills: { skills: [], reasons: [], mode: 'rules' },
    aiContext: freezeAiContextDiscovery({
      workspaceRoot: '/tmp/web',
      rootPath: '/tmp/web/.ai',
      exists: false,
      files: [],
    }),
    sources,
    strategy,
    repairMode: false,
    gathered: emptyGatheredContext('/tmp/web', DEFAULT_CONTEXT_GATHERING_LIMITS),
  };
}

function createOrchestrator(extra: { preparer?: any; workspacePath?: string; planner?: any; decomposer?: any; executionPlanner?: any } = {}) {
  const mockSessionManager = {
    startSession: jest.fn().mockResolvedValue('sess-1'),
    completeSession: jest.fn().mockResolvedValue(undefined),
    failSession: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn().mockResolvedValue({
      id: 'sess-1',
      task: 'test',
      status: 'executing',
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: '/test',
    }),
    recordReflection: jest.fn(),
    recordDecision: jest.fn(),
    recordStepStarted: jest.fn(),
    recordStepCompleted: jest.fn(),
    recordStepFailed: jest.fn(),
    pauseSession: jest.fn(),
    resumeSession: jest.fn(),
  } as any;

  const mockPlanner = extra.planner ?? {
    plan: jest.fn().mockResolvedValue({ id: 'plan-1', steps: [], complexity: 'simple' }),
  };

  const orchestrator = new DefaultWorkflowOrchestrator(
    mockSessionManager,
    { load: jest.fn().mockResolvedValue({ isEmpty: true }) } as any,
    mockPlanner,
    { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) } as any,
    { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }) } as any,
    { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) } as any,
    {
      isRepository: jest.fn().mockResolvedValue(true),
      commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
      status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }),
    } as any,
    { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) } as any,
    { validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }), resolveDependencies: jest.fn().mockReturnValue([]) } as any,
    { generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }) } as any,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, extra.executionPlanner, extra.decomposer,
    undefined,
    extra.workspacePath,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined,
    extra.preparer,
  );

  return { orchestrator, mockPlanner, mockSessionManager };
}

describe('Planner context workflow boundary', () => {
  it('keeps the existing pipeline working when no preparer is wired', async () => {
    const { orchestrator, mockPlanner } = createOrchestrator();
    const result = await orchestrator.execute({
      task: 'Add feature',
      targetFiles: ['src/core/a.ts'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/core/a.ts', operation: 'modify', newContent: 'new' }] },
    });
    expect(result.success).toBe(true);
    expect(mockPlanner.plan).toHaveBeenCalled();
    expect(result.plannerContext).toBeUndefined();
  });

  it('passes assembled PlannerContext into the planner request without changing execution', async () => {
    const context = fakePlannerContext();
    const preparer = { prepare: jest.fn().mockResolvedValue(context) };
    const { orchestrator, mockPlanner } = createOrchestrator({
      preparer,
      workspacePath: '/tmp/web',
    });

    const result = await orchestrator.execute({
      task: 'Add feature',
      executionDirective: { explicitSkillIds: ['frontend.core'] },
      targetFiles: ['src/core/a.ts'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/core/a.ts', operation: 'modify', newContent: 'new' }] },
    });

    expect(result.success).toBe(true);
    expect(preparer.prepare).toHaveBeenCalledWith(expect.objectContaining({
      userTask: 'Add feature',
      workspaceRoot: '/tmp/web',
      executionDirective: { explicitSkillIds: ['frontend.core'] },
    }));
    expect(mockPlanner.plan).toHaveBeenCalledWith(expect.objectContaining({
      plannerContext: context,
    }));
    expect(result.plannerContext).toBe(context);
  });

  it('does not silently fall back to ExecutionPlanner when PlannerContext is present', async () => {
    const context = fakePlannerContext();
    const preparer = { prepare: jest.fn().mockResolvedValue(context) };
    const executionPlanner = { createPlan: jest.fn().mockReturnValue({ id: 'fallback', steps: [{ id: 'step-1' }], complexity: 'simple' }) };
    const planner = { plan: jest.fn().mockResolvedValue(null) };
    const { orchestrator } = createOrchestrator({
      planner,
      preparer,
      executionPlanner,
      workspacePath: '/tmp/web',
    });
    const result = await orchestrator.execute({
      task: 'Inspect app/page.tsx and create a structured plan. Do not modify files.',
      targetFiles: ['app/page.tsx'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'app/page.tsx', operation: 'modify', newContent: 'new' }] },
    });
    expect(executionPlanner.createPlan).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.abortReason).toMatch(/null plan/i);
    expect(result.plan).toBeNull();
  });

  it('aborts planning when TodoPlan output is rejected and does not execute', async () => {
    const planner = {
      plan: jest.fn().mockRejectedValue(new PlannerOutputRejectedError('malformed json', ['malformed json'])),
    };
    const { orchestrator, mockSessionManager } = createOrchestrator({ planner });
    const patchExecutor = (orchestrator as any).safePatchExecutor;
    const result = await orchestrator.execute({
      task: 'Inspect app/page.tsx and create a structured plan. Do not modify files.',
      targetFiles: ['app/page.tsx'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'app/page.tsx', operation: 'modify', newContent: 'new' }] },
    });
    expect(result.success).toBe(false);
    expect(result.abortReason).toMatch(/Planning failed/i);
    expect(patchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(mockSessionManager.failSession).toHaveBeenCalled();
  });

  it('does not rewrite Todo IDs when a TodoPlan is present and a decomposer is wired', async () => {
    const decomposer = {
      decompose: jest.fn().mockReturnValue({
        planId: 'plan-todo-1',
        tasks: [{
          id: 'mt-0',
          title: 'rewritten',
          description: 'rewritten',
          targetFiles: ['app/page.tsx'],
          dependencies: [],
          expectedOutput: 'done',
          verificationSteps: [],
          rollbackStrategy: 'undo',
          complexity: 'simple',
          riskLevel: 'high',
          reasoningRequired: 'none',
          difficultyScore: 9,
          requiredContext: { files: [], symbols: [], previousTaskOutputs: [] },
        }],
        totalTasks: 1,
        highRiskTasks: 1,
        averageDifficulty: 9,
        createdAt: '1970-01-01T00:00:00.000Z',
      }),
      validateGraph: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };
    const todoPlan = {
      goal: 'Inspect app/page.tsx',
      contextSummary: 'gathered app/page.tsx',
      affectedFiles: ['app/page.tsx'],
      constraints: ['Do not modify files'],
      todos: [{
        id: 'todo-1',
        title: 'Inspect the page',
        description: 'Read app/page.tsx',
        reason: 'Named by the task',
        files: ['app/page.tsx'],
        dependencies: [],
        skillIds: ['frontend.core'],
        verificationRequirements: ['deterministic'],
        risk: 'LOW',
      }],
    };
    const planner = {
      plan: jest.fn().mockResolvedValue({
        id: 'plan-todo-1',
        objective: todoPlan.goal,
        complexity: 'simple',
        reasoning: todoPlan.contextSummary,
        steps: [{
          id: 'todo-1',
          description: 'Inspect the page: Read app/page.tsx',
          type: 'analysis',
          requiredTools: ['read_file'],
          expectedOutcome: 'Read app/page.tsx',
          expectedFiles: ['app/page.tsx'],
          validationCriteria: ['deterministic'],
          skillIds: ['frontend.core'],
          sourceTodoId: 'todo-1',
        }],
        affectedDomains: ['frontend.core'],
        validationStrategy: { requiredTests: ['deterministic'], successCriteria: todoPlan.constraints },
        createdAt: '1970-01-01T00:00:00.000Z',
        todoPlan,
      }),
    };
    const { orchestrator } = createOrchestrator({ planner, decomposer });
    const result = await orchestrator.execute({
      task: 'Inspect app/page.tsx and create a structured plan. Do not modify files.',
      targetFiles: ['app/page.tsx'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'app/page.tsx', operation: 'modify', newContent: 'new' }] },
    });
    expect(decomposer.decompose).not.toHaveBeenCalled();
    expect(result.plan?.steps.map(step => step.id)).toEqual(['todo-1']);
    expect(result.plan?.todoPlan?.todos[0].id).toBe('todo-1');
  });

  it('does not fail the pipeline when context strategy throws', async () => {
    const preparer = { prepare: jest.fn().mockRejectedValue(new Error('strategy boom')) };
    const { orchestrator } = createOrchestrator({
      preparer,
      workspacePath: '/tmp/web',
    });
    const result = await orchestrator.execute({
      task: 'Add feature',
      targetFiles: ['src/core/a.ts'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/core/a.ts', operation: 'modify', newContent: 'new' }] },
    });
    expect(result.success).toBe(true);
    expect(result.plannerContext).toBeUndefined();
  });
});
