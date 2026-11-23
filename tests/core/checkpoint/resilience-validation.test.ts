import { FileCheckpointRepository } from '../../../src/core/checkpoint/file-checkpoint-repository';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';

function createCheckpoint(overrides: Partial<ExecutionCheckpoint> = {}): ExecutionCheckpoint {
  return Object.freeze({
    checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
    currentStepIndex: 2, totalSteps: 5,
    completedStepIds: Object.freeze(['step-1', 'step-2']),
    pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  });
}

describe('Storage Resilience', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let repo: FileCheckpointRepository;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    repo = new FileCheckpointRepository(mockRuntime);
  });

  it('performs atomic checkpoint writes', async () => {
    const cp = createCheckpoint();
    await repo.save(cp);
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('checkpoints');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('checkpoints/cp-1.json', expect.any(String));
  });

  it('handles partial/corrupted JSON gracefully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('{"checkpointId": "cp-1", "executionId":');
    const result = await repo.load('cp-1');
    expect(result).toBeNull();
  });

  it('handles multiple checkpoints for same execution', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-1.json', 'cp-2.json', 'cp-3.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-1', currentStepIndex: 1, updatedAt: '2026-01-01T00:01:00.000Z' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-2', currentStepIndex: 2, updatedAt: '2026-01-01T00:02:00.000Z' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-3', currentStepIndex: 3, updatedAt: '2026-01-01T00:03:00.000Z' })));

    const latest = await repo.loadLatest('exec-1');
    expect(latest!.checkpointId).toBe('cp-3');
  });

  it('selects latest checkpoint correctly', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-old.json', 'cp-new.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-old', currentStepIndex: 1, updatedAt: '2026-01-01T00:01:00.000Z' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-new', currentStepIndex: 3, updatedAt: '2026-01-01T00:05:00.000Z' })));

    const latest = await repo.loadLatest('exec-1');
    expect(latest!.checkpointId).toBe('cp-new');
  });

  it('selects latest by stepIndex when timestamps are equal', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-a.json', 'cp-b.json']);
    const sameTime = '2026-01-01T00:01:00.000Z';
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-a', currentStepIndex: 1, updatedAt: sameTime })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-b', currentStepIndex: 4, updatedAt: sameTime })));

    const latest = await repo.loadLatest('exec-1');
    expect(latest!.checkpointId).toBe('cp-b');
    expect(latest!.currentStepIndex).toBe(4);
  });

  it('returns completed checkpoint from loadLatest', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-done.json']);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify(
      createCheckpoint({ checkpointId: 'cp-done', status: 'completed' as const, currentStepIndex: 5 })
    ));

    const latest = await repo.loadLatest('exec-1');
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('completed');
  });

  it('handles invalid filesystem state safely', async () => {
    mockRuntime.exists.mockRejectedValue(new Error('EACCES'));
    const result = await repo.load('cp-1');
    expect(result).toBeNull();
  });

  it('handles empty checkpoint directory', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue([]);
    const all = await repo.listAll();
    expect(all).toHaveLength(0);
  });

  it('skips corrupted files in listAll', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['good.json', 'bad.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint()))
      .mockResolvedValueOnce('corrupted {{{');

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
  });

  it('returns frozen checkpoint object', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify(createCheckpoint()));
    const cp = await repo.load('cp-1');
    expect(Object.isFrozen(cp)).toBe(true);
    expect(cp!.checkpointId).toBe('cp-1');
    expect(cp!.completedStepIds).toEqual(['step-1', 'step-2']);
  });
});
