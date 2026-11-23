import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('FileAiContextLoader', () => {
  const loader = new FileAiContextLoader();
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports .ai as missing', async () => {
    const dir = makeTempDir('sparrow-ai-missing-');
    dirs.push(dir);

    const discovery = await loader.discover(dir);

    expect(discovery.exists).toBe(false);
    expect(discovery.rootPath).toBe(path.join(dir, '.ai'));
    expect(discovery.files).toHaveLength(5);
    expect(discovery.files.every(file => file.exists === false)).toBe(true);
    expect(await loader.loadRaw(dir, 'project')).toBeNull();
  });

  it('discovers an existing .ai directory and known files', async () => {
    const dir = makeTempDir('sparrow-ai-exists-');
    dirs.push(dir);
    const aiDir = path.join(dir, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'project'), 'name: demo');
    fs.writeFileSync(path.join(aiDir, 'frontend.md'), '# frontend notes');
    fs.mkdirSync(path.join(aiDir, 'maps'));

    const discovery = await loader.discover(dir);

    expect(discovery.exists).toBe(true);
    const byName = Object.fromEntries(discovery.files.map(file => [file.name, file]));
    expect(byName.project.exists).toBe(true);
    expect(byName.project.isDirectory).toBe(false);
    expect(byName.frontend.exists).toBe(true);
    expect(byName.backend.exists).toBe(false);
    expect(byName.dependencies.exists).toBe(false);
    expect(byName.maps.exists).toBe(true);
    expect(byName.maps.isDirectory).toBe(true);

    expect(await loader.loadRaw(dir, 'project')).toBe('name: demo');
    expect(await loader.loadRaw(dir, 'frontend')).toBe('# frontend notes');
    expect(await loader.loadRaw(dir, 'maps')).toBeNull();
    expect(await loader.loadRaw(dir, 'backend')).toBeNull();
  });

  it('discovers nested markdown context without flooding from audit json', async () => {
    const dir = makeTempDir('sparrow-ai-nested-');
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.ai', 'frontend'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.ai', 'project'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.ai', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ai', 'frontend', 'auth.md'), '# frontend auth');
    fs.writeFileSync(path.join(dir, '.ai', 'project', 'architecture.md'), '# architecture');
    for (let i = 0; i < 90; i += 1) {
      fs.writeFileSync(path.join(dir, '.ai', 'audit', `${i}.json`), '{}');
    }

    const discovery = await loader.discover(dir);
    const paths = (discovery.discoveredFiles ?? []).map(file => file.relativePath.replace(/\\/g, '/'));
    expect(paths.some(p => p.includes('frontend/auth.md'))).toBe(true);
    expect(paths.some(p => p.includes('architecture.md'))).toBe(true);
    expect(paths.some(p => p.includes('/audit/'))).toBe(false);
  });
});
