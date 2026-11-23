import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { TaskIntake } from '../../../src/contracts/task-intake';
import { PreflightAnalyzer } from '../../../src/contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../../src/contracts/evidence-builder';
import { ClarificationEngine } from '../../../src/contracts/clarification-engine';
import { DecisionAdvisor } from '../../../src/contracts/decision-advisor';
import { ContractBuilder } from '../../../src/contracts/contract-builder';
import { IntentNormalizationResult } from '../../../src/domain/pre-execution/intent';
import { RiskAssessment } from '../../../src/domain/pre-execution/risk';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContract } from '../../../src/domain/pre-execution/contract';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 5: ContractBuilder Integration', () => {
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
  let mockStepExecutionEngine: any;
  let mockTaskIntake: jest.Mocked<TaskIntake>;
  let mockPreflightAnalyzer: jest.Mocked<PreflightAnalyzer>;
  let mockEvidenceBuilder: jest.Mocked<EvidenceBuilder>;
  let mockClarificationEngine: jest.Mocked<ClarificationEngine>;
  let mockDecisionAdvisor: jest.Mocked<DecisionAdvisor>;
  let mockContractBuilder: jest.Mocked<ContractBuilder>;
  let mockExecutionGate: any;
  let mockSafeExperiment: any;
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

  const makeRiskAssessment = (level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): RiskAssessment => ({
    level,
    explanation: `Risk level: ${level}`,
    factors: ['Test factor'],
    reversible: level !== 'CRITICAL',
    estimatedFilesAffected: level === 'HIGH' ? 10 : 1,
    requiresConfirmation: level === 'HIGH' || level === 'CRITICAL',
    safeExperimentRecommended: level === 'HIGH' || level === 'CRITICAL',
  });

  const makePlan = (): ExecutionPlan => ({
    id: 'plan-test',
    objective: 'Fix the bug',
    complexity: 'simple' as const,
    reasoning: 'Test reasoning',
    steps: [
      {
        id: 'step-1',
        description: 'Fix the bug',
        type: 'modify' as const,
        requiredTools: ['write_file'],
        expectedOutcome: 'Bug fixed',
      },
    ],
    affectedDomains: ['code'],
    validationStrategy: {
      requiredTests: ['npm test'],
      successCriteria: ['All tests pass'],
    },
    createdAt: new Date().toISOString(),
  });

  const makeContract = (risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): ExecutionContract => ({
    id: 'contract-test',
    planId: 'plan-test',
    objective: 'Fix the bug',
    context: 'React project',
    knownFacts: ['File exists'],
    evidence: ['src/utils.ts exists'],
    hypotheses: [],
    constraints: ['Do not break tests'],
    allowedActions: ['modify file'],
    forbiddenActions: ['delete file'],
    filesInScope: ['src/utils.ts'],
    filesOutOfScope: ['src/other.ts'],
    preconditions: ['Tests pass'],
    steps: [
      {
        id: 'step-1',
        precondition: 'File exists',
        action: 'Fix the bug',
        expectedObservation: 'Bug fixed',
        successCriteria: ['Tests pass'],
        failureHandling: 'Rollback',
        filesInScope: ['src/utils.ts'],
        filesOutOfScope: ['src/other.ts'],
        riskLevel: risk,
      },
    ],
    risk,
    impact: 'Low impact',
    rollback: 'Git rollback',
    verification: 'Run tests',
    outputRequirements: ['Tests pass'],
    createdAt: new Date().toISOString(),
    version: '1.0',
    validated: true,
    validationErrors: [],
  });

  const makeClarificationResult = (hasBlocking: boolean) => {
    const question = {
      id: 'q-0',
      reason: 'Ambiguity detected',
      question: 'Which approach?',
      type: 'single_choice' as const,
      recommendation: 'option-a',
      options: [
        {
          id: 'option-a',
          label: 'Option A',
          description: 'First option',
          risk: 'LOW' as const,
          consequences: ['Fast'],
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
      updateSession: jest.fn().mockResolvedValue(undefined),
    };

    mockWorkspaceMemory = { load: jest.fn().mockResolvedValue({ isEmpty: true }) };
    mockTaskPlanner = { plan: jest.fn().mockResolvedValue(makePlan()) };
    mockImpactAnalyzer = { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) };
    mockReviewer = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }) };
    mockSafePatchExecutor = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    mockGitManager = { isRepository: jest.fn().mockResolvedValue(true), commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }), status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }) };
    mockReflectionEngine = { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) };
    mockPlanValidator = { validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }), resolveDependencies: jest.fn().mockReturnValue([]) };
    mockVerificationStrategyEngine = { generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }) };
    mockStepExecutionEngine = {
      executeSteps: jest.fn().mockResolvedValue({ completedSteps: 1, totalSteps: 1 }),
    };

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

    mockDecisionAdvisor = {
      assessRisk: jest.fn().mockResolvedValue(makeRiskAssessment('LOW')),
      analyzeOptions: jest.fn(),
      analyzeImpact: jest.fn(),
    } as any;

    mockContractBuilder = {
      build: jest.fn().mockResolvedValue({
        contract: makeContract('LOW'),
        validated: true,
        validationErrors: [],
        critiqueApproved: true,
        builtAt: new Date().toISOString(),
      }),
      validate: jest.fn().mockResolvedValue([]),
    } as any;

    mockExecutionGate = {
      evaluate: jest.fn().mockImplementation(async () => ({
        decision: 'PROCEED',
        checks: [],
        riskLevel: 'LOW',
        requiresConfirmation: false,
        blockedReasons: [],
        evaluatedAt: new Date().toISOString(),
      })),
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
      undefined, undefined, undefined,  // 17-19
      mockStepExecutionEngine,   // 20: stepExecutionEngine
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,  // 21-27
      undefined,  // 28: projectStructureService
      mockTaskIntake,            // 29: taskIntake
      mockPreflightAnalyzer,     // 30: preflightAnalyzer
      mockEvidenceBuilder,       // 31: evidenceBuilder
      mockClarificationEngine,   // 32: clarificationEngine
      mockDecisionAdvisor,       // 33: decisionAdvisor
      mockContractBuilder,       // 34: contractBuilder (Stage 5)
      mockExecutionGate,         // 35: executionGate (Stage 6)
      mockSafeExperiment,        // 36: safeExperiment (Stage 6)
    );

    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  // Test 1: ContractBuilder.build() invoked exactly once
  it('Test 1: ContractBuilder.build() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockContractBuilder.build).toHaveBeenCalledTimes(1);
  });

  // Test 2: Contract built from authoritative ExecutionPlan
  it('Test 2: Contract built from authoritative ExecutionPlan', async () => {
    const plan = makePlan();
    mockTaskPlanner.plan.mockResolvedValueOnce(plan);
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // ContractBuilder should receive the actual plan context
    expect(mockContractBuilder.build).toHaveBeenCalledWith(
      expect.any(Object),  // intent
      expect.any(Object),  // inspection
      expect.any(Object),  // riskAssessment
      expect.any(Array),   // evidence
      undefined,           // critiqueResult
      expect.any(Object),  // executionPlan
    );
  });

  // Test 3: Contract contains correct risk
  it('Test 3: Contract contains correct risk (HIGH)', async () => {
    const highRisk = makeRiskAssessment('HIGH');
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(highRisk);
    
    const highRiskContract = makeContract('HIGH');
    mockContractBuilder.build.mockResolvedValueOnce({
      contract: highRiskContract,
      validated: true,
      validationErrors: [],
      critiqueApproved: true,
      builtAt: new Date().toISOString(),
    });
    
    await orchestrator.execute({ task: 'Delete all user data' });
    
    expect(mockContractBuilder.build).toHaveBeenCalled();
    const contractEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CONTRACT_BUILT'
    );
    expect(contractEvent[3].riskLevel).toBe('HIGH');
  });

  // Test 4: Contract preserves scope
  it('Test 4: Contract preserves scope', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    expect(mockContractBuilder.build).toHaveBeenCalled();
    const contractEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CONTRACT_BUILT'
    );
    expect(contractEvent[3]).toHaveProperty('filesInScopeCount');
    expect(contractEvent[3]).toHaveProperty('constraintsCount');
  });

  // Test 5: Contract preserves evidence
  it('Test 5: Contract preserves evidence', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    expect(mockContractBuilder.build).toHaveBeenCalled();
    const contractEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CONTRACT_BUILT'
    );
    expect(contractEvent[3]).toHaveProperty('evidenceCount');
  });

  // Test 6: Contract is persisted as CONTRACT_BUILT event
  it('Test 6: Contract is persisted as CONTRACT_BUILT event', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const contractEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CONTRACT_BUILT'
    );
    expect(contractEvent).toBeDefined();
    expect(contractEvent[3]).toHaveProperty('contractId');
    expect(contractEvent[3]).toHaveProperty('planId');
    expect(contractEvent[3]).toHaveProperty('riskLevel');
  });

  // Test 7: ContractBuilder failure is explicit (no fake contract)
  it('Test 7: ContractBuilder failure does not create fake contract', async () => {
    mockContractBuilder.build.mockRejectedValueOnce(new Error('Contract build crashed'));
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // Should log failure
    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('ContractBuilder failed')
    );
    expect(errorLog).toBeDefined();
    
    // Should NOT create CONTRACT_BUILT event
    const contractEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'CONTRACT_BUILT'
    );
    expect(contractEvent).toBeUndefined();
  });

  // Test 8: Blocking clarification prevents ContractBuilder
  it('Test 8: Blocking clarification prevents ContractBuilder', async () => {
    mockClarificationEngine.generateQuestions.mockResolvedValueOnce(makeClarificationResult(true));
    
    await orchestrator.execute({ task: 'Add authentication' });
    
    // ContractBuilder should NOT be called
    expect(mockContractBuilder.build).not.toHaveBeenCalled();
    
    // StepExecutionEngine should NOT be called
    expect(mockStepExecutionEngine.executeSteps).not.toHaveBeenCalled();
  });

  // Test 9: TaskPlanner remains authoritative
  it('Test 9: TaskPlanner remains authoritative', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // TaskPlanner should be called
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    
    // ContractBuilder should be called after TaskPlanner
    expect(mockContractBuilder.build).toHaveBeenCalled();
    
    const plannerCallOrder = mockTaskPlanner.plan.mock.invocationCallOrder[0];
    const contractCallOrder = mockContractBuilder.build.mock.invocationCallOrder[0];
    expect(plannerCallOrder).toBeLessThan(contractCallOrder);
  });

  // Test 10: StepExecutionEngine still receives ExecutionPlan (NOT ExecutionContract)
  it('Test 10: StepExecutionEngine still receives ExecutionPlan (NOT ExecutionContract)', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // StepExecutionEngine should be called
    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalled();
    
    // Verify it receives ExecutionPlan (second argument)
    const callArgs = mockStepExecutionEngine.executeSteps.mock.calls[0];
    const planArg = callArgs[1];  // Second argument is the plan
    
    // Verify it's an ExecutionPlan (has id, objective, steps, etc.)
    expect(planArg).toHaveProperty('id');
    expect(planArg).toHaveProperty('objective');
    expect(planArg).toHaveProperty('steps');
    expect(planArg).toHaveProperty('complexity');
    
    // Verify it's NOT an ExecutionContract (would have contract-specific fields)
    expect(planArg).not.toHaveProperty('filesInScope');
    expect(planArg).not.toHaveProperty('forbiddenActions');
    expect(planArg).not.toHaveProperty('preconditions');
  });

  // Test 11: Backward compatibility without ContractBuilder
  it('Test 11: WorkflowOrchestrator works without ContractBuilder', async () => {
    const orchestratorNoContract = new DefaultWorkflowOrchestrator(
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
      undefined, undefined, undefined,
      mockStepExecutionEngine,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined,  // projectStructureService
      mockTaskIntake,
      mockPreflightAnalyzer,
      mockEvidenceBuilder,
      mockClarificationEngine,
      mockDecisionAdvisor,
      undefined,  // contractBuilder NOT provided
    );

    await orchestratorNoContract.execute({ task: 'Fix the bug' });
    
    // StepExecutionEngine should still be called
    expect(mockStepExecutionEngine.executeSteps).toHaveBeenCalled();
    
    // ContractBuilder should NOT be called
    expect(mockContractBuilder.build).not.toHaveBeenCalled();
  });

  // Test 12: Previous stages remain intact
  it('Test 12: Stage 1/2/3/4 integrations remain functional', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // Stage 1: TaskIntake
    expect(mockTaskIntake.normalize).toHaveBeenCalled();
    
    // Stage 2: Preflight + Evidence
    expect(mockPreflightAnalyzer.analyze).toHaveBeenCalled();
    expect(mockEvidenceBuilder.collect).toHaveBeenCalled();
    
    // Stage 3: Clarification
    expect(mockClarificationEngine.generateQuestions).toHaveBeenCalled();
    
    // Stage 4: DecisionAdvisor
    expect(mockDecisionAdvisor.assessRisk).toHaveBeenCalled();
    
    // Stage 5: ContractBuilder
    expect(mockContractBuilder.build).toHaveBeenCalled();
  });
});
