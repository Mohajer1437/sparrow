import { DefaultWorkspaceMemoryRepository } from '../../../src/core/memory/default-workspace-memory-repository';
import { FileMemoryStorage } from '../../../src/core/memory/file-memory-storage';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('DefaultWorkspaceMemoryRepository', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let storage: FileMemoryStorage;
  let repo: DefaultWorkspaceMemoryRepository;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    storage = new FileMemoryStorage(mockRuntime);
    repo = new DefaultWorkspaceMemoryRepository(storage);
  });

  it('returns empty array when shared memory does not exist', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.load()).toEqual([]);
  });

  it('loads shared memory entries', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      entries: [{ id: '1', content: 'Use Clean Architecture', category: 'decision', createdAt: '2026-01-01' }],
    }));
    const entries = await repo.load();
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Use Clean Architecture');
  });

  it('saves shared memory with correct path', async () => {
    await repo.save([{ id: '1', content: 'Decision', category: 'decision', createdAt: '2026-01-01' }]);
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('memory/shared');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('memory/shared/memory.json', expect.stringContaining('Decision'));
  });

  it('checks shared memory existence', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    expect(await repo.exists()).toBe(true);
  });

  it('handles corrupted JSON gracefully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('not json');
    expect(await repo.load()).toEqual([]);
  });

  it('returns immutable results', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      entries: [{ id: '1', content: 'Test', category: 'general', createdAt: '2026-01-01' }],
    }));
    const entries = await repo.load();
    expect(Object.isFrozen(entries)).toBe(true);
  });
});
