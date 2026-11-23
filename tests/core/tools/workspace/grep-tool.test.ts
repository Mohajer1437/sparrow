import { GrepTool } from '../../../../src/core/tools/workspace/grep-tool';
import { Workspace } from '../../../../src/contracts/workspace';

describe('GrepTool', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let tool: GrepTool;

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
    tool = new GrepTool(mockWorkspace);
  });

  const setupSingleFile = (filename: string, content: string) => {
    mockWorkspace.listFiles.mockResolvedValue([filename]);
    mockWorkspace.isDirectory.mockResolvedValue(false);
    mockWorkspace.readFile.mockResolvedValue(content);
  };

  it('single match', async () => {
    setupSingleFile('test.ts', 'const x = 1;\nexport function createTaskExecutor() {\n}');
    const res = await tool.execute({ pattern: 'createTaskExecutor' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('test.ts:2:export function createTaskExecutor() {');
  });

  it('multiple matches in one file', async () => {
    setupSingleFile('log.txt', 'error here\nerror there\nall good\nerror everywhere');
    const res = await tool.execute({ pattern: 'error' });
    expect(res.isError).toBe(false);
    const lines = res.content.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('log.txt:1:error here');
    expect(lines[1]).toBe('log.txt:2:error there');
    expect(lines[2]).toBe('log.txt:4:error everywhere');
  });

  it('multiple files', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['a.ts', 'b.ts']);
    mockWorkspace.isDirectory.mockResolvedValue(false);
    mockWorkspace.readFile.mockImplementation(async (f: string) => {
      if (f === 'a.ts') return 'hello world';
      if (f === 'b.ts') return 'hello universe';
      return '';
    });

    const res = await tool.execute({ pattern: 'hello' });
    expect(res.isError).toBe(false);
    const lines = res.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('a.ts:1:hello world');
    expect(lines[1]).toContain('b.ts:1:hello universe');
  });

  it('no matches', async () => {
    setupSingleFile('test.ts', 'no match here');
    const res = await tool.execute({ pattern: 'zzzzz' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('(no matches found');
  });

  it('binary file ignored', async () => {
    setupSingleFile('image.bin', 'binary\0content');
    const res = await tool.execute({ pattern: 'binary' });
    expect(res.isError).toBe(false);
    expect(res.content).toContain('(no matches found');
  });

  it('unreadable file ignored (continues searching)', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['unreadable.txt', 'readable.txt']);
    mockWorkspace.isDirectory.mockResolvedValue(false);
    mockWorkspace.readFile.mockImplementation(async (f: string) => {
      if (f === 'unreadable.txt') throw new Error('EACCES');
      return 'found here';
    });

    const res = await tool.execute({ pattern: 'found' });
    expect(res.isError).toBe(false);
    expect(res.content).toBe('readable.txt:1:found here');
  });

  it('deterministic ordering (alphabetical by file)', async () => {
    mockWorkspace.listFiles.mockResolvedValue(['zebra.ts', 'apple.ts', 'mango.ts']);
    mockWorkspace.isDirectory.mockResolvedValue(false);
    mockWorkspace.readFile.mockResolvedValue('match');

    const res = await tool.execute({ pattern: 'match' });
    expect(res.isError).toBe(false);
    const lines = res.content.split('\n');
    expect(lines[0]).toContain('apple.ts');
    expect(lines[1]).toContain('mango.ts');
    expect(lines[2]).toContain('zebra.ts');
  });

  it('returns error for invalid regex', async () => {
    mockWorkspace.listFiles.mockResolvedValue([]);
    const res = await tool.execute({ pattern: '(' });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Invalid regex');
  });

  it('returns error for invalid pattern type', async () => {
    const res = await tool.execute({ pattern: 123 });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Invalid input');
  });
});
