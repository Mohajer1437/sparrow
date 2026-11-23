import { FileSessionStoreImpl } from '../../../src/core/session/file-session-store';
import { ExecutionSession } from '../../../src/domain/session';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileSessionStore', () => {
  let store: FileSessionStoreImpl;
  let tempDir: string;

  const createTestSession = (overrides: Partial<ExecutionSession> = {}): ExecutionSession => ({
    id: 'test-session-1',
    workspace: '/test/workspace',
    task: 'Test task',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
    decisions: [],
    ...overrides,
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-test-'));
    store = new FileSessionStoreImpl(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('saves a new session', async () => {
      const session = createTestSession();
      const result = await store.save(session);
      expect(result).toBe(true);

      const loaded = await store.load(session.id);
      expect(loaded).toEqual(session);
    });

    it('returns false if session already exists', async () => {
      const session = createTestSession();
      await store.save(session);
      const result = await store.save(session);
      expect(result).toBe(false);
    });

    it('creates .ai/sessions directory', async () => {
      const session = createTestSession();
      await store.save(session);

      const sessionDir = path.join(tempDir, '.ai', 'sessions');
      const stats = await fs.stat(sessionDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('load', () => {
    it('loads an existing session', async () => {
      const session = createTestSession();
      await store.save(session);

      const loaded = await store.load(session.id);
      expect(loaded).toEqual(session);
    });

    it('returns null for non-existent session', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('returns null for corrupted JSON', async () => {
      const session = createTestSession();
      await store.save(session);

      const sessionPath = path.join(tempDir, '.ai', 'sessions', `${session.id}.json`);
      await fs.writeFile(sessionPath, 'invalid json', 'utf-8');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const loaded = await store.load(session.id);
      expect(loaded).toBeNull();
      warnSpy.mockRestore();
    });

    it('returns null for invalid schema', async () => {
      const session = createTestSession();
      await store.save(session);

      const sessionPath = path.join(tempDir, '.ai', 'sessions', `${session.id}.json`);
      await fs.writeFile(sessionPath, JSON.stringify({ invalid: 'schema' }), 'utf-8');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const loaded = await store.load(session.id);
      expect(loaded).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe('update', () => {
    it('updates an existing session', async () => {
      const session = createTestSession();
      await store.save(session);

      const updated = { ...session, status: 'completed' as const };
      const result = await store.update(updated);
      expect(result).toBe(true);

      const loaded = await store.load(session.id);
      expect(loaded?.status).toBe('completed');
    });

    it('returns false for non-existent session', async () => {
      const session = createTestSession();
      const result = await store.update(session);
      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an existing session', async () => {
      const session = createTestSession();
      await store.save(session);

      const result = await store.delete(session.id);
      expect(result).toBe(true);

      const loaded = await store.load(session.id);
      expect(loaded).toBeNull();
    });

    it('returns false for non-existent session', async () => {
      const result = await store.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('lists all sessions for a workspace', async () => {
      const session1 = createTestSession({ id: 's1', workspace: '/ws1' });
      const session2 = createTestSession({ id: 's2', workspace: '/ws1' });
      const session3 = createTestSession({ id: 's3', workspace: '/ws2' });

      await store.save(session1);
      await store.save(session2);
      await store.save(session3);

      const sessions = await store.list('/ws1');
      expect(sessions.length).toBe(2);
      expect(sessions.map(s => s.id).sort()).toEqual(['s1', 's2']);
    });

    it('returns empty array when no sessions exist', async () => {
      const sessions = await store.list('/ws1');
      expect(sessions).toEqual([]);
    });

    it('sorts by updatedAt descending', async () => {
      const session1 = createTestSession({ id: 's1', updatedAt: '2026-01-01T00:00:00Z' });
      const session2 = createTestSession({ id: 's2', updatedAt: '2026-01-02T00:00:00Z' });

      await store.save(session1);
      await store.save(session2);

      const sessions = await store.list('/test/workspace');
      expect(sessions[0].id).toBe('s2');
      expect(sessions[1].id).toBe('s1');
    });
  });
});
