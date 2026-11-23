import { LocalWorkspace } from '../../src/core/workspace/local-workspace';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('LocalWorkspace', () => {
  let tempDir: string;
  let workspace: LocalWorkspace;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-test-'));
    workspace = new LocalWorkspace(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should write and read a file', async () => {
    await workspace.writeFile('test.txt', 'hello');
    const content = await workspace.readFile('test.txt');
    expect(content).toBe('hello');
  });

  it('should prevent path traversal', async () => {
    await expect(workspace.readFile('../outside.txt')).rejects.toThrow('Path traversal detected');
  });

  it('resolves mixed separators and ./ against the workspace root', async () => {
    await workspace.writeFile('app/page.tsx', 'ok');
    const mixedRoot = new LocalWorkspace(tempDir.replace(/\\/g, '/'));
    expect(await mixedRoot.exists('app/page.tsx')).toBe(true);
    expect(await mixedRoot.exists('app\\page.tsx')).toBe(true);
    expect(await mixedRoot.readFile('./app/page.tsx')).toBe('ok');
    expect(mixedRoot.getRoot()).toBe(path.resolve(tempDir));
  });

  it('does not treat a missing file as a file in another workspace', async () => {
    expect(await workspace.exists('app/missing-file.tsx')).toBe(false);
  });

  it('should prevent access to protected directories', async () => {
    await fs.mkdir(path.join(tempDir, '.ai'));
    await expect(workspace.readFile('.ai/config.json')).rejects.toThrow('Access denied');
  });

  it('should list files recursively', async () => {
    await workspace.writeFile('a.txt', 'a');
    await workspace.writeFile('sub/b.txt', 'b');
    const files = await workspace.listFiles('.');
    expect(files.sort()).toEqual(['a.txt', path.join('sub', 'b.txt')].sort());
  });
  
  it('should throw on snapshot methods', async () => {
    await expect(workspace.createSnapshot()).rejects.toThrow('reserved for Milestone S6');
  });
});
