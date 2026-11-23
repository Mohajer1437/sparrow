import { SessionManager } from '../../../src/core/session/session-manager';
import { SessionStore } from '../../../src/contracts/session-store';
import { WorkspaceSession } from '../../../src/domain/workspace-session';
import { Decision } from '../../../src/domain/decision';

describe('Decision Memory', () => {
  let mockStore: jest.Mocked<SessionStore>;
  let sessionManager: SessionManager;

  const mockSession: WorkspaceSession = {
    id: 'sess-1',
    workspacePath: '/test',
    task: 'Test task',
    plan: null,
    status: 'executing',
    currentStep: 1,
    totalSteps: 3,
    events: [],
    createdAt: '',
    updatedAt: '',
    modifiedFiles: [],
  };

  beforeEach(() => {
    mockStore = {
      create: jest.fn(),
      get: jest.fn().mockResolvedValue(mockSession),
      update: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(true),
    } as any;
    sessionManager = new SessionManager(mockStore, '/test');
  });

  it('records a structured decision and persists it', async () => {
    const decision: Decision = {
      id: 'dec-1',
      type: 'ROLLBACK_CHOSEN',
      rationale: 'Validation failed',
      evidence: ['build error'],
      timestamp: new Date().toISOString(),
      source: 'runtime',
    };

    await sessionManager.recordStructuredDecision('sess-1', decision);

    expect(mockStore.update).toHaveBeenCalledWith('sess-1', {
      decisions: [decision],
    });
  });

  it('maintains backward compatibility for string-based recordDecision', async () => {
    await sessionManager.recordDecision('sess-1', 'Chose fallback', 'Primary failed');

    expect(mockStore.update).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      events: expect.any(Array),
    }));
    
    const updateCall = mockStore.update.mock.calls.find(
      (call: any[]) => call[1].decisions !== undefined
    );
    expect(updateCall).toBeDefined();
    // استفاده از ! برای رفع خطای Strict Null Check
    expect(updateCall![1].decisions![0].type).toBe('GENERIC_RUNTIME_DECISION');
    expect(updateCall![1].decisions![0].rationale).toContain('Chose fallback');
  });

  it('automatically records RETRY_SCHEDULED decision in addRetryAttempt', async () => {
    await sessionManager.addRetryAttempt('sess-1', {
      attempt: 1,
      timestamp: new Date().toISOString(),
      action: 'retry_patch',
      error: 'Timeout',
    });

    const updateCall = mockStore.update.mock.calls.find(
      (call: any[]) => call[1].decisions !== undefined
    );
    expect(updateCall).toBeDefined();
    // استفاده از ! برای رفع خطای Strict Null Check
    expect(updateCall![1].decisions![0].type).toBe('RETRY_SCHEDULED');
    expect(updateCall![1].decisions![0].evidence).toContain('Timeout');
  });

  it('is fail-safe and does not throw if store update fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStore.update.mockRejectedValue(new Error('DB failure'));

    const decision: Decision = {
      id: 'dec-2',
      type: 'PATCH_REJECTED',
      rationale: 'Syntax error',
      evidence: [],
      timestamp: new Date().toISOString(),
      source: 'runtime',
    };

    await expect(sessionManager.recordStructuredDecision('sess-1', decision)).resolves.not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SessionManager] recordStructuredDecision failed')
    );
    
    consoleWarnSpy.mockRestore();
  });
});
