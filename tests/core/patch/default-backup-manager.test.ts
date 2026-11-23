import { DefaultBackupManager } from '../../../src/core/patch/default-backup-manager';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { Workspace } from '../../../src/contracts/workspace';

describe('DefaultBackupManager', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let mockWorkspace: jest.Mocked<Workspace>;
  let manager: DefaultBackupManager;
  let runtimeFiles: Map<string, string>;
  let workspaceFiles: Map<string, string>;

  beforeEach(() => {
    runtimeFiles = new Map<string, string>();
    workspaceFiles = new Map<string, string>();

    mockRuntime = {
      readFile: jest.fn(async (p: string) => {
        const c = runtimeFiles.get(p);
        if (c === undefined) throw new Error('ENOENT');
        return c;
      }),
      writeFile: jest.fn(async (p: string, c: string) => {
        runtimeFiles.set(p, c);
      }),
      exists: jest.fn(async (p: string) => runtimeFiles.has(p)),
      listFiles: jest.fn(async (dir: string) => {
        const r: string[] = [];
        for (const k of runtimeFiles.keys()) {
          if (k.startsWith(dir + '/')) r.push(k);
        }
        return r;
      }),
      mkdir: jest.fn(async () => {}),
    } as any;

    mockWorkspace = {
      readFile: jest.fn(async (p: string) => {
        const c = workspaceFiles.get(p);
        if (c === undefined) throw new Error('ENOENT');
        return c;
      }),
      writeFile: jest.fn(async (p: string, c: string) => {
        workspaceFiles.set(p, c);
      }),
      exists: jest.fn(async (p: string) => workspaceFiles.has(p)),
      deleteFile: jest.fn(async (p: string) => {
        if (!workspaceFiles.has(p)) throw new Error('ENOENT');
        workspaceFiles.delete(p);
      }),
      listFiles: jest.fn(async () => []),
      listEntries: jest.fn(async () => []),
      createSnapshot: jest.fn(),
      rollback: jest.fn(),
      diff: jest.fn(),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
      isDirectory: jest.fn(),
    } as any;

    manager = new DefaultBackupManager(mockRuntime, mockWorkspace);
  });

  describe('createBackup', () => {
    it('backs up existing files', async () => {
      workspaceFiles.set('src/a.ts', 'original A');
      workspaceFiles.set('src/b.ts', 'original B');

      const metadata = await manager.createBackup('sess-1', ['src/a.ts', 'src/b.ts']);

      expect(metadata.sessionId).toBe('sess-1');
      expect(metadata.operations.length).toBe(2);
      expect(metadata.operations[0].existed).toBe(true);
      expect(metadata.operations[1].existed).toBe(true);

      // Verify backup files stored in runtime
      expect(runtimeFiles.get('backups/sess-1/files/src/a.ts')).toBe('original A');
      expect(runtimeFiles.get('backups/sess-1/files/src/b.ts')).toBe('original B');
      expect(runtimeFiles.has('backups/sess-1/metadata.json')).toBe(true);
    });

    it('records non-existent files as "was missing"', async () => {
      const metadata = await manager.createBackup('sess-1', ['src/new.ts']);

      expect(metadata.operations[0].existed).toBe(false);
      expect(metadata.operations[0].operation).toBe('create');
    });

    it('handles workspace read errors gracefully', async () => {
      mockWorkspace.readFile.mockRejectedValue(new Error('Permission denied'));
      workspaceFiles.set('src/a.ts', 'x');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const metadata = await manager.createBackup('sess-1', ['src/a.ts']);
      expect(metadata.operations[0].existed).toBe(false);
      warnSpy.mockRestore();
    });
  });

  describe('restoreBackup', () => {
    it('restores existing files to original content', async () => {
      workspaceFiles.set('src/a.ts', 'original A');
      await manager.createBackup('sess-1', ['src/a.ts']);

      // Simulate modification
      workspaceFiles.set('src/a.ts', 'modified A');

      const restored = await manager.restoreBackup('sess-1');
      expect(restored).toBe(true);
      expect(workspaceFiles.get('src/a.ts')).toBe('original A');
    });

    it('deletes files that did not exist at backup time', async () => {
      await manager.createBackup('sess-1', ['src/new.ts']);

      // Simulate creation
      workspaceFiles.set('src/new.ts', 'newly created');

      const restored = await manager.restoreBackup('sess-1');
      expect(restored).toBe(true);
      expect(workspaceFiles.has('src/new.ts')).toBe(false);
    });

    it('returns false if no backup exists', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const restored = await manager.restoreBackup('nonexistent');
      expect(restored).toBe(false);
      warnSpy.mockRestore();
    });

    it('handles corrupted metadata gracefully', async () => {
      runtimeFiles.set('backups/bad/metadata.json', 'not json {{{');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const restored = await manager.restoreBackup('bad');
      expect(restored).toBe(false);
      warnSpy.mockRestore();
    });

    it('continues restoring even if one file fails', async () => {
      workspaceFiles.set('src/a.ts', 'A');
      workspaceFiles.set('src/b.ts', 'B');
      await manager.createBackup('sess-1', ['src/a.ts', 'src/b.ts']);

      // Modify both
      workspaceFiles.set('src/a.ts', 'modified A');
      workspaceFiles.set('src/b.ts', 'modified B');

      // Make one file fail to restore
      let callCount = 0;
      mockWorkspace.writeFile.mockImplementation(async (p, c) => {
        callCount++;
        if (p === 'src/a.ts') throw new Error('Write failed');
        workspaceFiles.set(p, c);
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const restored = await manager.restoreBackup('sess-1');
      expect(restored).toBe(true);
      // b.ts should still be restored
      expect(workspaceFiles.get('src/b.ts')).toBe('B');
      warnSpy.mockRestore();
    });
  });

  describe('hasBackup', () => {
    it('returns true if backup exists', async () => {
      workspaceFiles.set('src/a.ts', 'A');
      await manager.createBackup('sess-1', ['src/a.ts']);
      expect(await manager.hasBackup('sess-1')).toBe(true);
    });

    it('returns false if no backup', async () => {
      expect(await manager.hasBackup('nonexistent')).toBe(false);
    });
  });
});
