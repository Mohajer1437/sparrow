import { DefaultWorkflowOrchestrator } from '../../src/core/workflow/default-workflow-orchestrator';
import { DefaultPlanValidator } from '../../src/core/planning/default-plan-validator';
import { DefaultReflectionEngine } from '../../src/core/reflection/default-reflection-engine';
import { DefaultExecutionGovernor } from '../../src/core/health/default-execution-governor';
import { DefaultTelemetryCollector } from '../../src/core/observability/default-telemetry-collector';
import { StepExecutionEngine } from '../../src/core/execution/step-execution-engine';
import { createTestPlan, createMockSessionManager, createMockWorkspaceMemory, measureDuration } from '../utilities/test-helpers';

describe('Stress Validation', () => {
  let mockSessionManager: any;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
  });

  it('handles 50 sequential steps without error', async () => {
    const plan = createTestPlan(50, 'Large plan stress test');
    const engine = new StepExecutionEngine(mockSessionManager, new DefaultReflectionEngine());

    const { result, durationMs } = await measureDuration(() =>
      engine.executeSteps('sess-stress', plan, {
        sessionId: 'sess-stress', plan: null, currentStepIndex: 0,
        totalSteps: 50, startedAt: new Date().toISOString(),
      })
    );

    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(50);
    expect(result.totalSteps).toBe(50);
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalledTimes(50);
    expect(mockSessionManager.recordStepCompleted).toHaveBeenCalledTimes(50);
    expect(durationMs).toBeLessThan(10000);
  });

  it('handles repeated governor pause/resume cycles', async () => {
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

    const engine = new StepExecutionEngine(
      mockSessionManager, new DefaultReflectionEngine(), governor as any, healthProvider as any
    );
    const plan = createTestPlan(5);

    const result = await engine.executeSteps('sess-pause', plan, {
      sessionId: 'sess-pause', plan: null, currentStepIndex: 0,
      totalSteps: 5, startedAt: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(mockSessionManager.pauseSession).toHaveBeenCalledTimes(5);
    expect(mockSessionManager.resumeSession).toHaveBeenCalledTimes(5);
  });

  it('handles telemetry growth with 100 events', () => {
    const collector = new DefaultTelemetryCollector('exec-stress', 'sess-1');

    for (let i = 0; i < 100; i++) {
      collector.recordEvent({
        type: i % 2 === 0 ? 'STEP_STARTED' : 'STEP_COMPLETED',
        timestamp: new Date().toISOString(),
        durationMs: i % 2 === 1 ? 50 : undefined,
      });
    }

    const telemetry = collector.getTelemetry();
    expect(telemetry.timeline).toHaveLength(100);
    expect(telemetry.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('validates plan with circular dependencies is rejected', async () => {
    const validator = new DefaultPlanValidator();
    const plan = createTestPlan(3);
    const cyclicPlan = {
      ...plan,
      steps: Object.freeze([
        { ...plan.steps[0], dependencies: Object.freeze(['step-3']) },
        { ...plan.steps[1], dependencies: Object.freeze(['step-1']) },
        { ...plan.steps[2], dependencies: Object.freeze(['step-2']) },
      ]),
    };

    const result = await validator.validate(cyclicPlan, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
  });

  it('validates plan with invalid dependencies is rejected', async () => {
    const validator = new DefaultPlanValidator();
    const plan = createTestPlan(2);
    const invalidPlan = {
      ...plan,
      steps: Object.freeze([
        { ...plan.steps[0], dependencies: Object.freeze(['nonexistent-step']) },
        plan.steps[1],
      ]),
    };

    const result = await validator.validate(invalidPlan, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'IMPOSSIBLE_DEPENDENCY')).toBe(true);
  });

  it('measures execution duration within acceptable bounds', async () => {
    const engine = new StepExecutionEngine(mockSessionManager, new DefaultReflectionEngine());
    const plan = createTestPlan(10);

    const { durationMs } = await measureDuration(() =>
      engine.executeSteps('sess-perf', plan, {
        sessionId: 'sess-perf', plan: null, currentStepIndex: 0,
        totalSteps: 10, startedAt: new Date().toISOString(),
      })
    );

    expect(durationMs).toBeLessThan(5000);
  });

  it('handles workflow with all components integrated', async () => {
    const mockWorkspaceMemory: any = createMockWorkspaceMemory();
    const mockTaskPlanner: any = { plan: jest.fn().mockResolvedValue(createTestPlan(3)) };
    const mockImpactAnalyzer: any = { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) };
    const mockReviewer: any = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }) };
    const mockSafePatchExecutor: any = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
    const mockGitManager: any = { isRepository: jest.fn().mockResolvedValue(false), commit: jest.fn() };
    const mockVerificationStrategyEngine: any = { generate: jest.fn().mockResolvedValue({ type: 'build', commands: [] }) };

    const governor = new DefaultExecutionGovernor();
    const healthProvider: any = {
      collect: jest.fn().mockResolvedValue({
        cpuUtilization: { value: 30, unit: '%', timestamp: new Date().toISOString() },
        memoryUtilization: { value: 40, unit: '%', timestamp: new Date().toISOString() },
        cpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        gpuTemperature: { value: null, unit: '°C', timestamp: new Date().toISOString() },
        batteryLevel: { value: null, unit: '%', timestamp: new Date().toISOString() },
        collectedAt: new Date().toISOString(),
      }),
    };

    const orchestrator = new DefaultWorkflowOrchestrator(
      mockSessionManager, mockWorkspaceMemory, mockTaskPlanner,
      mockImpactAnalyzer, mockReviewer, mockSafePatchExecutor,
      mockGitManager, new DefaultReflectionEngine(), new DefaultPlanValidator(),
      mockVerificationStrategyEngine, undefined, governor, healthProvider,
    );

    const { result, durationMs } = await measureDuration(() =>
      orchestrator.execute({
        task: 'Full integration stress test',
        patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/a.ts', operation: 'modify', newContent: 'x' }] },
      })
    );

    expect(result.success).toBe(true);
    expect(result.plan).not.toBeNull();
    expect(result.reflection).not.toBeNull();
    expect(durationMs).toBeLessThan(10000);
  });
});
