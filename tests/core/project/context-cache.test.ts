import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { DefaultProjectContextService } from '../../../src/core/project/default-project-context-service';
import { FilesystemProjectFingerprinter } from '../../../src/core/project/filesystem-project-fingerprinter';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { NodeProjectDetector } from '../../../src/core/project/node-project-detector';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeCachedProjectContext } from '../../../src/domain/project-context-cache';
import { unknownProjectProfile } from '../../../src/domain/project-profile';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('InMemoryContextCache', () => {
  it('reuses a stored snapshot', () => {
    const cache = new InMemoryContextCache();
    const root = path.resolve('/tmp/cache-proj');
    const entry = freezeCachedProjectContext({
      workspaceRoot: root,
      projectProfile: unknownProjectProfile(root),
      aiContext: freezeAiContextDiscovery({
        workspaceRoot: root,
        rootPath: path.join(root, '.ai'),
        exists: false,
        files: [],
      }),
      capabilities: [],
      fingerprint: 'fp-1',
      cachedAt: '2026-01-01T00:00:00.000Z',
    });

    cache.set(root, entry);
    const reused = cache.get(root);
    expect(reused).toBeDefined();
    expect(reused?.fingerprint).toBe('fp-1');
    expect(reused?.cachedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('invalidates a stored snapshot', () => {
    const cache = new InMemoryContextCache();
    const root = path.resolve('/tmp/cache-proj');
    cache.set(root, freezeCachedProjectContext({
      workspaceRoot: root,
      projectProfile: unknownProjectProfile(root),
      aiContext: freezeAiContextDiscovery({
        workspaceRoot: root,
        rootPath: path.join(root, '.ai'),
        exists: false,
        files: [],
      }),
      capabilities: [],
      fingerprint: 'fp-1',
      cachedAt: '2026-01-01T00:00:00.000Z',
    }));

    cache.invalidate(root);
    expect(cache.get(root)).toBeUndefined();
  });

  it('stores and reuses file content independently of the project snapshot', () => {
    const cache = new InMemoryContextCache();
    const root = path.resolve('/tmp/cache-proj');
    cache.setFile(root, 'app/page.tsx', {
      path: 'app/page.tsx',
      content: 'export const v = 1;',
      fingerprint: '1:18',
      sizeBytes: 18,
      metadata: { modifiedAt: '2026-01-01T00:00:00.000Z' },
    });
    cache.setFile(root, 'app/other.tsx', {
      path: 'app/other.tsx',
      content: 'export const other = 1;',
      fingerprint: '1:20',
      sizeBytes: 20,
      metadata: {},
    });

    expect(cache.getFile(root, 'app/page.tsx')?.content).toBe('export const v = 1;');
    cache.invalidateFile(root, 'app/other.tsx');
    expect(cache.getFile(root, 'app/other.tsx')).toBeUndefined();
    expect(cache.getFile(root, 'app/page.tsx')?.content).toBe('export const v = 1;');

    cache.invalidate(root);
    expect(cache.get(root)).toBeUndefined();
    expect(cache.getFile(root, 'app/page.tsx')?.content).toBe('export const v = 1;');

    cache.invalidateFiles(root);
    expect(cache.getFile(root, 'app/page.tsx')).toBeUndefined();
  });
});

describe('DefaultProjectContextService cache', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createService() {
    return new DefaultProjectContextService(
      new NodeProjectDetector(),
      new FileAiContextLoader(),
      new InMemoryContextCache(),
      new FilesystemProjectFingerprinter(),
    );
  }

  it('reuses a cached snapshot until a significant project change', async () => {
    const dir = makeTempDir('sparrow-cache-reuse-');
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '14.0.0' } }));

    const service = createService();
    const first = await service.load(dir);
    const second = await service.load(dir);

    expect(second.cachedAt).toBe(first.cachedAt);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.projectProfile.detectedFrameworks).toEqual(['nextjs']);
    expect(second.aiContext.exists).toBe(false);
  });

  it('invalidates on explicit refresh', async () => {
    const dir = makeTempDir('sparrow-cache-refresh-');
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '14.0.0' } }));

    const service = createService();
    const first = await service.load(dir);
    const refreshed = await service.refresh(dir);

    expect(refreshed.cachedAt >= first.cachedAt).toBe(true);
    expect(refreshed.projectProfile.detectedFrameworks).toEqual(['nextjs']);
  });

  it('invalidates when significant project files change', async () => {
    const dir = makeTempDir('sparrow-cache-change-');
    dirs.push(dir);
    const pkg = path.join(dir, 'package.json');
    fs.writeFileSync(pkg, JSON.stringify({ name: 'web', dependencies: { next: '14.0.0' } }));

    const service = createService();
    const first = await service.load(dir);

    const previous = fs.statSync(pkg);
    fs.writeFileSync(pkg, JSON.stringify({
      name: 'web',
      dependencies: { next: '14.0.0', '@nestjs/core': '10.0.0' },
    }));
    fs.utimesSync(pkg, previous.atime, new Date(previous.mtime.getTime() + 2000));
    fs.writeFileSync(path.join(dir, 'nest-cli.json'), '{}');

    const second = await service.load(dir);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.cachedAt).not.toBe(first.cachedAt);
    expect(second.projectProfile.projectType).toBe('fullstack');
  });
});
