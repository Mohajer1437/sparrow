import { DefaultSessionStore } from '../../../src/core/session/default-session-store';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { WorkspaceSession } from '../../../src/domain/workspace-session';

describe('DefaultSessionStore', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let store: DefaultSessionStore;
  let files: Map<string, string>;

  const makeSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession =>
    Object.freeze({
      id: 'session-1',
      workspacePath: '/workspace/test',
      task: 'Test task',
      plan: null,
      status: 'created',
      currentStep: 0,
      totalSteps: 0,
      events: Object.freeze([]),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      modifiedFiles: Object.freeze([]),
      ...overrides,
    });

  beforeEach(() => {
    files = new Map<string, string>();

    mockRuntime = {
      readFile: jest.fn(async (path: string) => {
        const content = files.get(path);
        if (content === undefined) {
          throw new Error('ENOENT');
        }
        return content;
      }),
      writeFile: jest.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      // FIX: exists() must recognize directories, not just exact file matches.
      // If any stored file starts with `path + '/'`, then `path` is an existing directory.
      exists: jest.fn(async (path: string) => {
        if (files.has(path)) return true;
        for (const key of files.keys()) {
          if (key.startsWith(path + '/')) return true;
        }
        return false;
      }),
      listFiles: jest.fn(async (dir: string) => {
        const result: string[] = [];
        for (const key of files.keys()) {
          if (key.startsWith(dir + '/')) {
            result.push(key);
          }
        }
        return result;
      }),
      mkdir: jest.fn(async () => {}),
    } as any;

    store = new DefaultSessionStore(mockRuntime);
  });

  describe('create', () => {
    it('creates a new session', async () => {
      const session = makeSession();
      await store.create(session);
      expect(mockRuntime.writeFile).toHaveBeenCalledWith(
        'sessions/session-1.json',
        expect.any(String)
      );
    });

    it('throws if session already exists', async () => {
      const session = makeSession();
      await store.create(session);
      await expect(store.create(session)).rejects.toThrow('Session already exists');
    });
  });

  describe('get', () => {
    it('loads a valid session', async () => {
      const session = makeSession();
      await store.create(session);

      const loaded = await store.get('session-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('session-1');
      expect(loaded!.task).toBe('Test task');
    });

    it('returns null for missing session', async () => {
      const loaded = await store.get('nonexistent');
      expect(loaded).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      files.set('sessions/bad.json', 'not json {{{');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const loaded = await store.get('bad');
      expect(loaded).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null for malformed session (missing required fields)', async () => {
      files.set('sessions/partial.json', JSON.stringify({ id: 'x' }));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const loaded = await store.get('partial');
      expect(loaded).toBeNull();
      warnSpy.mockRestore();
    });

    it('returns null for tombstoned (soft-deleted) session', async () => {
      files.set('sessions/deleted.json', JSON.stringify({ _deleted: true }));

      const loaded = await store.get('deleted');
      expect(loaded).toBeNull();
    });
  });

  describe('update', () => {
    it('updates existing session', async () => {
      const session = makeSession();
      await store.create(session);

      const updated = await store.update('session-1', { status: 'executing', currentStep: 1 });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('executing');
      expect(updated!.currentStep).toBe(1);
    });

    it('appends events (append-only)', async () => {
      const session = makeSession();
      await store.create(session);

      const event1 = {
        id: 'ev-1',
        type: 'SESSION_CREATED' as const,
        message: 'Created',
        timestamp: new Date().toISOString(),
      };
      await store.update('session-1', { events: [event1] });

      const event2 = {
        id: 'ev-2',
        type: 'STEP_STARTED' as const,
        message: 'Started',
        timestamp: new Date().toISOString(),
      };
      await store.update('session-1', { events: [event2] });

      const finalSession = await store.get('session-1');
      expect(finalSession).not.toBeNull();
      expect(finalSession!.events.length).toBe(2);
      expect(finalSession!.events[0].id).toBe('ev-1');
      expect(finalSession!.events[1].id).toBe('ev-2');
    });

    it('returns null for missing session', async () => {
      const result = await store.update('nonexistent', { status: 'failed' });
      expect(result).toBeNull();
    });

    it('prevents id mutation', async () => {
      const session = makeSession();
      await store.create(session);

      const updated = await store.update('session-1', { id: 'hijacked' } as any);
      expect(updated).not.toBeNull();
      expect(updated!.id).toBe('session-1');
    });
  });

  describe('delete', () => {
    it('deletes existing session (soft delete)', async () => {
      const session = makeSession();
      await store.create(session);

      const result = await store.delete('session-1');
      expect(result).toBe(true);

      const loaded = await store.get('session-1');
      expect(loaded).toBeNull();
    });

    it('returns false for missing session', async () => {
      const result = await store.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('lists sessions for workspace (newest first)', async () => {
      const s1 = makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' });
      const s2 = makeSession({ id: 's2', updatedAt: '2026-01-02T00:00:00.000Z' });
      await store.create(s1);
      await store.create(s2);

      const list = await store.list('/workspace/test');
      expect(list.length).toBe(2);
      expect(list[0].id).toBe('s2');
      expect(list[1].id).toBe('s1');
    });

    it('filters by workspace path', async () => {
      const s1 = makeSession({ id: 's1', workspacePath: '/workspace/a' });
      const s2 = makeSession({ id: 's2', workspacePath: '/workspace/b' });
      await store.create(s1);
      await store.create(s2);

      const list = await store.list('/workspace/a');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('s1');
    });

    it('returns empty array when no sessions exist', async () => {
      const list = await store.list('/workspace/test');
      expect(list).toEqual([]);
    });

    it('skips invalid/corrupted session files gracefully', async () => {
      const valid = makeSession({ id: 'valid' });
      await store.create(valid);
      files.set('sessions/corrupt.json', 'not json');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const list = await store.list('/workspace/test');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('valid');
      warnSpy.mockRestore();
    });
  });
});
