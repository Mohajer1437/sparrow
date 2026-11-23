import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { TaskIntake } from '../../../src/contracts/task-intake';
import { PreflightAnalyzer } from '../../../src/contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../../src/contracts/evidence-builder';
import { ClarificationEngine } from '../../../src/contracts/clarification-engine';
import { DecisionAdvisor } from '../../../src/contracts/decision-advisor';
import { IntentNormalizationResult } from '../../../src/domain/pre-execution/intent';
import { RiskAssessment } from '../../../src/domain/pre-execution/risk';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';

describe('Stage 4: DecisionAdvisor / Risk Integration', () => {
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
  let mockDecisionAdvisor: jest.Mocked<DecisionAdvisor>;
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

    mockDecisionAdvisor = {
      assessRisk: jest.fn().mockResolvedValue(makeRiskAssessment('LOW')),
      analyzeOptions: jest.fn(),
      analyzeImpact: jest.fn(),
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
      mockClarificationEngine,   // 32: clarificationEngine
      mockDecisionAdvisor,       // 33: decisionAdvisor (Stage 4)
    );

    loggerSpy = jest.spyOn(ExecutionLogger, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  // Test 1: DecisionAdvisor.assessRisk() is invoked exactly once
  it('Test 1: DecisionAdvisor.assessRisk() is invoked exactly once', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    expect(mockDecisionAdvisor.assessRisk).toHaveBeenCalledTimes(1);
    expect(mockDecisionAdvisor.assessRisk).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
    );
  });

  // Test 2: Real RiskAssessment is persisted as RISK_ASSESSED event
  it('Test 2: Real RiskAssessment is persisted as RISK_ASSESSED event', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const riskEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'RISK_ASSESSED'
    );
    expect(riskEvent).toBeDefined();
    expect(riskEvent[3]).toHaveProperty('level');
    expect(riskEvent[3]).toHaveProperty('requiresConfirmation');
  });

  // Test 3: RiskAssessment is observable through ExecutionLogger
  it('Test 3: RiskAssessment is observable through ExecutionLogger', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    const riskLog = loggerSpy.mock.calls.find(
      (call: any[]) => call[0] === 'PRE_EXECUTION' && String(call[3]).includes('DecisionAdvisor: level=')
    );
    expect(riskLog).toBeDefined();
    expect(riskLog[4]).toHaveProperty('level');
    expect(riskLog[4]).toHaveProperty('requiresConfirmation');
  });

  // Test 4: ClarificationEngine receives real RiskAssessment (not minimal LOW)
  it('Test 4: ClarificationEngine receives real RiskAssessment', async () => {
    const highRisk = makeRiskAssessment('HIGH');
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(highRisk);
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // ClarificationEngine should receive the HIGH risk, not minimal LOW
    expect(mockClarificationEngine.generateQuestions).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ level: 'HIGH' }),
      expect.anything(),
    );
  });

  // Test 5: HIGH risk is detected correctly
  it('Test 5: HIGH risk is detected correctly', async () => {
    const highRisk = makeRiskAssessment('HIGH');
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(highRisk);
    
    await orchestrator.execute({ task: 'Delete all user data' });
    
    expect(mockDecisionAdvisor.assessRisk).toHaveBeenCalled();
    const riskEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'RISK_ASSESSED'
    );
    expect(riskEvent[3].level).toBe('HIGH');
  });

  // Test 6: CRITICAL risk is preserved correctly
  it('Test 6: CRITICAL risk is preserved correctly', async () => {
    const criticalRisk = makeRiskAssessment('CRITICAL');
    mockDecisionAdvisor.assessRisk.mockResolvedValueOnce(criticalRisk);
    
    await orchestrator.execute({ task: 'Drop production database' });
    
    const riskEvent = mockSessionManager.recordEvent.mock.calls.find(
      (call: any[]) => call[1] === 'RISK_ASSESSED'
    );
    expect(riskEvent[3].level).toBe('CRITICAL');
  });

  // Test 7: DecisionAdvisor failure does not silently become LOW risk
  it('Test 7: DecisionAdvisor failure does not silently become LOW risk', async () => {
    mockDecisionAdvisor.assessRisk.mockRejectedValueOnce(new Error('Risk assessment crashed'));
    
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    // Should log failure
    const errorLog = loggerSpy.mock.calls.find(
      (call: any[]) => String(call[3]).includes('DecisionAdvisor failed')
    );
    expect(errorLog).toBeDefined();
    
    // ClarificationEngine should receive MEDIUM (conservative), not LOW
    expect(mockClarificationEngine.generateQuestions).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ level: 'MEDIUM' }),
      expect.anything(),
    );
  });

  // Test 8: Existing TaskPlanner behavior remains unchanged
  it('Test 8: TaskPlanner still receives original raw task', async () => {
    await orchestrator.execute({ task: 'Fix the bug in utils.ts' });
    
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    const planCall = mockTaskPlanner.plan.mock.calls[0];
    expect(planCall[0]).toHaveProperty('task');
    expect(planCall[0].task).toBe('Fix the bug in utils.ts');
  });

  // Test 9: Blocking clarification still prevents TaskPlanner
  it('Test 9: Blocking clarification still prevents TaskPlanner', async () => {
    mockClarificationEngine.generateQuestions.mockResolvedValueOnce(makeClarificationResult(true));
    
    const result = await orchestrator.execute({ task: 'Add authentication' });
    
    expect(mockTaskPlanner.plan).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.abortReason).toContain('Requires clarification');
  });

  // Test 10: Workflow remains backward compatible without DecisionAdvisor
  it('Test 10: WorkflowOrchestrator works without DecisionAdvisor', async () => {
    const orchestratorNoDecision = new DefaultWorkflowOrchestrator(
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
      mockClarificationEngine,
      undefined,  // decisionAdvisor NOT provided
    );

    await orchestratorNoDecision.execute({ task: 'Fix the bug' });
    expect(mockTaskPlanner.plan).toHaveBeenCalled();
    expect(mockDecisionAdvisor.assessRisk).not.toHaveBeenCalled();
  });

  // Test 11: Stage 1/2/3 integrations remain functional
  it('Test 11: Stage 1/2/3 integrations remain functional', async () => {
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
  });
});
