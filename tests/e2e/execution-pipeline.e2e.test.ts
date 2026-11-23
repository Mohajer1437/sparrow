import { DefaultWorkflowOrchestrator } from '../../src/core/workflow/default-workflow-orchestrator';
import { DefaultPlanValidator } from '../../src/core/planning/default-plan-validator';
import { DefaultReflectionEngine } from '../../src/core/reflection/default-reflection-engine';
import { DefaultExecutionGovernor } from '../../src/core/health/default-execution-governor';
import { DefaultTelemetryCollector } from '../../src/core/observability/default-telemetry-collector';
import { DefaultDiagnosticsReporter } from '../../src/core/observability/default-diagnostics-reporter';
import { createTestPlan, createMockSessionManager, createMockWorkspaceMemory } from '../utilities/test-helpers';

describe('E2E: Execution Pipeline', () => {
  let mockSessionManager: any;
  let mockWorkspaceMemory: any;
  let mockTaskPlanner: any;
  let mockImpactAnalyzer: any;
  let mockReviewer: any;
  let mockSafePatchExecutor: any;
  let mockGitManager: any;
  let reflectionEngine: any;
  let planValidator: any;
  let mockVerificationStrategyEngine: any;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    mockWorkspaceMemory = createMockWorkspaceMemory();
    mockTaskPlanner = { plan: jest.fn().mockResolvedValue(createTestPlan(3)) };
    mockImpactAnalyzer = { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) };
    mockReviewer = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }) };
    mockSafePatchExecutor = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    mockGitManager = { isRepository: jest.fn().mockResolvedValue(false), commit: jest.fn(), status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: false }) };
    reflectionEngine = new DefaultReflectionEngine();
    planValidator = new DefaultPlanValidator();
    mockVerificationStrategyEngine = { generate: jest.fn().mockResolvedValue({ type: 'build', commands: [] }) };
  });

  function createOrchestrator(governor?: any, healthProvider?: any) {
    return new DefaultWorkflowOrchestrator(
      mockSessionManager, mockWorkspaceMemory, mockTaskPlanner,
      mockImpactAnalyzer, mockReviewer, mockSafePatchExecutor,
      mockGitManager, reflectionEngine, planValidator,
      mockVerificationStrategyEngine, undefined, governor, healthProvider,
    );
  }

  it('completes a full workflow: plan → validate → execute → reflect → complete', async () => {
    const orchestrator = createOrchestrator();
    const result = await orchestrator.execute({
      task: 'Implement feature X',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(result.success).toBe(true);
    expect(result.plan).not.toBeNull();
    expect(result.reflection).not.toBeNull();
    expect(mockSessionManager.startSession).toHaveBeenCalled();
    expect(mockSessionManager.completeSession).toHaveBeenCalled();
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalled();
    expect(mockSessionManager.recordStepCompleted).toHaveBeenCalled();
  });

  it('aborts when plan validation fails', async () => {
    mockTaskPlanner.plan.mockResolvedValue(createTestPlan(0));
    const orchestrator = createOrchestrator();
    const result = await orchestrator.execute({ task: 'Empty plan task' });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('plan-validation');
  });

  it('handles patch execution failure gracefully', async () => {
    mockSafePatchExecutor.executeWithVerification.mockResolvedValue({
      success: false, attempts: 3, finalError: 'Provider unavailable',
    });
    const orchestrator = createOrchestrator();
    const result = await orchestrator.execute({
      task: 'Task with provider failure',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe('patch-execution');
    expect(mockSessionManager.recordStepFailed).toHaveBeenCalled();
  });

  it('pauses and resumes when governor detects high load', async () => {
    const governor = new DefaultExecutionGovernor({ cpuThreshold: 50, pauseDurationMs: 1 });
    const healthProvider = {
      collect: jest.fn().mockResolvedValue({
        cpuUtilization: { value: 80, unit: '%', timestamp: new Date().toISOString() },
        memoryUtilization: { value: 40, unit: '%', timestamp: new Date().toISOString() },
        cpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        gpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        batteryLevel: { value: null, unit: '%', timestamp: new Date().toISOString() },
        collectedAt: new Date().toISOString(),
      }),
    };

    const orchestrator = createOrchestrator(governor, healthProvider);
    await orchestrator.execute({
      task: 'Task under high load',
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
    });

    expect(mockSessionManager.pauseSession).toHaveBeenCalled();
    expect(mockSessionManager.resumeSession).toHaveBeenCalled();
  });

  it('produces correct telemetry for successful execution', () => {
    const collector = new DefaultTelemetryCollector('exec-e2e', 'sess-1', 'plan-1');
    collector.recordEvent({ type: 'SESSION_STARTED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'PLAN_CREATED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'PLAN_VALIDATED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'STEP_STARTED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'STEP_COMPLETED', timestamp: new Date().toISOString(), durationMs: 150 });
    collector.recordEvent({ type: 'REFLECTION_COMPLETED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'WORKFLOW_COMPLETED', timestamp: new Date().toISOString() });

    const telemetry = collector.getTelemetry();
    expect(telemetry.timeline).toHaveLength(7);
    expect(telemetry.timeline[0].type).toBe('SESSION_STARTED');
    expect(telemetry.timeline[6].type).toBe('WORKFLOW_COMPLETED');
  });

  it('produces correct diagnostics for aborted execution', () => {
    const collector = new DefaultTelemetryCollector('exec-fail', 'sess-1');
    collector.recordEvent({ type: 'SESSION_STARTED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'WORKFLOW_FAILED', timestamp: new Date().toISOString(), metadata: { reason: 'Provider error' } });
    collector.recordStep({
      stepId: 'step-1', description: 'Failed step', startedAt: new Date().toISOString(),
      success: false, error: 'Provider unavailable', retries: 2,
    });

    const reporter = new DefaultDiagnosticsReporter();
    const diagnostics = reporter.generate(collector.getTelemetry());

    expect(diagnostics.outcome).toBe('aborted');
    expect(diagnostics.failures).toHaveLength(1);
    expect(diagnostics.failures[0]).toContain('step-1');
    expect(diagnostics.metrics.retryCount).toBe(2);
  });

  it('produces correct diagnostics for partially completed execution', () => {
    const collector = new DefaultTelemetryCollector('exec-partial', 'sess-1');
    collector.recordEvent({ type: 'SESSION_STARTED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'WORKFLOW_FAILED', timestamp: new Date().toISOString() });
    collector.recordStep({
      stepId: 'step-1', description: 'OK step', startedAt: new Date().toISOString(),
      success: true, retries: 0,
    });
    collector.recordStep({
      stepId: 'step-2', description: 'Bad step', startedAt: new Date().toISOString(),
      success: false, error: 'Timeout', retries: 1,
    });

    const reporter = new DefaultDiagnosticsReporter();
    const diagnostics = reporter.generate(collector.getTelemetry());

    expect(diagnostics.outcome).toBe('partially_completed');
    expect(diagnostics.metrics.successfulSteps).toBe(1);
    expect(diagnostics.metrics.failedSteps).toBe(1);
  });
});
