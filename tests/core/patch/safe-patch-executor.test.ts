import { SafePatchExecutor, MAX_PATCH_RETRIES } from '../../../src/core/patch/safe-patch-executor';
import { PatchExecutor } from '../../../src/contracts/patch-executor';
import { VerificationEngine } from '../../../src/contracts/verification-engine';
import { SessionManager } from '../../../src/core/session/session-manager';
import { PatchRequest } from '../../../src/domain/patch';

describe('SafePatchExecutor', () => {
  let mockPatchExecutor: jest.Mocked<PatchExecutor>;
  let mockVerificationEngine: jest.Mocked<VerificationEngine>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let safeExecutor: SafePatchExecutor;

  const dummyRequest: PatchRequest = {
    sessionId: 'test-session',
    operations: []
  };

  beforeEach(() => {
    mockPatchExecutor = {
      execute: jest.fn(),
      rollback: jest.fn()
    } as any;

    mockVerificationEngine = {
      verify: jest.fn()
    } as any;

    mockSessionManager = {
      addRetryAttempt: jest.fn(),
      getSession: jest.fn(),
      updateSession: jest.fn()
    } as any;

    safeExecutor = new SafePatchExecutor({
      workspacePath: '/test/workspace',
      patchExecutor: mockPatchExecutor,
      verificationEngine: mockVerificationEngine,
      sessionManager: mockSessionManager
    });
  });

  it('succeeds on first attempt when verification passes', async () => {
    mockPatchExecutor.execute.mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true
    });
    mockVerificationEngine.verify.mockResolvedValue({
      success: true,
      checks: [],
      errors: [],
      timestamp: new Date().toISOString()
    });
    mockSessionManager.getSession.mockResolvedValue({
      id: 'test',
      workspace: '/test',
      task: 'test',
      status: 'executing',
      completedSteps: [],
      failedSteps: [],
      retryHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    const result = await safeExecutor.executeWithVerification('test-session', dummyRequest);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockPatchExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('retries on verification failure', async () => {
    mockPatchExecutor.execute.mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true
    });
    mockPatchExecutor.rollback.mockResolvedValue(true);
    mockVerificationEngine.verify
      .mockResolvedValueOnce({
        success: false,
        checks: [],
        errors: ['TypeScript error'],
        timestamp: new Date().toISOString()
      })
      .mockResolvedValueOnce({
        success: true,
        checks: [],
        errors: [],
        timestamp: new Date().toISOString()
      });
    mockSessionManager.addRetryAttempt.mockResolvedValue(undefined);
    mockSessionManager.getSession.mockResolvedValue({
      id: 'test',
      workspace: '/test',
      task: 'test',
      status: 'executing',
      completedSteps: [],
      failedSteps: [],
      retryHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    const result = await safeExecutor.executeWithVerification('test-session', dummyRequest);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockPatchExecutor.execute).toHaveBeenCalledTimes(2);
    expect(mockPatchExecutor.rollback).toHaveBeenCalledTimes(1);
  });

  it('stops after MAX_PATCH_RETRIES', async () => {
    mockPatchExecutor.execute.mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true
    });
    mockPatchExecutor.rollback.mockResolvedValue(true);
    mockVerificationEngine.verify.mockResolvedValue({
      success: false,
      checks: [],
      errors: ['Persistent error'],
      timestamp: new Date().toISOString()
    });
    mockSessionManager.addRetryAttempt.mockResolvedValue(undefined);
    mockSessionManager.getSession.mockResolvedValue({
      id: 'test',
      workspace: '/test',
      task: 'test',
      status: 'executing',
      completedSteps: [],
      failedSteps: [],
      retryHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    const result = await safeExecutor.executeWithVerification('test-session', dummyRequest);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(MAX_PATCH_RETRIES);
    expect(result.finalError).toContain(`Max retries (${MAX_PATCH_RETRIES}) exceeded`);
  });

  it('updates session to completed on success', async () => {
    mockPatchExecutor.execute.mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true
    });
    mockVerificationEngine.verify.mockResolvedValue({
      success: true,
      checks: [],
      errors: [],
      timestamp: new Date().toISOString()
    });
    mockSessionManager.getSession.mockResolvedValue({
      id: 'test',
      workspace: '/test',
      task: 'test',
      status: 'executing',
      completedSteps: [],
      failedSteps: [],
      retryHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    await safeExecutor.executeWithVerification('test-session', dummyRequest);

    expect(mockSessionManager.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('updates session to rolled_back on max retries', async () => {
    mockPatchExecutor.execute.mockResolvedValue({
      success: true,
      changedFiles: [],
      failedFiles: [],
      rollbackPerformed: false,
      validationPassed: true,
      testsPassed: true
    });
    mockPatchExecutor.rollback.mockResolvedValue(true);
    mockVerificationEngine.verify.mockResolvedValue({
      success: false,
      checks: [],
      errors: ['Error'],
      timestamp: new Date().toISOString()
    });
    mockSessionManager.addRetryAttempt.mockResolvedValue(undefined);
    mockSessionManager.getSession.mockResolvedValue({
      id: 'test',
      workspace: '/test',
      task: 'test',
      status: 'executing',
      completedSteps: [],
      failedSteps: [],
      retryHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);
    mockSessionManager.updateSession.mockResolvedValue(undefined);

    await safeExecutor.executeWithVerification('test-session', dummyRequest);

    expect(mockSessionManager.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rolled_back' })
    );
  });
});
