import { SearchFilesTool } from '../../../../src/core/tools/workspace/search-files-tool';
import { Workspace } from '../../../../src/contracts/workspace';

describe('SearchFilesTool', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let tool: SearchFilesTool;

  beforeEach(() => {
    mockWorkspace = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn(),
      isDirectory: jest.fn(),
      listFiles: jest.fn(),
      listEntries: jest.fn(),
      deleteFile: jest.fn(),
      mkdir: jest.fn()
    } as any;
    tool = new SearchFilesTool(mockWorkspace);
  });

  it('empty workspace', async () => {
    mockWorkspace.listFiles.mockResolvedValue([]);

    const res = await tool.execute({ pattern: 'anything' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('(no matches found)');
  });

  it('single match', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['package.json', 'README.md']);
    mockWorkspace.isDirectory.mockResolvedValue(false);

    const res = await tool.execute({ pattern: 'package' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('package.json');
  });

  it('multiple matches', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['package.json', 'package-lock.json', 'README.md']);
    mockWorkspace.isDirectory.mockResolvedValue(false);

    const res = await tool.execute({ pattern: 'package' });
    expect(res.isError).toBe(false);
    expect(res.content.split('\n')).toEqual(['package-lock.json', 'package.json']);
  });

  it('nested directories (recursive search)', async () => {
    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === '.') return ['package.json', 'src'];
      if (dir === 'src') return ['index.ts', 'utils'];
      if (dir === 'src/utils') return ['helper.ts'];
      return [];
    });
    mockWorkspace.isDirectory.mockImplementation(async (p: string) => {
      return p === 'src' || p === 'src/utils';
    });

    const res = await tool.execute({ pattern: '\\.ts$' });
    expect(res.isError).toBe(false);
    const matches = res.content.split('\n');
    expect(matches).toContain('src/index.ts');
    expect(matches).toContain('src/utils/helper.ts');
    expect(matches).toHaveLength(2);
  });

  it('deterministic ordering', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['zebra.txt', 'apple.txt', 'mango.txt']);
    mockWorkspace.isDirectory.mockResolvedValue(false);

    const res = await tool.execute({ pattern: '.*' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('apple.txt\nmango.txt\nzebra.txt');
  });

  it('ignores hidden directories', async () => {
    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === '.') return ['.git', 'src'];
      if (dir === 'src') return ['main.ts'];
      return [];
    });
    mockWorkspace.isDirectory.mockImplementation(async (p: string) => {
      return p === '.git' || p === 'src';
    });

    const res = await tool.execute({ pattern: 'main' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('src/main.ts');
    expect(res.content).not.toContain('.git');
  });

  it('continues when a subtree is inaccessible', async () => {
    mockWorkspace.listFiles.mockImplementation(async (dir: string) => {
      if (dir === '.') return ['accessible', 'forbidden'];
      if (dir === 'accessible') return ['file.txt'];
      if (dir === 'forbidden') throw new Error('EACCES');
      return [];
    });
    mockWorkspace.isDirectory.mockImplementation(async (p: string) => {
      return p === 'accessible' || p === 'forbidden';
    });

    const res = await tool.execute({ pattern: 'file' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('accessible/file.txt');
  });

  it('returns error for invalid regex', async () => {
    mockWorkspace.listFiles.mockResolvedValue([]);
    const res = await tool.execute({ pattern: '[' });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Invalid regex');
  });
});
