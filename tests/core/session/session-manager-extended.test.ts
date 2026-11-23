import { SessionManagerExtended } from '../../../src/core/session/session-manager-extended';
import { FileSessionStore } from '../../../src/contracts/file-session-store';
import { SessionStore } from '../../../src/contracts/session-store';
import { ExecutionSession } from '../../../src/domain/session';

describe('SessionManagerExtended', () => {
  let mockLegacyStore: jest.Mocked<SessionStore>;
  let mockFileStore: jest.Mocked<FileSessionStore>;
  let manager: SessionManagerExtended;

  beforeEach(() => {
    mockLegacyStore = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      delete: jest.fn(),
    } as any;

    mockFileStore = {
      save: jest.fn(),
      load: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    } as any;

    manager = new SessionManagerExtended(mockLegacyStore, mockFileStore);
  });

  describe('startSession', () => {
    it('creates a new session', async () => {
      mockFileStore.save.mockResolvedValue(true);

      const session = await manager.startSession({
        id: 'test-1',
        workspace: '/test',
        task: 'Test task',
        status: 'pending',
      });

      expect(session).not.toBeNull();
      expect(session?.status).toBe('running');
      expect(mockFileStore.save).toHaveBeenCalled();
    });

    it('returns null if save fails', async () => {
      mockFileStore.save.mockResolvedValue(false);

      const session = await manager.startSession({
        id: 'test-1',
        workspace: '/test',
        task: 'Test task',
        status: 'pending',
      });

      expect(session).toBeNull();
    });
  });

  describe('updateStepStatus', () => {
    it('updates step state', async () => {
      const session: ExecutionSession = {
        id: 'test-1',
        workspace: '/test',
        task: 'Test',
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          { id: 'step-1', description: 'Step 1', state: 'pending' },
        ],
        decisions: [],
      };

      mockFileStore.load.mockResolvedValue(session);
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.updateStepStatus('test-1', 'step-1', 'running');

      expect(updated).not.toBeNull();
      expect(updated?.steps[0].state).toBe('running');
      expect(updated?.steps[0].startedAt).toBeDefined();
    });

    it('sets completedAt when step completes', async () => {
      const session: ExecutionSession = {
        id: 'test-1',
        workspace: '/test',
        task: 'Test',
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          { id: 'step-1', description: 'Step 1', state: 'running', startedAt: new Date().toISOString() },
        ],
        decisions: [],
      };

      mockFileStore.load.mockResolvedValue(session);
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.updateStepStatus('test-1', 'step-1', 'completed');

      expect(updated?.steps[0].completedAt).toBeDefined();
    });

    it('marks session as failed when step fails', async () => {
      const session: ExecutionSession = {
        id: 'test-1',
        workspace: '/test',
        task: 'Test',
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          { id: 'step-1', description: 'Step 1', state: 'running' },
        ],
        decisions: [],
      };

      mockFileStore.load.mockResolvedValue(session);
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.updateStepStatus('test-1', 'step-1', 'failed', {
        error: 'Step failed',
      });

      expect(updated?.status).toBe('failed');
      expect(updated?.failedStepId).toBe('step-1');
      expect(updated?.steps[0].error).toBe('Step failed');
    });
  });

  describe('addDecision', () => {
    it('adds a decision record', async () => {
      const session: ExecutionSession = {
        id: 'test-1',
        workspace: '/test',
        task: 'Test',
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
        decisions: [],
      };

      mockFileStore.load.mockResolvedValue(session);
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.addDecision('test-1', {
        question: 'Which approach?',
        decision: 'Use approach A',
        reasoning: 'Because it is simpler',
        alternatives: ['Approach B', 'Approach C'],
        consequences: 'Faster implementation',
      });

      expect(updated?.decisions.length).toBe(1);
      expect(updated?.decisions[0].question).toBe('Which approach?');
      expect(updated?.decisions[0].id).toBeDefined();
      expect(updated?.decisions[0].timestamp).toBeDefined();
    });
  });

  describe('lifecycle methods', () => {
    const createSession = (): ExecutionSession => ({
      id: 'test-1',
      workspace: '/test',
      task: 'Test',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      decisions: [],
    });

    it('completes a session', async () => {
      mockFileStore.load.mockResolvedValue(createSession());
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.completeSession('test-1');
      expect(updated?.status).toBe('completed');
    });

    it('fails a session', async () => {
      mockFileStore.load.mockResolvedValue(createSession());
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.failSession('test-1', 'Fatal error', 'step-1');
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('Fatal error');
      expect(updated?.failedStepId).toBe('step-1');
    });

    it('pauses a session', async () => {
      mockFileStore.load.mockResolvedValue(createSession());
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.pauseSession('test-1');
      expect(updated?.status).toBe('paused');
    });

    it('resumes a paused session', async () => {
      const pausedSession = { ...createSession(), status: 'paused' as const };
      mockFileStore.load.mockResolvedValue(pausedSession);
      mockFileStore.update.mockResolvedValue(true);

      const updated = await manager.resumeSession('test-1');
      expect(updated?.status).toBe('running');
    });

    it('cannot resume a running session', async () => {
      mockFileStore.load.mockResolvedValue(createSession());
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const updated = await manager.resumeSession('test-1');
      expect(updated).toBeNull();
      
      warnSpy.mockRestore();
    });
  });

  describe('findUnfinishedSessions', () => {
    it('returns paused and failed sessions', async () => {
      const sessions: ExecutionSession[] = [
        { id: 's1', workspace: '/test', task: 'Test', status: 'completed', createdAt: '', updatedAt: '', steps: [], decisions: [] },
        { id: 's2', workspace: '/test', task: 'Test', status: 'paused', createdAt: '', updatedAt: '', steps: [], decisions: [] },
        { id: 's3', workspace: '/test', task: 'Test', status: 'failed', createdAt: '', updatedAt: '', steps: [], decisions: [] },
        { id: 's4', workspace: '/test', task: 'Test', status: 'running', createdAt: '', updatedAt: '', steps: [], decisions: [] },
      ];

      mockFileStore.list.mockResolvedValue(sessions);

      const unfinished = await manager.findUnfinishedSessions('/test');
      expect(unfinished.length).toBe(2);
      expect(unfinished.map(s => s.id).sort()).toEqual(['s2', 's3']);
    });
  });
});
