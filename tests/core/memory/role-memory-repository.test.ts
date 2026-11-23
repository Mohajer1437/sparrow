import { DefaultRoleMemoryRepository } from '../../../src/core/memory/default-role-memory-repository';
import { FileMemoryStorage } from '../../../src/core/memory/file-memory-storage';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('DefaultRoleMemoryRepository', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let storage: FileMemoryStorage;
  let repo: DefaultRoleMemoryRepository;

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
    repo = new DefaultRoleMemoryRepository(storage);
  });

  it('returns empty array when role memory does not exist', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.load('coder')).toEqual([]);
  });

  it('loads role memory entries', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      entries: [{ id: '1', roleId: 'coder', content: 'Use Repository pattern', category: 'pattern', createdAt: '2026-01-01' }],
    }));
    const entries = await repo.load('coder');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Use Repository pattern');
  });

  it('saves role memory with correct path', async () => {
    await repo.save('coder', [{ id: '1', roleId: 'coder', content: 'Test', category: 'general', createdAt: '2026-01-01' }]);
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('memory/roles/coder');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('memory/roles/coder/memory.json', expect.stringContaining('Test'));
  });

  it('checks role memory existence', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    expect(await repo.exists('coder')).toBe(true);
  });

  it('isolates role memories by path', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({ entries: [] }));
    await repo.load('planner');
    expect(mockRuntime.readFile).toHaveBeenCalledWith('memory/roles/planner/memory.json');
    await repo.load('coder');
    expect(mockRuntime.readFile).toHaveBeenCalledWith('memory/roles/coder/memory.json');
  });

  it('handles corrupted JSON gracefully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('invalid {{{');
    expect(await repo.load('coder')).toEqual([]);
  });

  it('returns immutable results', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      entries: [{ id: '1', roleId: 'coder', content: 'Test', category: 'general', createdAt: '2026-01-01' }],
    }));
    const entries = await repo.load('coder');
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
  });
});
