import { StepExecutionEngine } from '../../../src/core/execution/step-execution-engine';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContext } from '../../../src/domain/execution-context';

function createMockSessionManager() {
  return {
    recordStepStarted: jest.fn().mockResolvedValue(undefined),
    recordStepCompleted: jest.fn().mockResolvedValue(undefined),
    recordStepFailed: jest.fn().mockResolvedValue(undefined),
    pauseSession: jest.fn().mockResolvedValue(undefined),
    resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
    getSession: jest.fn().mockResolvedValue({
      id: 'sess-1', task: 'test', status: 'executing', events: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      workspacePath: '/test', currentStep: 0, totalSteps: 0,
    }),
  } as any;
}

function createMockReflectionEngine() {
  return { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) } as any;
}

function createPlan(stepCount: number): ExecutionPlan {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    description: `Step ${i + 1}`,
    type: 'modify' as const,
    requiredTools: [],
    expectedOutcome: `Completed step ${i + 1}`,
    dependencies: i > 0 ? [`step-${i}`] : [],
  }));
  return Object.freeze({
    id: 'plan-1',
    objective: 'Test objective',
    complexity: 'simple' as const,
    reasoning: 'Test',
    steps: Object.freeze(steps),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
    createdAt: new Date().toISOString(),
    status: 'CREATED' as const,
  });
}

function createContext(): ExecutionContext {
  return Object.freeze({
    sessionId: 'sess-1',
    plan: null,
    currentStepIndex: 0,
    totalSteps: 0,
    startedAt: new Date().toISOString(),
  });
}

