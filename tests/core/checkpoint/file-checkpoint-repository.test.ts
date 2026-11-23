import { FileCheckpointRepository } from '../../../src/core/checkpoint/file-checkpoint-repository';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
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

describe('FileCheckpointRepository', () => {
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

  it('saves checkpoint', async () => {
    const cp = createCheckpoint();
    await repo.save(cp);
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('checkpoints');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith(
      'checkpoints/cp-1.json',
      expect.stringContaining('exec-1')
    );
  });

  it('loads checkpoint', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify(createCheckpoint()));
    const cp = await repo.load('cp-1');
    expect(cp).not.toBeNull();
    expect(cp!.executionId).toBe('exec-1');
    expect(cp!.currentStepIndex).toBe(2);
  });

  it('returns null for missing checkpoint', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.load('missing')).toBeNull();
  });

  it('handles corrupted checkpoint gracefully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('invalid json {{{');
    expect(await repo.load('cp-1')).toBeNull();
  });

  it('loads latest active checkpoint for execution', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-1.json', 'cp-2.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-1', updatedAt: '2026-01-01T00:01:00.000Z' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-2', updatedAt: '2026-01-01T00:02:00.000Z' })));

    const latest = await repo.loadLatest('exec-1');
    expect(latest).not.toBeNull();
    expect(latest!.checkpointId).toBe('cp-2');
  });

  it('lists checkpoints for execution', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-1.json', 'cp-2.json', 'other.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-1' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-2' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'other', executionId: 'exec-2' })));

    const list = await repo.list('exec-1');
    expect(list).toHaveLength(2);
  });

  it('deletes checkpoint', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    const result = await repo.delete('cp-1');
    expect(result).toBe(true);
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('checkpoints/cp-1.json', '');
  });

  it('returns false when deleting missing checkpoint', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.delete('missing')).toBe(false);
  });

  it('lists all checkpoints', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['cp-1.json', 'cp-2.json']);
    mockRuntime.readFile
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-1' })))
      .mockResolvedValueOnce(JSON.stringify(createCheckpoint({ checkpointId: 'cp-2', executionId: 'exec-2' })));

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
  });

  it('lists checkpoints when listFiles returns prefixed paths (SM-11)', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.listFiles.mockResolvedValue(['checkpoints/cp-1.json', 'checkpoints/cp-2.json']);
    mockRuntime.readFile.mockImplementation(async (p: string) => {
      expect(p.startsWith('checkpoints/checkpoints/')).toBe(false);
      expect(p.startsWith('checkpoints/')).toBe(true);
      const id = p.includes('cp-2') ? 'cp-2' : 'cp-1';
      return JSON.stringify(createCheckpoint({ checkpointId: id, executionId: id === 'cp-2' ? 'exec-2' : 'exec-1' }));
    });

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    expect(mockRuntime.readFile).toHaveBeenCalledWith('checkpoints/cp-1.json');
    expect(mockRuntime.readFile).toHaveBeenCalledWith('checkpoints/cp-2.json');
  });
});
