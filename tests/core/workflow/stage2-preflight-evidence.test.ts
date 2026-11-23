import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { TaskIntake } from '../../../src/contracts/task-intake';
import { PreflightAnalyzer } from '../../../src/contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../../src/contracts/evidence-builder';
import { IntentNormalizationResult } from '../../../src/domain/pre-execution/intent';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 2: PreflightAnalyzer + EvidenceBuilder Integration (Observation-Only)', () => {
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
      mockPreflightAnalyzer,     // 30: preflightAnalyzer (Stage 2)
      mockEvidenceBuilder,       // 31: evidenceBuilder (Stage 2)
    );

    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  // Test 1: PreflightAnalyzer invoked exactly once
  it('Test 1: PreflightAnalyzer.analyze() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockPreflightAnalyzer.analyze).toHaveBeenCalledTimes(1);
  });

  // Test 2: Preflight result is logged
  it('Test 2: Preflight result is logged with structured metadata', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    const preflightLog = loggerSpy.mock.calls.find(
      (call: any[]) => call[0] === 'PRE_EXECUTION' && String(call[3]).includes('PreflightAnalyzer:')
    );
    expect(preflightLog).toBeDefined();
    expect(preflightLog[4]).toMatchObject({
      framework: 'react',
      packageManager: 'npm',
      feasible: true,
    });
  });

  // Test 3: Preflight result is persisted in session
  it('Test 3: Preflight result is persisted as session event', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    const events = mockSessionManager.recordEvent.mock.calls.filter(
      (call: any[]) => call[1] === 'PREFLIGHT_COMPLETED'
    );
    expect(events).toHaveLength(1);
    expect(events[0][2]).toContain('framework=react');
  });

  // Test 4: EvidenceBuilder invoked exactly once
  it('Test 4: EvidenceBuilder.collect() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockEvidenceBuilder.collect).toHaveBeenCalledTimes(1);
    expect(mockEvidenceBuilder.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceTypes: ['FILE_EXISTS', 'FILE_CONTENT'],
        targets: ['src/utils.ts'],
      })
    );
  });

  // Test 5: Evidence result is logged
  it('Test 5: Evidence result is logged with structured metadata', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    const evidenceLog = loggerSpy.mock.calls.find(
      (call: any[]) => call[0] === 'PRE_EXECUTION' && String(call[3]).includes('EvidenceBuilder:')
    );
    expect(evidenceLog).toBeDefined();
    expect(evidenceLog[4]).toMatchObject({
      evidenceCount: 1,
      confirmedCount: 1,
      notFoundCount: 0,
    });
  });

  // Test 6: Evidence result is persisted in session
  it('Test 6: Evidence result is persisted as session event', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    const events = mockSessionManager.recordEvent.mock.calls.filter(
      (call: any[]) => call[1] === 'EVIDENCE_COLLECTED'
    );
    expect(events).toHaveLength(1);
    expect(events[0][2]).toContain('collected=1');
  });

  // Test 7: Missing evidence does NOT block execution
  it('Test 7: Missing evidence does NOT block execution', async () => {
    mockEvidenceBuilder.collect.mockResolvedValueOnce({
      evidence: [
        {
          id: 'evidence-1',
          type: 'FILE_EXISTS',
          description: 'File does not exist',
          status: 'NOT_FOUND',
          source: 'src/utils.ts',
          collectedAt: new Date().toISOString(),
        },
      ],
      hypothesesUpdated: [],
      stillMissing: ['src/utils.ts'],
    });

    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    // TaskPlanner should still execute
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  // Test 8: Preflight failure is non-fatal
  it('Test 8: PreflightAnalyzer failure is non-fatal', async () => {
    mockPreflightAnalyzer.analyze.mockRejectedValueOnce(new Error('Preflight crashed'));

    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });

    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('PreflightAnalyzer failed')
    );
    expect(errorLog).toBeDefined();
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  // Test 9: EvidenceBuilder failure is non-fatal
  it('Test 9: EvidenceBuilder failure is non-fatal', async () => {
    mockEvidenceBuilder.collect.mockRejectedValueOnce(new Error('Evidence crashed'));

    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });

    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('EvidenceBuilder failed')
    );
    expect(errorLog).toBeDefined();
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
  });

  // Test 10: Workflow works without PreflightAnalyzer
  it('Test 10: WorkflowOrchestrator works without PreflightAnalyzer', async () => {
    const orchestratorNoPreflight = new DefaultWorkflowOrchestrator(
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
      undefined,  // preflightAnalyzer NOT provided
      mockEvidenceBuilder,
    );

    await orchestratorNoPreflight.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockPreflightAnalyzer.analyze).not.toHaveBeenCalled();
  });

  // Test 11: Workflow works without EvidenceBuilder
  it('Test 11: WorkflowOrchestrator works without EvidenceBuilder', async () => {
    const orchestratorNoEvidence = new DefaultWorkflowOrchestrator(
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
      undefined,  // evidenceBuilder NOT provided
    );

    await orchestratorNoEvidence.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockEvidenceBuilder.collect).not.toHaveBeenCalled();
  });

  // Test 12: TaskPlanner still receives the original raw task
  it('Test 12: TaskPlanner still receives the original raw task (not modified)', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // Verify TaskPlanner was called
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    
    // The planner should be called with the original task context
    // (not with TaskIntent as input - that would be a later stage)
    const planCall = mockTaskPlanner.plan.mock.calls[0];
    expect(planCall).toBeDefined();
    // The first argument should be the task planning request
    expect(planCall[0]).toHaveProperty('task');
    expect(planCall[0].task).toBe('Fix the bug in utils.ts');
  });
});
