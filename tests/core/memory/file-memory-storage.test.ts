import { FileMemoryStorage } from '../../../src/core/memory/file-memory-storage';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';

describe('FileMemoryStorage', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let storage: FileMemoryStorage;

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
  });

  it('reads file content when exists', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('{"test": true}');
    expect(await storage.read('test.json')).toBe('{"test": true}');
  });

  it('returns null for missing file', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await storage.read('missing.json')).toBeNull();
  });

  it('returns null on read error', async () => {
    mockRuntime.exists.mockRejectedValue(new Error('fail'));
    expect(await storage.read('error.json')).toBeNull();
  });

  it('writes file content', async () => {
    await storage.write('test.json', '{"data": 1}');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('test.json', '{"data": 1}');
  });

  it('checks file existence', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    expect(await storage.exists('test.json')).toBe(true);
  });

  it('creates directory', async () => {
    await storage.mkdir('test/dir');
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('test/dir');
  });
});
