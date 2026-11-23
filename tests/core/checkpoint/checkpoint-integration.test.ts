import { StepExecutionEngine } from '../../../src/core/execution/step-execution-engine';
import { ResumeEngine } from '../../../src/core/checkpoint/resume-engine';
import { CheckpointRepository } from '../../../src/contracts/checkpoint-repository';
import { DefaultReflectionEngine } from '../../../src/core/reflection/default-reflection-engine';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContext } from '../../../src/domain/execution-context';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';

function createPlan(stepCount: number): ExecutionPlan {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    description: `Step ${i + 1}`,
    type: 'modify' as const,
    requiredTools: [],
    expectedOutcome: `Done ${i + 1}`,
    dependencies: i > 0 ? [`step-${i}`] : [],
  }));
  return Object.freeze({
    id: 'plan-1', objective: 'Test', complexity: 'simple' as const,
    reasoning: 'Test', steps: Object.freeze(steps),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
    createdAt: new Date().toISOString(), status: 'CREATED' as const,
  });
}

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return Object.freeze({
    sessionId: 'sess-1',
    plan: null,
    currentStepIndex: 0,
    totalSteps: 0,
    startedAt: new Date().toISOString(),
    executionId: 'exec-1',
    ...overrides,
  });
}

function createMockSessionManager(): any {
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
  };
}

describe('Checkpoint Integration', () => {
  let mockSessionManager: any;
  let mockCheckpointRepo: jest.Mocked<CheckpointRepository>;
  let resumeEngine: ResumeEngine;
  let engine: StepExecutionEngine;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    mockCheckpointRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      loadLatest: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(false),
      list: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([]),
    };
    resumeEngine = new ResumeEngine(mockCheckpointRepo);
    engine = new StepExecutionEngine(
      mockSessionManager,
      new DefaultReflectionEngine(),
      undefined,
      undefined,
      undefined,
      resumeEngine,
    );
  });

  it('creates checkpoint after each successful step', async () => {
    const plan = createPlan(3);
    await engine.executeSteps('sess-1', plan, createContext());

    expect(mockCheckpointRepo.save).toHaveBeenCalledTimes(3);
    const savedCheckpoints = mockCheckpointRepo.save.mock.calls.map(c => c[0]) as ExecutionCheckpoint[];
    expect(savedCheckpoints[0].currentStepIndex).toBe(1);
    expect(savedCheckpoints[1].currentStepIndex).toBe(2);
    expect(savedCheckpoints[2].currentStepIndex).toBe(3);
  });

  it('stores correct completed and pending step ids', async () => {
    const plan = createPlan(3);
    await engine.executeSteps('sess-1', plan, createContext());

    const lastCheckpoint = mockCheckpointRepo.save.mock.calls[2][0] as ExecutionCheckpoint;
    expect(lastCheckpoint.completedStepIds).toEqual(['step-1', 'step-2', 'step-3']);
    expect(lastCheckpoint.pendingStepIds).toEqual([]);
    expect(lastCheckpoint.status).toBe('completed');
  });

  it('stores intermediate checkpoint with pending steps', async () => {
    const plan = createPlan(3);
    await engine.executeSteps('sess-1', plan, createContext());

    const firstCheckpoint = mockCheckpointRepo.save.mock.calls[0][0] as ExecutionCheckpoint;
    expect(firstCheckpoint.completedStepIds).toEqual(['step-1']);
    expect(firstCheckpoint.pendingStepIds).toEqual(['step-2', 'step-3']);
    expect(firstCheckpoint.status).toBe('active');
  });

  it('uses executionId from context', async () => {
    const plan = createPlan(1);
    await engine.executeSteps('sess-1', plan, createContext({ executionId: 'my-exec' }));

    const checkpoint = mockCheckpointRepo.save.mock.calls[0][0] as ExecutionCheckpoint;
    expect(checkpoint.executionId).toBe('my-exec');
  });

  it('falls back to sessionId when no executionId', async () => {
    const plan = createPlan(1);
    await engine.executeSteps('sess-1', plan, createContext({ executionId: undefined }));

    const checkpoint = mockCheckpointRepo.save.mock.calls[0][0] as ExecutionCheckpoint;
    expect(checkpoint.executionId).toBe('sess-1');
  });

  it('works without resumeEngine (backward compatible)', async () => {
    const engineWithoutResume = new StepExecutionEngine(
      mockSessionManager,
      new DefaultReflectionEngine(),
    );
    const plan = createPlan(2);
    const result = await engineWithoutResume.executeSteps('sess-1', plan, createContext());

    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(mockCheckpointRepo.save).not.toHaveBeenCalled();
  });

  it('resume engine detects active checkpoint', async () => {
    const activeCheckpoint: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 2, totalSteps: 5,
      completedStepIds: Object.freeze(['step-1', 'step-2']),
      pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
      status: 'active' as const,
      createdAt: '', updatedAt: '',
    });
    mockCheckpointRepo.loadLatest.mockResolvedValue(activeCheckpoint);

    const result = await resumeEngine.canResume('exec-1');
    expect(result.canResume).toBe(true);
    expect(result.resumeFromStepIndex).toBe(2);
    expect(result.remainingSteps).toEqual(['step-3', 'step-4', 'step-5']);
  });

  it('handles missing checkpoint safely', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(null);
    const result = await resumeEngine.canResume('exec-missing');
    expect(result.canResume).toBe(false);
    expect(result.reason).toBe('No checkpoint found');
  });

  it('handles corrupted checkpoint safely', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(null);
    const result = await resumeEngine.canResume('exec-corrupt');
    expect(result.canResume).toBe(false);
  });
});
