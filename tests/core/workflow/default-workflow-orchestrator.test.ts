import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { SessionManager } from '../../../src/core/session/session-manager';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';
import { TaskPlanner } from '../../../src/contracts/task-planner';
import { ImpactAnalyzer } from '../../../src/contracts/impact-analyzer';
import { Reviewer } from '../../../src/contracts/reviewer';
import { SafePatchExecutor } from '../../../src/core/patch/safe-patch-executor';
import { GitManager } from '../../../src/contracts/git-manager';
import { ReflectionEngine } from '../../../src/contracts/reflection-engine';

describe('DefaultWorkflowOrchestrator', () => {
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockWorkspaceMemory: jest.Mocked<WorkspaceMemory>;
  let mockTaskPlanner: jest.Mocked<TaskPlanner>;
  let mockImpactAnalyzer: jest.Mocked<ImpactAnalyzer>;
  let mockReviewer: jest.Mocked<Reviewer>;
  let mockSafePatchExecutor: jest.Mocked<SafePatchExecutor>;
  let mockGitManager: jest.Mocked<GitManager>;
  let mockReflectionEngine: jest.Mocked<ReflectionEngine>;
  let orchestrator: DefaultWorkflowOrchestrator;
  let mockPlanValidator: any;
  let mockVerificationStrategyEngine: any;

  beforeEach(() => {
    mockSessionManager = {
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
        workspacePath: '/test'
      }),
      recordReflection: jest.fn().mockResolvedValue(undefined),
      recordDecision: jest.fn().mockResolvedValue(undefined),
      recordStepStarted: jest.fn().mockResolvedValue(undefined),
      recordStepCompleted: jest.fn().mockResolvedValue(undefined),
      recordStepFailed: jest.fn().mockResolvedValue(undefined),
      pauseSession: jest.fn().mockResolvedValue(undefined),
      resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
    } as any;

    mockWorkspaceMemory = {
      load: jest.fn().mockResolvedValue({ isEmpty: true }),
    } as any;

    mockTaskPlanner = {
      plan: jest.fn().mockResolvedValue({ id: 'plan-1', steps: [] }),
    } as any;

    mockImpactAnalyzer = {
      analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }),
    } as any;

    mockReviewer = {
      review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }),
    } as any;

    mockSafePatchExecutor = {
      executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }),
    } as any;

    mockGitManager = {
      isRepository: jest.fn().mockResolvedValue(true),
      commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
      status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }),
    } as any;

    mockReflectionEngine = {
      generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }),
    } as any;

    mockPlanValidator = {
      validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      resolveDependencies: jest.fn().mockReturnValue([]),
    } as any;

    mockVerificationStrategyEngine = {
      generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }),
    } as any;

    orchestrator = new DefaultWorkflowOrchestrator(
      mockSessionManager,
      mockWorkspaceMemory,
      mockTaskPlanner,
      mockImpactAnalyzer,
      mockReviewer,
      mockSafePatchExecutor,
      mockGitManager,
      mockReflectionEngine,
      mockPlanValidator,
      mockVerificationStrategyEngine
    );
  });

  it('executes a complete successful workflow', async () => {
    const result = await orchestrator.execute({
      task: 'Add feature',
      targetFiles: ['src/core/a.ts'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/core/a.ts', operation: 'modify', newContent: 'new' }] },
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('sess-1');
    expect(mockSessionManager.startSession).toHaveBeenCalled();
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockImpactAnalyzer.analyze).toHaveBeenCalled();
    expect(mockReviewer.review).toHaveBeenCalled();
    expect(mockSafePatchExecutor.executeWithVerification).toHaveBeenCalled();
    expect(mockGitManager.commit).toHaveBeenCalled();
    expect(mockReflectionEngine.generate).toHaveBeenCalled();
    expect(mockSessionManager.completeSession).toHaveBeenCalled();
  });

  it('aborts when planner returns null', async () => {
    mockTaskPlanner.plan.mockResolvedValue(null);

    const result = await orchestrator.execute({ task: 'Test' });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('planning');
    expect(mockSessionManager.failSession).toHaveBeenCalled();
  });

  it('aborts when reviewer fails', async () => {
    mockReviewer.review.mockResolvedValue({ failedCount: 2, passedCount: 3, checks: [] } as any);

    const result = await orchestrator.execute({
      task: 'Test',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('review');
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
  });

  it('handles patch execution failure', async () => {
    mockSafePatchExecutor.executeWithVerification.mockResolvedValue({
      success: false,
      attempts: 3,
      finalError: 'Validation failed',
    });

    const result = await orchestrator.execute({
      task: 'Test',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('patch-execution');
    expect(mockReflectionEngine.generate).toHaveBeenCalled();
  });

  it('is fail-safe when session start fails', async () => {
    mockSessionManager.startSession.mockResolvedValue(null);

    const result = await orchestrator.execute({ task: 'Test' });

    expect(result.success).toBe(false);
    expect(result.sessionId).toBe('');
  });

  it('generates reflection even on unexpected error', async () => {
    mockTaskPlanner.plan.mockRejectedValue(new Error('Unexpected'));

    const result = await orchestrator.execute({ task: 'Test' });

    expect(result.success).toBe(false);
    expect(mockReflectionEngine.generate).toHaveBeenCalled();
  });

  // R4.14: Plan Validation Integration
  it('aborts when plan validation fails', async () => {
    mockPlanValidator.validate.mockResolvedValue({
      valid: false,
      errors: [{ code: 'INVALID', message: 'Invalid plan structure' }],
      warnings: [],
      evidence: [],
    });

    const result = await orchestrator.execute({ task: 'Test task for validation' });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('plan-validation');
    expect(mockSessionManager.failSession).toHaveBeenCalled();
  });

  // R4.14: Step Events
  it('records step events during patch execution', async () => {
    const result = await orchestrator.execute({
      task: 'Add feature',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(result.success).toBe(true);
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalledWith('sess-1', 'patch-execution', expect.any(String));
    expect(mockSessionManager.recordStepCompleted).toHaveBeenCalledWith('sess-1', 'patch-execution', expect.any(String));
  });

  // R4.14: Governor Integration
  it('pauses and resumes when governor requests pause', async () => {
    const localMockGovernor = {
      evaluate: jest.fn().mockReturnValue({ action: 'pause', reason: 'CPU high', timestamp: new Date().toISOString() }),
      getPolicy: jest.fn().mockReturnValue({ pauseDurationMs: 10, cpuThreshold: 90, memoryThreshold: 85, temperatureThreshold: 80, healthCheckIntervalMs: 5000, autoResume: true }),
    };
    const localMockHealthProvider = {
      collect: jest.fn().mockResolvedValue({ cpuUtilization: { value: 95, unit: '%', timestamp: new Date().toISOString() } }),
    };

    const orchestratorWithGovernor = new DefaultWorkflowOrchestrator(
      mockSessionManager, mockWorkspaceMemory, mockTaskPlanner, mockImpactAnalyzer,
      mockReviewer, mockSafePatchExecutor, mockGitManager, mockReflectionEngine,
      mockPlanValidator, mockVerificationStrategyEngine, undefined,
      localMockGovernor as any, localMockHealthProvider as any,
    );

    const result = await orchestratorWithGovernor.execute({
      task: 'Test',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(mockSessionManager.pauseSession).toHaveBeenCalledWith('sess-1', 'CPU high');
    expect(mockSessionManager.resumeSession).toHaveBeenCalledWith('sess-1');
  });
});
