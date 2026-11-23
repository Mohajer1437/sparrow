import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 6: ExecutionGate + SafeExperiment Enforcement', () => {
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
  let mockTaskExecutor: any;
  let mockToolDefinitions: any;
  let mockStepExecutionEngine: any;
  let mockTaskIntake: any;
  let mockPreflightAnalyzer: any;
  let mockEvidenceBuilder: any;
  let mockClarificationEngine: any;
  let mockDecisionAdvisor: any;
  let mockContractBuilder: any;
  let mockExecutionGate: any;
  let mockSafeExperiment: any;
  let orchestrator: DefaultWorkflowOrchestrator;
  let loggerSpy: any;

  const makeStep = (): any => ({
    id: 'step-1',
    description: 'Fix the bug',
    type: 'modify',
    requiredTools: [],
    expectedOutcome: 'Bug fixed',
  });

  const makePlan = (steps?: any[]): any => ({
    id: 'plan-test',
    objective: 'Fix the bug',
    complexity: 'simple',
    reasoning: 'Test reasoning',
    steps: steps ?? [makeStep()],
    affectedDomains: [],
    validationStrategy: {
      requiredTests: [],
      successCriteria: [],
    },
    createdAt: new Date().toISOString(),
  });

  const makeContract = (overrides: any = {}): any => ({
    id: 'contract-test',
    planId: 'plan-test',
    objective: 'Fix the bug',
    context: 'Test context',
    knownFacts: ['File exists'],
    evidence: ['src/utils.ts exists'],
    hypotheses: [],
    constraints: ['Do not break tests'],
    allowedActions: ['modify file'],
    forbiddenActions: ['delete file'],
    filesInScope: ['src/utils.ts'],
    filesOutOfScope: [],
    preconditions: [],
    steps: [],
    risk: 'LOW',
    impact: 'Low impact',
    rollback: 'Git rollback',
    verification: 'Run tests',
    outputRequirements: [],
    createdAt: new Date().toISOString(),
    version: '1.0',
    validated: true,
    validationErrors: [],
    ...overrides,
  });

  const makeRisk = (level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): any => ({
    level,
    explanation: 'Risk level: ' + level,
    factors: ['Test factor'],
    reversible: level !== 'CRITICAL',
    estimatedFilesAffected: 1,
    requiresConfirmation: level === 'HIGH' || level === 'CRITICAL',
    safeExperimentRecommended: level === 'HIGH' || level === 'CRITICAL',
  });

  const makeGateEvaluation = (decision: string): any => ({
    decision,
    checks: [],
    riskLevel: 'LOW',
    requiresConfirmation: false,
    blockedReasons: decision === 'BLOCKED' ? ['blocked'] : [],
    evaluatedAt: new Date().toISOString(),
  });

  const makeIntentResult = (): any => ({
    intent: {
      id: 'intent-test',
      rawPrompt: 'Fix the bug in src/utils.ts',
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
    readinessScore: 90,
  });

  const makePreflightResult = (): any => ({
    inspection: {
      framework: 'react',
      runtime: 'node',
      packageManager: 'npm',
      hasTypeScript: true,
      hasTests: true,
      hasESLint: true,
      hasPrettier: true,
      structure: ['src'],
      dependencies: ['react'],
      scripts: new Map(),
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

  const makeEvidenceResult = (): any => ({
    evidence: [
      {
        id: 'evidence-1',
        type: 'FILE_EXISTS',
        description: 'File exists',
        status: 'CONFIRMED',
        source: 'src/utils.ts',
        collectedAt: new Date().toISOString(),
      },
    ],
    hypothesesUpdated: [],
    stillMissing: [],
  });

  const makeClarificationBlocking = (): any => {
    const q = {
      id: 'q-1',
      question: 'Which approach should be used?',
      required: true,
      status: 'PENDING',
    };

    return {
      questions: [q],
      requiredQuestions: [q],
      optionalQuestions: [],
      hasBlockingQuestions: true,
    };
  };

  const hasEvent = (type: string): boolean =>
    mockSessionManager.recordEvent.mock.calls.some((call: any[]) => call[1] === type);

  const createOrchestrator = (opts: any = {}): DefaultWorkflowOrchestrator => {
    const contractBuilder = 'contractBuilder' in opts ? opts.contractBuilder : mockContractBuilder;
    const executionGate = 'executionGate' in opts ? opts.executionGate : mockExecutionGate;
    const safeExperiment = 'safeExperiment' in opts ? opts.safeExperiment : mockSafeExperiment;

    return new DefaultWorkflowOrchestrator(
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
      undefined, undefined, undefined, undefined,
      mockTaskExecutor,
      mockToolDefinitions,
      undefined, undefined, undefined,
      mockStepExecutionEngine,
      undefined, undefined, undefined, undefined, undefined, undefined,
      '/test',
      undefined,
      mockTaskIntake,
      mockPreflightAnalyzer,
      mockEvidenceBuilder,
      mockClarificationEngine,
      mockDecisionAdvisor,
      contractBuilder,
      executionGate,
      safeExperiment,
    );
  };

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
        workspacePath: '/test',
        modifiedFiles: [],
      }),
      recordReflection: jest.fn().mockResolvedValue(undefined),
      recordDecision: jest.fn().mockResolvedValue(undefined),
      recordStepStarted: jest.fn().mockResolvedValue(undefined),
      recordStepCompleted: jest.fn().mockResolvedValue(undefined),
      recordStepFailed: jest.fn().mockResolvedValue(undefined),
      recordEvent: jest.fn().mockResolvedValue(undefined),
      pauseSession: jest.fn().mockResolvedValue(undefined),
      resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
      updateSession: jest.fn().mockResolvedValue(undefined),
    };

    mockWorkspaceMemory = { load: jest.fn().mockResolvedValue({ isEmpty: true }) };
    mockTaskPlanner = { plan: jest.fn().mockResolvedValue(makePlan()) };
    mockImpactAnalyzer = { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) };
    mockReviewer = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 1, warningCount: 0, checks: [] }) };
    mockSafePatchExecutor = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    mockGitManager = {
      isRepository: jest.fn().mockResolvedValue(false),
      commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
      status: jest.fn().mockResolvedValue({ hasChanges: false, changedFiles: [] }),
    };
    mockReflectionEngine = { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) };
    mockPlanValidator = {
      validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      resolveDependencies: jest.fn().mockReturnValue([]),
    };
    mockVerificationStrategyEngine = { generate: jest.fn().mockResolvedValue({ type: 'build', commands: [] }) };
    mockTaskExecutor = { execute: jest.fn().mockResolvedValue({ content: 'done', toolCalls: [] }) };
    mockToolDefinitions = [{ name: 'test-tool' }];
    mockStepExecutionEngine = { executeSteps: jest.fn().mockResolvedValue({ completedSteps: 1, totalSteps: 1 }) };

    mockTaskIntake = { normalize: jest.fn().mockResolvedValue(makeIntentResult()) };
    mockPreflightAnalyzer = { analyze: jest.fn().mockResolvedValue(makePreflightResult()) };
    mockEvidenceBuilder = {
      collect: jest.fn().mockResolvedValue(makeEvidenceResult()),
      verify: jest.fn().mockResolvedValue(true),
      hasSufficientEvidence: jest.fn().mockResolvedValue(true),
    };
    mockClarificationEngine = {
      generateQuestions: jest.fn().mockResolvedValue({
        questions: [],
        requiredQuestions: [],
        optionalQuestions: [],
        hasBlockingQuestions: false,
      }),
      processResponse: jest.fn(),
    };
    mockDecisionAdvisor = {
      assessRisk: jest.fn().mockResolvedValue(makeRisk('LOW')),
      analyzeOptions: jest.fn(),
      analyzeImpact: jest.fn(),
    };

    mockContractBuilder = {
      build: jest.fn().mockResolvedValue({
        contract: makeContract(),
        validated: true,
        validationErrors: [],
        critiqueApproved: true,
        builtAt: new Date().toISOString(),
      }),
      validate: jest.fn().mockResolvedValue([]),
    };

    mockExecutionGate = {
      evaluate: jest.fn().mockImplementation(async () => makeGateEvaluation('PROCEED')),
      isBlocked: jest.fn().mockImplementation((evaluation: any) => evaluation.decision === 'BLOCKED'),
    };

    mockSafeExperiment = {
      run: jest.fn().mockResolvedValue({
        experimentId: 'experiment-test',
        contractId: 'contract-test',
        result: {
          success: true,
          buildPassed: true,
          testsPassed: true,
          affectedFiles: [],
          errors: [],
          durationMs: 1,
          rolledBack: true,
        },
        impactSummary: 'ok',
        recommendation: 'APPLY',
        createdAt: new Date().toISOString(),
      }),
    };

    orchestrator = createOrchestrator();
    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('Test 1: LOW risk can proceed and StepExecutionEngine is called once', async () => {
    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(true);
    expect(mockExecutionGate.evaluate).toHaveBeenCalledTimes(1);
    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalledTimes(1);
    expect(hasEvent('EXECUTION_ALLOWED')).toBe(true);
  });

  it('Test 2: MEDIUM risk can proceed', async () => {
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(makeRisk('MEDIUM'));

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(true);
    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalledTimes(1);
  });

  it('Test 3: HIGH risk without confirmation is blocked when gate returns PROCEED_WITH_CONFIRMATION', async () => {
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(makeRisk('HIGH'));
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('PROCEED_WITH_CONFIRMATION'));

    const result = await orchestrator.execute({ task: 'Dangerous change' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 4: CRITICAL risk is blocked', async () => {
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(makeRisk('CRITICAL'));
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('BLOCKED'));

    const result = await orchestrator.execute({ task: 'Dangerous change' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 5: Unknown risk blocks execution', async () => {
    mockDecisionAdvisor.assessRisk.mockRejectedValueOnce(new Error('risk unknown'));

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 6: Missing contract blocks execution', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: null,
      validated: false,
      validationErrors: ['missing'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 7: Invalid contract blocks execution', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: makeContract({ validated: false }),
      validated: false,
      validationErrors: ['invalid'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 8: Contract/plan planId mismatch blocks execution', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: makeContract({ planId: 'other-plan' }),
      validated: true,
      validationErrors: [],
      critiqueApproved: true,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 9: Blocking clarification prevents gate from being called', async () => {
    mockClarificationEngine.generateQuestions.mockResolvedValueOnce(makeClarificationBlocking());

    const result = await orchestrator.execute({ task: 'Add authentication' });

    expect(result.success).toBe(false);
    expect(mockExecutionGate.evaluate).not.toHaveBeenCalled();
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
  });

  it('Test 10: Gate failure blocks execution', async () => {
    mockExecutionGate.evaluate.mockRejectedValueOnce(new Error('gate crashed'));

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 11: No ContractBuilder and no Gate preserves legacy execution', async () => {
    const legacyOrchestrator = createOrchestrator({
      contractBuilder: undefined,
      executionGate: undefined,
      safeExperiment: undefined,
    });

    const result = await legacyOrchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(true);
    expect(mockExecutionGate.evaluate).not.toHaveBeenCalled();
    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalledTimes(1);
  });

  it('Test 12: ContractBuilder active but missing Gate blocks execution', async () => {
    const noGateOrchestrator = createOrchestrator({
      executionGate: undefined,
      safeExperiment: undefined,
    });

    const result = await noGateOrchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 13: StepExecutionEngine receives ExecutionPlan, not ExecutionContract', async () => {
    await orchestrator.execute({ task: 'Fix the bug' });

    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalled();
    const planArg = mockStepExecutionEngine.executeSteps.mock.calls[0][1];

    expect(planArg).toHaveProperty('id');
    expect(planArg).toHaveProperty('steps');
    expect(planArg).toHaveProperty('complexity');

    expect(planArg).not.toHaveProperty('filesInScope');
    expect(planArg).not.toHaveProperty('forbiddenActions');
    expect(planArg).not.toHaveProperty('preconditions');
  });

  it('Test 14: Gate cannot mutate ExecutionPlan', async () => {
    const plan = makePlan();
    mockTaskPlanner.plan.mockResolvedValueOnce(plan);

    await orchestrator.execute({ task: 'Fix the bug' });

    const gateInput = mockExecutionGate.evaluate.mock.calls[0][0];
    expect(gateInput).not.toHaveProperty('plan');
    expect(plan.objective).toBe('Fix the bug');
  });

  it('Test 15: Gate cannot mutate ExecutionContract', async () => {
    const contract = makeContract();
    mockContractBuilder.build.mockResolvedValueOnce({
      contract,
      validated: true,
      validationErrors: [],
      critiqueApproved: true,
      builtAt: new Date().toISOString(),
    });

    mockExecutionGate.evaluate.mockImplementationOnce(async (input: any) => {
      try {
        input.contract.objective = 'mutated';
      } catch (e) {
        // ignored
      }
      return makeGateEvaluation('PROCEED');
    });

    await orchestrator.execute({ task: 'Fix the bug' });

    expect(contract.objective).toBe('Fix the bug');
  });

  it('Test 16: SafeExperiment APPLY allows execution', async () => {
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('REQUIRES_SAFE_EXPERIMENT'));
    mockSafeExperiment.run.mockResolvedValueOnce({
      experimentId: 'experiment-test',
      contractId: 'contract-test',
      result: {
        success: true,
        buildPassed: true,
        testsPassed: true,
        affectedFiles: [],
        errors: [],
        durationMs: 1,
        rolledBack: true,
      },
      impactSummary: 'ok',
      recommendation: 'APPLY',
      createdAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(mockSafeExperiment.run).toHaveBeenCalledTimes(1);
    expect(mockSafePatchExecutor.executeWithVerification).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('Test 17: SafeExperiment REVISE blocks execution', async () => {
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('REQUIRES_SAFE_EXPERIMENT'));
    mockSafeExperiment.run.mockResolvedValueOnce({
      experimentId: 'experiment-test',
      contractId: 'contract-test',
      result: {
        success: false,
        buildPassed: false,
        testsPassed: false,
        affectedFiles: [],
        errors: ['needs revision'],
        durationMs: 1,
        rolledBack: true,
      },
      impactSummary: 'revise',
      recommendation: 'REVISE',
      createdAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(result.success).toBe(false);
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 18: SafeExperiment ABORT blocks execution', async () => {
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('REQUIRES_SAFE_EXPERIMENT'));
    mockSafeExperiment.run.mockResolvedValueOnce({
      experimentId: 'experiment-test',
      contractId: 'contract-test',
      result: {
        success: false,
        buildPassed: false,
        testsPassed: false,
        affectedFiles: [],
        errors: ['abort'],
        durationMs: 1,
        rolledBack: true,
      },
      impactSummary: 'abort',
      recommendation: 'ABORT',
      createdAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(result.success).toBe(false);
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 19: SafeExperiment failure blocks execution', async () => {
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('REQUIRES_SAFE_EXPERIMENT'));
    mockSafeExperiment.run.mockRejectedValueOnce(new Error('experiment crashed'));

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(result.success).toBe(false);
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 20: Patch path cannot bypass gate', async () => {
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('BLOCKED'));

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(result.success).toBe(false);
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 21: TaskExecutor fallback cannot bypass gate', async () => {
    mockTaskPlanner.plan.mockResolvedValueOnce(makePlan([]));
    mockExecutionGate.evaluate.mockResolvedValueOnce(makeGateEvaluation('BLOCKED'));

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockTaskExecutor.execute).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 22: Unvalidated contract blocks StepExecutionEngine, TaskExecutor, and SafePatchExecutor', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: makeContract({ validated: false }),
      validated: false,
      validationErrors: ['Contract has no known facts'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(result.abortReason).toContain('ExecutionContract is not validated');
    expect(mockExecutionGate.evaluate).not.toHaveBeenCalled();
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(mockTaskExecutor.execute).not.toHaveBeenCalled();
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
  });

  it('Test 23: Unvalidated contract blocks SafePatchExecutor patch path', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: makeContract({ validated: false }),
      validated: false,
      validationErrors: ['Contract has no known facts'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({
      task: 'Fix the bug',
      patchRequest: {
        sessionId: 'sess-1',
        operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }],
      },
    });

    expect(result.success).toBe(false);
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 24: Unvalidated contract blocks TaskExecutor fallback path', async () => {
    mockTaskPlanner.plan.mockResolvedValueOnce(makePlan([]));
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: makeContract({ validated: false }),
      validated: false,
      validationErrors: ['Contract has no known facts'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(mockTaskExecutor.execute).not.toHaveBeenCalled();
    expect(hasEvent('EXECUTION_BLOCKED')).toBe(true);
  });

  it('Test 25: Missing contract still blocks every execution path', async () => {
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: null,
      validated: false,
      validationErrors: ['missing'],
      critiqueApproved: false,
      builtAt: new Date().toISOString(),
    });

    const result = await orchestrator.execute({ task: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(result.abortReason).toContain('ExecutionContract missing');
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
    expect(mockTaskExecutor.execute).not.toHaveBeenCalled();
    expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
  });
});
