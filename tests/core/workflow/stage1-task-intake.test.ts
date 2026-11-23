import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { TaskIntake } from '../../../src/contracts/task-intake';
import { IntentNormalizationResult } from '../../../src/domain/pre-execution/intent';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 1: TaskIntake Integration (Observation-Only)', () => {
  let mockSessionManager: any;
  let mockWorkspaceMemory: any;
  let mockTaskPlanner: any;
  let mockImpactAnalyzer: any;
  let mockReviewer: any;
  let mockSafePatchExecutor: any;
  let mockGitManager: any;
  let mockReflectionEngine: any;
  let mockPlanValidator: any;
  let mockVerificationStrategyEngine: any;
  let mockTaskIntake: jest.Mocked<TaskIntake>;
  let orchestrator: DefaultWorkflowOrchestrator;
  let loggerSpy: jest.SpyInstance;

  const makeIntentResult = (overrides: Partial<IntentNormalizationResult> = {}): IntentNormalizationResult => ({
    intent: {
      id: 'intent-test',
      rawPrompt: 'Fix the bug in utils.ts',
      type: 'BUG_FIX',
      mode: 'MEDIUM',
      objective: 'Fix the bug',
      initialScope: ['utils.ts'],
      symptoms: [],
      knownErrors: [],
      constraints: [],
      successCriteria: [],
      information: [
        {
          id: 'info-0',
          content: 'There is a bug in utils.ts',
          status: 'UNKNOWN',
          source: 'user_prompt',
          requiresEvidence: true,
        },
      ],
      normalizedAt: new Date().toISOString(),
    },
    ambiguities: [],
    criticalMissingInfo: [],
    readinessScore: 82,
    ...overrides,
  });

  beforeEach(() => {
    mockSessionManager = {
      startSession: jest.fn().mockResolvedValue('sess-1'),
      completeSession: jest.fn().mockResolvedValue(undefined),
      failSession: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn().mockResolvedValue({
        id: 'sess-1', task: 'test', status: 'executing',
        events: [], createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), workspacePath: '/test',
      }),
      recordReflection: jest.fn().mockResolvedValue(undefined),
      recordDecision: jest.fn().mockResolvedValue(undefined),
      recordStepStarted: jest.fn().mockResolvedValue(undefined),
      recordStepCompleted: jest.fn().mockResolvedValue(undefined),
      recordStepFailed: jest.fn().mockResolvedValue(undefined),
      recordEvent: jest.fn().mockResolvedValue(undefined),
      pauseSession: jest.fn().mockResolvedValue(undefined),
      resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
    };

    mockWorkspaceMemory = { load: jest.fn().mockResolvedValue({ isEmpty: true }) };
    mockTaskPlanner = { plan: jest.fn().mockResolvedValue({ id: 'plan-1', steps: [], objective: '', complexity: 'simple', reasoning: '', affectedDomains: [], validationStrategy: { requiredTests: [], successCriteria: [] }, createdAt: '' }) };
    mockImpactAnalyzer = { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) };
    mockReviewer = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }) };
    mockSafePatchExecutor = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    mockGitManager = { isRepository: jest.fn().mockResolvedValue(true), commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }), status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }) };
    mockReflectionEngine = { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) };
    mockPlanValidator = { validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }), resolveDependencies: jest.fn().mockReturnValue([]) };
    mockVerificationStrategyEngine = { generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }) };

    mockTaskIntake = {
      normalize: jest.fn().mockResolvedValue(makeIntentResult()),
    } as any;

    orchestrator = new DefaultWorkflowOrchestrator(
      mockSessionManager,        // 1
      mockWorkspaceMemory,       // 2
      mockTaskPlanner,           // 3
      mockImpactAnalyzer,        // 4
      mockReviewer,              // 5
      mockSafePatchExecutor,     // 6
      mockGitManager,            // 7
      mockReflectionEngine,      // 8
      mockPlanValidator,         // 9
      mockVerificationStrategyEngine,  // 10
      undefined, undefined, undefined, undefined, undefined, undefined,  // 11-16
      undefined, undefined, undefined, undefined, undefined, undefined,  // 17-22
      undefined, undefined, undefined, undefined, undefined,  // 23-27
      undefined,  // 28: projectStructureService
      mockTaskIntake,  // 29: taskIntake (Stage 1)
    );

    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('Test 1: TaskIntake.normalize() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockTaskIntake.normalize).toHaveBeenCalledTimes(1);
    expect(mockTaskIntake.normalize).toHaveBeenCalledWith({
      rawPrompt: 'Fix the bug in utils.ts',
    });
  });

  it('Test 2: TaskIntent is observable via ExecutionLogger', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });

    const intakeLog = loggerSpy.mock.calls.find(
      (call: any[]) => call[0] === 'PRE_EXECUTION' && String(call[3]).includes('TaskIntake:')
    );
    expect(intakeLog).toBeDefined();
    expect(intakeLog[4]).toMatchObject({
      intentType: 'BUG_FIX',
      taskMode: 'MEDIUM',
      readinessScore: 82,
      informationCount: 1,
    });
  });

  it('Test 3: TaskIntent is persisted as session event', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });

    const intentEvents = mockSessionManager.recordEvent.mock.calls.filter(
      (call: any[]) => call[1] === 'INTENT_NORMALIZED'
    );
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0][2]).toContain('type=BUG_FIX');
    expect(intentEvents[0][2]).toContain('readiness=82');
  });

  it('Test 4: Existing TaskPlanner.plan() is still invoked', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  it('Test 5: UNKNOWN information does NOT block execution', async () => {
    mockTaskIntake.normalize.mockResolvedValueOnce(makeIntentResult({
      readinessScore: 30,  // Very low readiness
      ambiguities: ['No specific file mentioned', 'No success criteria'],
      criticalMissingInfo: ['Missing context'],
    }));

    // Execution should still proceed to TaskPlanner
    await orchestrator.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  it('Test 6: TaskIntake failure is logged and non-fatal', async () => {
    mockTaskIntake.normalize.mockRejectedValueOnce(new Error('TaskIntake crashed'));

    // Execution should NOT throw and should proceed to TaskPlanner
    await orchestrator.execute({ task: 'Fix the bug' });

    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('TaskIntake failed')
    );
    expect(errorLog).toBeDefined();
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  it('Test 7: WorkflowOrchestrator works without TaskIntake (backward compat)', async () => {
    const orchestratorNoIntake = new DefaultWorkflowOrchestrator(
      mockSessionManager,        // 1
      mockWorkspaceMemory,       // 2
      mockTaskPlanner,           // 3
      mockImpactAnalyzer,        // 4
      mockReviewer,              // 5
      mockSafePatchExecutor,     // 6
      mockGitManager,            // 7
      mockReflectionEngine,      // 8
      mockPlanValidator,         // 9
      mockVerificationStrategyEngine,  // 10
      // parameters 11-29: all use defaults/undefined
    );

    // Should still run without throwing
    await orchestratorNoIntake.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockTaskIntake.normalize).not.toHaveBeenCalled();
  });
});