describe('StepExecutionEngine', () => {
  let mockSessionManager: any;
  let mockReflectionEngine: any;
  let engine: StepExecutionEngine;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    mockReflectionEngine = createMockReflectionEngine();
    engine = new StepExecutionEngine(mockSessionManager, mockReflectionEngine);
  });

  it('executes all steps in order', async () => {
    const plan = createPlan(3);
    const result = await engine.executeSteps('sess-1', plan, createContext());
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(3);
    expect(result.totalSteps).toBe(3);
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalledTimes(3);
    expect(mockSessionManager.recordStepCompleted).toHaveBeenCalledTimes(3);
  });

  it('records step events with correct ids', async () => {
    const plan = createPlan(2);
    await engine.executeSteps('sess-1', plan, createContext());
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalledWith('sess-1', 'step-1', 'Step 1');
    expect(mockSessionManager.recordStepStarted).toHaveBeenCalledWith('sess-1', 'step-2', 'Step 2');
  });

  it('calls governor before each step when provided', async () => {
    const mockGovernor = {
      evaluate: jest.fn().mockReturnValue({ action: 'continue', reason: 'ok' }),
      getPolicy: jest.fn().mockReturnValue({ pauseDurationMs: 100 }),
    };
    const mockHealthProvider = {
      collect: jest.fn().mockResolvedValue({ cpuUtilization: { value: 30 } }),
    };
    const engineWithGovernor = new StepExecutionEngine(
      mockSessionManager, mockReflectionEngine, mockGovernor as any, mockHealthProvider as any
    );
    const plan = createPlan(2);
    await engineWithGovernor.executeSteps('sess-1', plan, createContext());
    expect(mockGovernor.evaluate).toHaveBeenCalledTimes(2);
    expect(mockHealthProvider.collect).toHaveBeenCalledTimes(2);
  });

  it('pauses and resumes when governor requests pause', async () => {
    const mockGovernor = {
      evaluate: jest.fn().mockReturnValue({ action: 'pause', reason: 'CPU high' }),
      getPolicy: jest.fn().mockReturnValue({ pauseDurationMs: 10 }),
    };
    const mockHealthProvider = {
      collect: jest.fn().mockResolvedValue({ cpuUtilization: { value: 95 } }),
    };
    const engineWithGovernor = new StepExecutionEngine(
      mockSessionManager, mockReflectionEngine, mockGovernor as any, mockHealthProvider as any
    );
    const plan = createPlan(1);
    await engineWithGovernor.executeSteps('sess-1', plan, createContext());
    expect(mockSessionManager.pauseSession).toHaveBeenCalledWith('sess-1', 'CPU high');
    expect(mockSessionManager.resumeSession).toHaveBeenCalledWith('sess-1');
  });

  it('calls hooks in correct order', async () => {
    const callOrder: string[] = [];
    const hooks = {
      beforeStep: jest.fn().mockImplementation(async () => { callOrder.push('beforeStep'); }),
      afterStep: jest.fn().mockImplementation(async () => { callOrder.push('afterStep'); }),
    };
    const engineWithHooks = new StepExecutionEngine(
      mockSessionManager, mockReflectionEngine, undefined, undefined, hooks
    );
    const plan = createPlan(1);
    await engineWithHooks.executeSteps('sess-1', plan, createContext());
    expect(callOrder).toEqual(['beforeStep', 'afterStep']);
  });

  it('handles empty plan', async () => {
    const plan = createPlan(0);
    const result = await engine.executeSteps('sess-1', plan, createContext());
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(0);
  });

  it('does NOT perform per-step reflection (workflow-level only)', async () => {
    const plan = createPlan(2);
    await engine.executeSteps('sess-1', plan, createContext());
    // Per-step reflection removed due to false positives
    expect(mockReflectionEngine.generate).toHaveBeenCalledTimes(0);
  });

  it('returns immutable result', async () => {
    const plan = createPlan(1);
    const result = await engine.executeSteps('sess-1', plan, createContext());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.results)).toBe(true);
  });

  it('does not skip a repair step when the original task already looks complete', async () => {
    mockSessionManager.setExpectedFiles = jest.fn();
    mockSessionManager.clearExpectedFiles = jest.fn();
    const mockTaskExecutor = {
      execute: jest.fn()
        .mockResolvedValueOnce({ content: 'STEP_ALREADY_COMPLETE: footer already has Sandbox VnV repair marker' })
        .mockResolvedValueOnce({ content: 'Edited app/CrashBeacon.tsx to remove the throw' }),
    };
    const engineWithAgent = new StepExecutionEngine(
      mockSessionManager,
      mockReflectionEngine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTaskExecutor as any,
      [{ name: 'write_file' }] as any,
    );
    const base = createPlan(1);
    const repairPlan = Object.freeze({
      ...base,
      steps: Object.freeze([
        Object.freeze({
          ...base.steps[0],
          expectedFiles: Object.freeze(['app/page.tsx', 'app/CrashBeacon.tsx']),
        }),
      ]),
    });
    const result = await engineWithAgent.executeSteps('sess-1', repairPlan, {
      ...createContext(),
      metadata: { repair: 'true' },
    });
    expect(result.success).toBe(true);
    expect(mockTaskExecutor.execute).toHaveBeenCalledTimes(2);
    const completed = mockSessionManager.recordStepCompleted.mock.calls.map((call: any[]) => call[2]).join('\n');
    expect(completed).not.toMatch(/STEP_ALREADY_COMPLETE/);
  });

  it('still honors already-complete when verification is not in repair mode', async () => {
    mockSessionManager.setExpectedFiles = jest.fn();
    mockSessionManager.clearExpectedFiles = jest.fn();
    const mockTaskExecutor = {
      execute: jest.fn().mockResolvedValue({
        content: 'STEP_ALREADY_COMPLETE: footer already has Sandbox VnV repair marker',
      }),
    };
    const engineWithAgent = new StepExecutionEngine(
      mockSessionManager,
      mockReflectionEngine,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTaskExecutor as any,
      [{ name: 'write_file' }] as any,
    );
    await engineWithAgent.executeSteps('sess-1', createPlan(1), createContext());
    expect(mockTaskExecutor.execute).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.recordStepCompleted).toHaveBeenCalledWith(
      'sess-1',
      'step-1',
      expect.stringContaining('STEP_ALREADY_COMPLETE'),
    );
  });
});

describe('StepExecutionEngine — Project Structure Forwarding', () => {
  it('ExecutionContext accepts optional projectStructure', () => {
    const ctx: import('../../../src/domain/execution-context').ExecutionContext = {
      sessionId: 'test',
      plan: {} as any,
      currentStepIndex: 0,
      totalSteps: 1,
      startedAt: new Date().toISOString(),
    };
    expect(ctx.projectStructure).toBeUndefined();

    const ctxWithStructure: import('../../../src/domain/execution-context').ExecutionContext = {
      sessionId: 'test',
      plan: {} as any,
      currentStepIndex: 0,
      totalSteps: 1,
      startedAt: new Date().toISOString(),
      projectStructure: '# Project Structure\napp/\ncomponents/',
    };
    expect(ctxWithStructure.projectStructure).toContain('app/');
  });
});
