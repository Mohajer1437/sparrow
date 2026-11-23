import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { TaskIntake } from '../../../src/contracts/task-intake';
import { PreflightAnalyzer } from '../../../src/contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../../src/contracts/evidence-builder';
import { ClarificationEngine } from '../../../src/contracts/clarification-engine';
import { IntentNormalizationResult } from '../../../src/domain/pre-execution/intent';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 3: Clarification Integration (with Blocking)', () => {
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
  let mockPreflightAnalyzer: jest.Mocked<PreflightAnalyzer>;
  let mockEvidenceBuilder: jest.Mocked<EvidenceBuilder>;
  let mockClarificationEngine: jest.Mocked<ClarificationEngine>;
  let orchestrator: DefaultWorkflowOrchestrator;
  let loggerSpy: jest.SpyInstance;

  const makeIntentResult = (overrides: Partial<IntentNormalizationResult> = {}): IntentNormalizationResult => ({
    intent: {
      id: 'intent-test',
      rawPrompt: 'Fix the bug in utils.ts',
      type: 'BUG_FIX',
      mode: 'MEDIUM',
      objective: 'Fix the bug',
      initialScope: ['src/utils.ts'],
      symptoms: [],
      knownErrors: [],
      constraints: [],
      successCriteria: [],
      information: [],
      normalizedAt: new Date().toISOString(),
    },
    ambiguities: [],
    criticalMissingInfo: [],
    readinessScore: 85,
    ...overrides,
  });

  const makePreflightResult = () => ({
    inspection: {
      framework: 'react' as const,
      runtime: 'node' as const,
      packageManager: 'npm' as const,
      hasTypeScript: true,
      hasTests: true,
      hasESLint: true,
      hasPrettier: true,
      structure: ['src', 'tests'],
      dependencies: ['react', 'typescript'],
      scripts: new Map([['build', 'tsc'], ['test', 'jest']]),
      inspectedAt: new Date().toISOString(),
    },
    feasibility: {
      feasible: true,
      missingRequirements: [],
      blockers: [],
    },
    warnings: [],
    recommendations: [],
  });

  const makeEvidenceResult = () => ({
    evidence: [
      {
        id: 'evidence-1',
        type: 'FILE_EXISTS' as const,
        description: 'File exists',
        status: 'CONFIRMED' as const,
        source: 'src/utils.ts',
        collectedAt: new Date().toISOString(),
      },
    ],
    hypothesesUpdated: [],
    stillMissing: [],
  });

  const makeClarificationResult = (hasBlocking: boolean) => {
    const question = {
      id: 'q-0',
      reason: 'Ambiguity detected',
      question: 'Which authentication method should be used?',
      type: 'single_choice' as const,
      recommendation: 'jwt',
      options: [
        {
          id: 'jwt',
          label: 'JWT',
          description: 'Use JWT tokens',
          risk: 'LOW' as const,
          consequences: ['Stateless authentication'],
          affects: ['PLAN_CHANGING'],
        },
      ],
      required: true,
      affects: ['PLAN_CHANGING' as const],
      status: 'PENDING' as const,
    };
    
    return {
      questions: hasBlocking ? [question] : [],
      requiredQuestions: hasBlocking ? [question] : [],
      optionalQuestions: [],
      hasBlockingQuestions: hasBlocking,
    };
  };

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

    mockPreflightAnalyzer = {
      analyze: jest.fn().mockResolvedValue(makePreflightResult()),
    } as any;

    mockEvidenceBuilder = {
      collect: jest.fn().mockResolvedValue(makeEvidenceResult()),
      verify: jest.fn().mockResolvedValue(true),
      hasSufficientEvidence: jest.fn().mockResolvedValue(true),
    } as any;

    mockClarificationEngine = {
      generateQuestions: jest.fn().mockResolvedValue(makeClarificationResult(false)),
      processResponse: jest.fn(),
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
      mockTaskIntake,            // 29: taskIntake
      mockPreflightAnalyzer,     // 30: preflightAnalyzer
      mockEvidenceBuilder,       // 31: evidenceBuilder
      mockClarificationEngine,   // 32: clarificationEngine (Stage 3)
    );

    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  // Test 1: ClarificationEngine invoked exactly once
  it('Test 1: ClarificationEngine.generateQuestions() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockClarificationEngine.generateQuestions).toHaveBeenCalledTimes(1);
  });

  // Test 2: Non-blocking ambiguity does not stop planning
  it('Test 2: Non-blocking ambiguity does NOT stop planning', async () => {
    mockClarificationEngine.generateQuestions.mockResolvedValueOnce(makeClarificationResult(false));
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // TaskPlanner should still execute
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  // Test 3: Blocking question prevents TaskPlanner execution
  it('Test 3: Blocking question prevents TaskPlanner execution', async () => {
    mockClarificationEngine.generateQuestions.mockResolvedValueOnce(makeClarificationResult(true));
    
    const result = await orchestrator.execute({ task: 'Add authentication' });
    
    // TaskPlanner should NOT execute
    expect(mockTaskPlanner.plan).not.toHaveBeenCalled();
    
    // Workflow should fail with clarification reason
    expect(result.success).toBe(false);
    expect(result.abortReason).toContain('Requires clarification');
  });

  // Test 4: Clarification questions are logged
  it('Test 4: Clarification questions are logged with structured metadata', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const clarificationLog = loggerSpy.mock.calls.find(
      (call: any[]) => call[0] === 'PRE_EXECUTION' && String(call[3]).includes('ClarificationEngine: total=')
    );
    expect(clarificationLog).toBeDefined();
    expect(clarificationLog[4]).toHaveProperty('totalQuestions');
    expect(clarificationLog[4]).toHaveProperty('blockingQuestions');
  });

  // Test 5: Clarification questions are persisted as session events
  it('Test 5: Clarification questions are persisted as session events', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const startedEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CLARIFICATION_STARTED'
    );
    expect(startedEvent).toBeDefined();
    
    const completedEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CLARIFICATION_COMPLETED' || call[1] === 'CLARIFICATION_REQUIRED'
    );
    expect(completedEvent).toBeDefined();
  });

  // Test 6: Clarification failure is non-fatal
  it('Test 6: ClarificationEngine failure is non-fatal', async () => {
    mockClarificationEngine.generateQuestions.mockRejectedValueOnce(new Error('Clarification crashed'));
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('ClarificationEngine failed')
    );
    expect(errorLog).toBeDefined();
    
    // TaskPlanner should still execute (failure is non-fatal)
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  // Test 7: Workflow works without ClarificationEngine
  it('Test 7: WorkflowOrchestrator works without ClarificationEngine', async () => {
    const orchestratorNoClarification = new DefaultWorkflowOrchestrator(
      mockSessionManager,
      mockWorkspaceMemory,
      mockTaskPlanner,
      mockImpactAnalyzer,
      mockReviewer,
      mockSafePatchExecutor,
      mockGitManager,
      mockReflectionEngine,
      mockPlanValidator,
      mockVerificationStrategyEngine,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined,  // projectStructureService
      mockTaskIntake,
      mockPreflightAnalyzer,
      mockEvidenceBuilder,
      undefined,  // clarificationEngine NOT provided
    );

    await orchestratorNoClarification.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockClarificationEngine.generateQuestions).not.toHaveBeenCalled();
  });
});
