import { SessionManager } from '../../../src/core/session/session-manager';
import { SessionStore } from '../../../src/contracts/session-store';
import { WorkspaceSession } from '../../../src/domain/workspace-session';
import { ExecutionPlan } from '../../../src/domain/execution-plan';

describe('SessionManager', () => {
  let mockStore: jest.Mocked<SessionStore>;
  let manager: SessionManager;
  let currentStore: Map<string, WorkspaceSession>;

  const makePlan = (): ExecutionPlan => Object.freeze({
    id: 'plan-1',
    objective: 'Add auth middleware',
    complexity: 'medium',
    reasoning: 'Test reasoning',
    steps: Object.freeze([
      { id: 'step-1', description: 'Analyze', type: 'analysis' as const,
        requiredTools: ['read_file'], expectedOutcome: 'Analysis done' },
      { id: 'step-2', description: 'Implement', type: 'modify' as const,
        requiredTools: ['write_file'], expectedOutcome: 'File written' },
    ]),
    affectedDomains: Object.freeze(['Auth']),
    validationStrategy: Object.freeze({
      requiredTests: Object.freeze([]),
      successCriteria: Object.freeze([]),
    }),
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    currentStore = new Map();

    mockStore = {
      create: jest.fn(async (session) => {
        currentStore.set(session.id, session);
      }),
      get: jest.fn(async (id) => currentStore.get(id) ?? null),
      update: jest.fn(async (id, patch) => {
        const existing = currentStore.get(id);
        if (!existing) return null;
        const updated: WorkspaceSession = Object.freeze({
          ...existing,
          ...patch,
          id: existing.id,
          updatedAt: new Date().toISOString(),
          events: patch.events
            ? Object.freeze([...existing.events, ...patch.events])
            : existing.events,
        });
        currentStore.set(id, updated);
        return updated;
      }),
      list: jest.fn(async () => Array.from(currentStore.values())),
      delete: jest.fn(async (id) => currentStore.delete(id)),
    } as any;

    manager = new SessionManager(mockStore, '/workspace/test');
  });

  describe('startSession', () => {
    it('creates a new session with plan', async () => {
      const plan = makePlan();
      const id = await manager.startSession('Add auth', plan);

      expect(id).not.toBeNull();
      expect(mockStore.create).toHaveBeenCalled();
      expect(currentStore.size).toBe(1);

      const session = currentStore.get(id!);
      expect(session).toBeDefined();
      expect(session!.task).toBe('Add auth');
      expect(session!.plan).toEqual(plan);
      expect(session!.totalSteps).toBe(2);
      expect(session!.events.length).toBe(2);
    });

    it('creates a session without plan', async () => {
      const id = await manager.startSession('Quick question', null);
      expect(id).not.toBeNull();
      const session = currentStore.get(id!);
      expect(session!.plan).toBeNull();
      expect(session!.totalSteps).toBe(0);
      expect(session!.events.length).toBe(1);
    });

    it('returns null if store.create fails', async () => {
      mockStore.create.mockRejectedValue(new Error('Disk full'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const id = await manager.startSession('Task', null);
      expect(id).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('startSession failed'));
      warnSpy.mockRestore();
    });
  });

  describe('step tracking', () => {
    it('recordStepStarted increments currentStep and sets status', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.recordStepStarted(id!, 'step-1', 'Analyzing auth module');

      const session = currentStore.get(id!);
      expect(session).toBeDefined();
      expect(session!.status).toBe('executing');
      expect(session!.currentStep).toBe(1);
      const lastEvent = session!.events[session!.events.length - 1];
      expect(lastEvent.type).toBe('STEP_STARTED');
      expect(lastEvent.message).toContain('step-1');
    });

    it('recordStepCompleted appends event', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.recordStepCompleted(id!, 'step-1', 'Analysis complete');

      const session = currentStore.get(id!);
      const events = session!.events;
      expect(events.some(e => e.type === 'STEP_COMPLETED')).toBe(true);
    });

    it('recordStepFailed appends event (does not fail session)', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.recordStepFailed(id!, 'step-1', 'File not found');

      const session = currentStore.get(id!);
      expect(session!.status).not.toBe('failed');
      expect(session!.events.some(e => e.type === 'STEP_FAILED')).toBe(true);
    });

    it('recordToolExecuted appends audit event', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.recordToolExecuted(id!, 'read_file', true, { path: 'x.ts' });

      const session = currentStore.get(id!);
      const toolEvents = session!.events.filter(e => e.type === 'TOOL_EXECUTED');
      expect(toolEvents.length).toBe(1);
      expect(toolEvents[0].message).toContain('read_file');
    });

    it('does not update status for terminal sessions', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.completeSession(id!, 'Done');

      await manager.recordStepStarted(id!, 'step-1', 'Should not happen');
      const session = currentStore.get(id!);
      expect(session!.status).toBe('completed');
    });
  });

  describe('lifecycle', () => {
    it('completeSession marks session as completed', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.completeSession(id!, 'All steps succeeded');

      const session = currentStore.get(id!);
      expect(session!.status).toBe('completed');
      expect(session!.events.some(e => e.type === 'SESSION_COMPLETED')).toBe(true);
    });

    it('failSession marks session as failed', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.failSession(id!, 'Unexpected error');

      const session = currentStore.get(id!);
      expect(session!.status).toBe('failed');
      expect(session!.events.some(e => e.type === 'SESSION_FAILED')).toBe(true);
    });

    it('pauseSession marks session as paused', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.pauseSession(id!, 'User interrupted');

      const session = currentStore.get(id!);
      expect(session!.status).toBe('paused');
      expect(session!.events.some(e => e.type === 'SESSION_PAUSED')).toBe(true);
    });
  });

  describe('resumeSession', () => {
    it('resumes a paused session', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.pauseSession(id!, 'Paused');

      const resumed = await manager.resumeSession(id!);
      expect(resumed).not.toBeNull();
      expect(resumed!.status).toBe('executing');
      expect(resumed!.events.some(e => e.type === 'SESSION_RESUMED')).toBe(true);
    });

    it('returns null for terminal sessions', async () => {
      const id = await manager.startSession('Task', makePlan());
      await manager.completeSession(id!, 'Done');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const resumed = await manager.resumeSession(id!);
      expect(resumed).toBeNull();
      warnSpy.mockRestore();
    });

    it('returns null for missing session', async () => {
      const resumed = await manager.resumeSession('nonexistent');
      expect(resumed).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('delegates to store.list', async () => {
      await manager.startSession('Task 1', null);
      await manager.startSession('Task 2', null);

      const list = await manager.listSessions();
      expect(list.length).toBe(2);
    });

    it('returns empty array on store failure', async () => {
      mockStore.list.mockRejectedValue(new Error('Read error'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const list = await manager.listSessions();
      expect(list).toEqual([]);
      warnSpy.mockRestore();
    });
  });

  describe('never throws', () => {
    it('all methods degrade gracefully on store errors', async () => {
      mockStore.create.mockRejectedValue(new Error('Boom'));
      mockStore.get.mockRejectedValue(new Error('Boom'));
      mockStore.update.mockRejectedValue(new Error('Boom'));
      mockStore.list.mockRejectedValue(new Error('Boom'));

      jest.spyOn(console, 'warn').mockImplementation();

      await expect(manager.startSession('Task', null)).resolves.toBeNull();
      await expect(manager.recordStepStarted('x', 's', 'd')).resolves.toBeUndefined();
      await expect(manager.recordStepCompleted('x', 's', 'd')).resolves.toBeUndefined();
      await expect(manager.recordStepFailed('x', 's', 'd')).resolves.toBeUndefined();
      await expect(manager.recordToolExecuted('x', 't', true)).resolves.toBeUndefined();
      await expect(manager.completeSession('x', 'd')).resolves.toBeUndefined();
      await expect(manager.failSession('x', 'd')).resolves.toBeUndefined();
      await expect(manager.pauseSession('x', 'd')).resolves.toBeUndefined();
      await expect(manager.resumeSession('x')).resolves.toBeNull();
      await expect(manager.getSession('x')).resolves.toBeNull();
      await expect(manager.listSessions()).resolves.toEqual([]);

      jest.restoreAllMocks();
    });
  });
});
