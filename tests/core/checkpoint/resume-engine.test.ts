import { ResumeEngine } from '../../../src/core/checkpoint/resume-engine';
import { CheckpointRepository } from '../../../src/contracts/checkpoint-repository';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';
import { ExecutionPlan } from '../../../src/domain/execution-plan';

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

describe('ResumeEngine', () => {
  let mockRepo: jest.Mocked<CheckpointRepository>;
  let engine: ResumeEngine;

  beforeEach(() => {
    mockRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      loadLatest: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(false),
      list: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([]),
    };
    engine = new ResumeEngine(mockRepo);
  });

  it('reports cannot resume when no checkpoint exists', async () => {
    const result = await engine.canResume('exec-1');
    expect(result.canResume).toBe(false);
    expect(result.reason).toBe('No checkpoint found');
  });

  it('reports cannot resume when execution completed', async () => {
    const cp: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 5, totalSteps: 5,
      completedStepIds: Object.freeze(['step-1', 'step-2', 'step-3', 'step-4', 'step-5']),
      pendingStepIds: Object.freeze([]),
      status: 'completed' as const,
      createdAt: '', updatedAt: '',
    });
    mockRepo.loadLatest.mockResolvedValue(cp);

    const result = await engine.canResume('exec-1');
    expect(result.canResume).toBe(false);
    expect(result.reason).toBe('Execution already completed');
  });

  it('reports cannot resume when checkpoint abandoned', async () => {
    const cp: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 2, totalSteps: 5,
      completedStepIds: Object.freeze(['step-1', 'step-2']),
      pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
      status: 'abandoned' as const,
      createdAt: '', updatedAt: '',
    });
    mockRepo.loadLatest.mockResolvedValue(cp);

    const result = await engine.canResume('exec-1');
    expect(result.canResume).toBe(false);
    expect(result.reason).toBe('Checkpoint was abandoned');
  });

  it('resumes from correct step', async () => {
    const cp: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 2, totalSteps: 5,
      completedStepIds: Object.freeze(['step-1', 'step-2']),
      pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
      status: 'active' as const,
      createdAt: '', updatedAt: '',
    });
    mockRepo.loadLatest.mockResolvedValue(cp);

    const result = await engine.canResume('exec-1');
    expect(result.canResume).toBe(true);
    expect(result.resumeFromStepIndex).toBe(2);
    expect(result.remainingSteps).toEqual(['step-3', 'step-4', 'step-5']);
  });

  it('creates checkpoint with correct state', () => {
    const plan = createPlan(5);
    const cp = engine.createCheckpoint('exec-1', 'sess-1', plan, 2, ['step-1', 'step-2']);

    expect(cp.executionId).toBe('exec-1');
    expect(cp.sessionId).toBe('sess-1');
    expect(cp.planId).toBe('plan-1');
    expect(cp.currentStepIndex).toBe(2);
    expect(cp.totalSteps).toBe(5);
    expect(cp.completedStepIds).toEqual(['step-1', 'step-2']);
    expect(cp.pendingStepIds).toEqual(['step-3', 'step-4', 'step-5']);
    expect(cp.status).toBe('active');
  });

  it('saves checkpoint to repository', async () => {
    const plan = createPlan(3);
    const cp = engine.createCheckpoint('exec-1', 'sess-1', plan, 1, ['step-1']);
    await engine.saveCheckpoint(cp);
    expect(mockRepo.save).toHaveBeenCalledWith(cp);
  });

  it('marks checkpoint as completed', async () => {
    const cp: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 5, totalSteps: 5,
      completedStepIds: Object.freeze([]), pendingStepIds: Object.freeze([]),
      status: 'active' as const, createdAt: '', updatedAt: '',
    });
    mockRepo.loadLatest.mockResolvedValue(cp);

    await engine.markCompleted('exec-1');
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('marks checkpoint as abandoned', async () => {
    const cp: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 2, totalSteps: 5,
      completedStepIds: Object.freeze([]), pendingStepIds: Object.freeze([]),
      status: 'active' as const, createdAt: '', updatedAt: '',
    });
    mockRepo.loadLatest.mockResolvedValue(cp);

    await engine.markAbandoned('exec-1');
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'abandoned' })
    );
  });

  it('produces immutable checkpoint', () => {
    const plan = createPlan(3);
    const cp = engine.createCheckpoint('exec-1', 'sess-1', plan, 0, []);
    expect(Object.isFrozen(cp)).toBe(true);
    expect(Object.isFrozen(cp.completedStepIds)).toBe(true);
    expect(Object.isFrozen(cp.pendingStepIds)).toBe(true);
  });
});
