import { DefaultRecoveryService } from '../../../src/core/recovery/default-recovery-service';
import { ResumeEngine } from '../../../src/core/checkpoint/resume-engine';
import { CheckpointRepository } from '../../../src/contracts/checkpoint-repository';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';

function createActiveCheckpoint(overrides: Partial<ExecutionCheckpoint> = {}): ExecutionCheckpoint {
  return Object.freeze({
    checkpointId: 'cp-1',
    executionId: 'exec-1',
    sessionId: 'sess-1',
    planId: 'plan-1',
    currentStepIndex: 2,
    totalSteps: 5,
    completedStepIds: Object.freeze(['step-1', 'step-2']),
    pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  });
}

describe('DefaultRecoveryService', () => {
  let mockCheckpointRepo: jest.Mocked<CheckpointRepository>;
  let resumeEngine: ResumeEngine;
  let recoveryService: DefaultRecoveryService;

  beforeEach(() => {
    mockCheckpointRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      loadLatest: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(false),
      list: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([]),
    };
    resumeEngine = new ResumeEngine(mockCheckpointRepo);
    recoveryService = new DefaultRecoveryService(mockCheckpointRepo, resumeEngine);
  });

  it('detects interrupted execution with active checkpoint', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(createActiveCheckpoint());

    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate).not.toBeNull();
    expect(candidate!.executionId).toBe('exec-1');
    expect(candidate!.resumeFromStepIndex).toBe(2);
    expect(candidate!.remainingSteps).toEqual(['step-3', 'step-4', 'step-5']);
  });

  it('ignores completed checkpoint', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(
      createActiveCheckpoint({ status: 'completed' as const })
    );

    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate).toBeNull();
  });

  it('ignores abandoned checkpoint', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(
      createActiveCheckpoint({ status: 'abandoned' as const })
    );

    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate).toBeNull();
  });

  it('handles missing checkpoint', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(null);

    const candidate = await recoveryService.findResumable('exec-missing');
    expect(candidate).toBeNull();
  });

  it('handles corrupted checkpoint (invalid fields)', async () => {
    const corrupted = Object.freeze({
      checkpointId: '',
      executionId: 'exec-1',
      sessionId: 'sess-1',
      planId: 'plan-1',
      currentStepIndex: -1,
      totalSteps: 5,
      completedStepIds: Object.freeze([]),
      pendingStepIds: Object.freeze([]),
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
    });
    mockCheckpointRepo.loadLatest.mockResolvedValue(corrupted);

    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate).toBeNull();
  });

  it('resumes from correct step', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(
      createActiveCheckpoint({ currentStepIndex: 3 })
    );

    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate!.resumeFromStepIndex).toBe(3);
  });

  it('prepares resume context with correct fields', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(createActiveCheckpoint());

    const candidate = await recoveryService.findResumable('exec-1');
    const context = recoveryService.prepareResumeContext(candidate!);

    expect(context.sessionId).toBe('sess-1');
    expect(context.executionId).toBe('exec-1');
    expect(context.checkpointId).toBe('cp-1');
    expect(context.currentStepIndex).toBe(2);
    expect(context.totalSteps).toBe(5);
    expect(context.resumedFromCheckpoint).toBe(true);
  });

  it('produces immutable resume context', async () => {
    mockCheckpointRepo.loadLatest.mockResolvedValue(createActiveCheckpoint());

    const candidate = await recoveryService.findResumable('exec-1');
    const context = recoveryService.prepareResumeContext(candidate!);

    expect(Object.isFrozen(context)).toBe(true);
  });

  it('validates checkpoint correctly', () => {
    expect(recoveryService.validateCheckpoint(createActiveCheckpoint())).toBe(true);
    expect(recoveryService.validateCheckpoint(createActiveCheckpoint({ status: 'completed' as const }))).toBe(false);
    expect(recoveryService.validateCheckpoint(createActiveCheckpoint({ currentStepIndex: -1 }))).toBe(false);
    expect(recoveryService.validateCheckpoint(createActiveCheckpoint({ checkpointId: '' }))).toBe(false);
  });
});
