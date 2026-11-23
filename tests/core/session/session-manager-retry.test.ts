import { SessionManager } from '../../../src/core/session/session-manager';
import { SessionStore } from '../../../src/contracts/session-store';
import { WorkspaceSession, RetryAttempt } from '../../../src/domain/workspace-session';

describe('SessionManager - Retry Tracking (R2.4 Hardening)', () => {
  let mockStore: jest.Mocked<SessionStore>;
  let manager: SessionManager;

  const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
    id: 'test-session',
    workspacePath: '/test/workspace',
    task: 'Test task',
    plan: null,
    status: 'executing',
    currentStep: 0,
    totalSteps: 3,
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modifiedFiles: [],
    retryHistory: [],
    ...overrides,
  });

  beforeEach(() => {
    mockStore = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      delete: jest.fn()
    } as any;

    manager = new SessionManager(mockStore, '/test/workspace');
  });

  describe('addRetryAttempt', () => {
    it('records retry attempt in session retryHistory', async () => {
      const session = createSession();
      mockStore.get.mockResolvedValue(session);
      mockStore.update.mockResolvedValue(session);

      const retry: RetryAttempt = {
        attempt: 1,
        timestamp: new Date().toISOString(),
        action: 'patch_apply',
        error: 'TypeScript compilation failed',
        resolution: 'Fixed import statement'
      };

      await manager.addRetryAttempt('test-session', retry);

      expect(mockStore.update).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          retryHistory: [retry],
        })
      );
    });

    it('accumulates multiple retry attempts', async () => {
      const existingRetry: RetryAttempt = {
        attempt: 1,
        timestamp: '2026-01-15T10:00:00.000Z',
        action: 'patch_apply',
        error: 'Error 1'
      };

      const session = createSession({ retryHistory: [existingRetry] });
      mockStore.get.mockResolvedValue(session);
      mockStore.update.mockResolvedValue(session);

      const retry2: RetryAttempt = {
        attempt: 2,
        timestamp: new Date().toISOString(),
        action: 'verification',
        error: 'Test failed'
      };

      await manager.addRetryAttempt('test-session', retry2);

      expect(mockStore.update).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          retryHistory: [existingRetry, retry2],
        })
      );
    });

    it('throws error if session not found', async () => {
      mockStore.get.mockResolvedValue(null as any);

      const retry: RetryAttempt = {
        attempt: 1,
        timestamp: new Date().toISOString(),
        action: 'patch_apply',
        error: 'Error'
      };

      await expect(
        manager.addRetryAttempt('nonexistent', retry)
      ).rejects.toThrow('Session not found');
    });

    it('handles sessions without existing retryHistory', async () => {
      const session = createSession();
      (session as any).retryHistory = undefined;
      mockStore.get.mockResolvedValue(session);
      mockStore.update.mockResolvedValue(session);

      const retry: RetryAttempt = {
        attempt: 1,
        timestamp: new Date().toISOString(),
        action: 'patch_apply',
        error: 'Error'
      };

      await manager.addRetryAttempt('test-session', retry);

      const updateCall = mockStore.update.mock.calls[0][1] as any;
      expect(updateCall.retryHistory).toBeDefined();
      expect(updateCall.retryHistory).toHaveLength(1);
      expect(updateCall.retryHistory[0]).toEqual(retry);
    });
  });
});
