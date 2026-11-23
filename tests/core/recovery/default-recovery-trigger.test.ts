import { DefaultRecoveryTrigger } from '../../../src/core/recovery/default-recovery-trigger';
import { RecoveryService } from '../../../src/contracts/recovery-service';
import { CheckpointRepository } from '../../../src/contracts/checkpoint-repository';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';

function createCheckpoint(overrides: Partial<ExecutionCheckpoint> = {}): ExecutionCheckpoint {
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

describe('DefaultRecoveryTrigger', () => {
  let mockRecoveryService: jest.Mocked<RecoveryService>;
  let mockCheckpointRepo: jest.Mocked<CheckpointRepository>;
  let trigger: DefaultRecoveryTrigger;

  beforeEach(() => {
    mockRecoveryService = {
      findResumable: jest.fn().mockResolvedValue(null),
      prepareResumeContext: jest.fn().mockReturnValue({
        sessionId: 'sess-1', plan: null, currentStepIndex: 2, totalSteps: 5,
        startedAt: '', executionId: 'exec-1', checkpointId: 'cp-1', resumedFromCheckpoint: true,
      }),
      validateCheckpoint: jest.fn().mockReturnValue(true),
    };
    mockCheckpointRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      loadLatest: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(false),
      list: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([]),
    };
    trigger = new DefaultRecoveryTrigger(mockRecoveryService, mockCheckpointRepo);
  });

  it('lists only active checkpoints', async () => {
    mockCheckpointRepo.listAll.mockResolvedValue([
      createCheckpoint({ checkpointId: 'cp-1', executionId: 'exec-1', status: 'active' as const }),
      createCheckpoint({ checkpointId: 'cp-2', executionId: 'exec-2', status: 'completed' as const }),
      createCheckpoint({ checkpointId: 'cp-3', executionId: 'exec-3', status: 'abandoned' as const }),
    ]);

    const options = await trigger.listRecoverable();
    expect(options).toHaveLength(1);
    expect(options[0].executionId).toBe('exec-1');
  });

  it('shows correct recovery option details', async () => {
    mockCheckpointRepo.listAll.mockResolvedValue([createCheckpoint()]);

    const options = await trigger.listRecoverable();
    expect(options[0].sessionId).toBe('sess-1');
    expect(options[0].lastCompletedStep).toBe('step-2');
    expect(options[0].remainingStepsCount).toBe(3);
    expect(options[0].checkpointTimestamp).toBe('2026-01-01T00:01:00.000Z');
  });

  it('returns empty list when no checkpoints exist', async () => {
    mockCheckpointRepo.listAll.mockResolvedValue([]);
    const options = await trigger.listRecoverable();
    expect(options).toHaveLength(0);
  });

  it('resumes execution successfully', async () => {
    mockRecoveryService.findResumable.mockResolvedValue({
      executionId: 'exec-1',
      checkpoint: createCheckpoint(),
      resumeFromStepIndex: 2,
      remainingSteps: Object.freeze(['step-3', 'step-4', 'step-5']),
    });

    const result = await trigger.resume('exec-1');
    expect(result.success).toBe(true);
    expect(result.message).toContain('exec-1');
    expect(result.message).toContain('step 2');
  });

  it('returns error for invalid execution', async () => {
    mockRecoveryService.findResumable.mockResolvedValue(null);

    const result = await trigger.resume('invalid-exec');
    expect(result.success).toBe(false);
    expect(result.message).toContain('No resumable execution');
  });

  it('handles corrupted checkpoint gracefully', async () => {
    mockRecoveryService.findResumable.mockResolvedValue(null);

    const result = await trigger.resume('corrupted');
    expect(result.success).toBe(false);
  });

  it('produces immutable recovery options', async () => {
    mockCheckpointRepo.listAll.mockResolvedValue([createCheckpoint()]);
    const options = await trigger.listRecoverable();
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options[0])).toBe(true);
  });
});
