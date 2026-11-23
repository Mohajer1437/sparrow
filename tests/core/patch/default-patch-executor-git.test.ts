import { DefaultPatchExecutor } from '../../../src/core/patch/default-patch-executor';
import { BackupManager } from '../../../src/contracts/backup-manager';
import { ValidationEngine } from '../../../src/contracts/validation-engine';
import { TestRunner } from '../../../src/contracts/test-runner';
import { SessionManager } from '../../../src/core/session/session-manager';
import { GitManager } from '../../../src/contracts/git-manager';
import { Workspace } from '../../../src/contracts/workspace';
import { PatchRequest } from '../../../src/domain/patch';

describe('DefaultPatchExecutor - Git Integration', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let mockBackupManager: jest.Mocked<BackupManager>;
  let mockValidation: jest.Mocked<ValidationEngine>;
  let mockTestRunner: jest.Mocked<TestRunner>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockGitManager: jest.Mocked<GitManager>;
  let executor: DefaultPatchExecutor;
  let workspaceFiles: Map<string, string>;

  beforeEach(() => {
    workspaceFiles = new Map<string, string>();

    mockWorkspace = {
      readFile: jest.fn(async (p: string) => {
        const c = workspaceFiles.get(p);
        if (c === undefined) throw new Error('ENOENT');
        return c;
      }),
      writeFile: jest.fn(async (p: string, c: string) => { workspaceFiles.set(p, c); }),
      exists: jest.fn(async (p: string) => workspaceFiles.has(p)),
      deleteFile: jest.fn(async (p: string) => { workspaceFiles.delete(p); }),
      mkdir: jest.fn(async () => {}),
      listFiles: jest.fn(async () => []),
      listEntries: jest.fn(async () => []),
      createSnapshot: jest.fn(),
      rollback: jest.fn(),
      diff: jest.fn(),
      isDirectory: jest.fn(),
    } as any;

    mockBackupManager = {
      createBackup: jest.fn(async () => ({
        sessionId: 's1', createdAt: '', operations: [],
      })),
      restoreBackup: jest.fn(async () => true),
      hasBackup: jest.fn(async () => true),
    } as any;

    mockValidation = {
      validate: jest.fn(async () => ({
        passed: true, stdout: '', stderr: '', exitCode: 0,
        timedOut: false, command: 'build',
      })),
    } as any;

    mockTestRunner = {
      run: jest.fn(async () => ({
        passed: true, stdout: '', stderr: '', exitCode: 0,
        timedOut: false, command: 'test',
      })),
    } as any;

    mockSessionManager = {
      recordStepStarted: jest.fn(async () => {}),
      recordStepCompleted: jest.fn(async () => {}),
      recordStepFailed: jest.fn(async () => {}),
      recordToolExecuted: jest.fn(async () => {}),
    } as any;

    mockGitManager = {
      commit: jest.fn(async () => ({
        success: true,
        commitHash: 'abc123',
        message: 'test commit',
        timestamp: new Date().toISOString(),
      })),
      status: jest.fn(),
      rollback: jest.fn(),
      getCurrentBranch: jest.fn(),
      listRecentCommits: jest.fn(),
      isRepository: jest.fn(async () => true),
    } as any;

    executor = new DefaultPatchExecutor(
      mockWorkspace,
      mockBackupManager,
      mockValidation,
      mockTestRunner,
      mockSessionManager,
      mockGitManager
    );
  });

  const makeRequest = (overrides: Partial<PatchRequest> = {}): PatchRequest => ({
    sessionId: 'sess-1',
    operations: [
      { path: 'src/a.ts', operation: 'create', newContent: 'hello' },
    ],
    autoCommit: true,  // Required for git commit to trigger
    ...overrides,
  });

  describe('git integration', () => {
    it('commits after successful patch', async () => {
      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(true);
      expect(mockGitManager.commit).toHaveBeenCalled();
    });

    it('does NOT commit when validation fails', async () => {
      mockValidation.validate.mockResolvedValue({
        passed: false, stdout: '', stderr: 'build error',
        exitCode: 1, timedOut: false, command: 'build',
      });

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(mockGitManager.commit).not.toHaveBeenCalled();
    });

    it('does NOT commit when tests fail', async () => {
      mockTestRunner.run.mockResolvedValue({
        passed: false, stdout: '', stderr: 'test failed',
        exitCode: 1, timedOut: false, command: 'test',
      });

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(mockGitManager.commit).not.toHaveBeenCalled();
    });

    it('patch still succeeds if git commit fails', async () => {
      mockGitManager.commit.mockResolvedValue({
        success: false,
        commitHash: null,
        message: '',
        timestamp: '',
        error: 'Git not configured',
      });

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeNull();
    });

    it('patch succeeds if git manager is unavailable', async () => {
      const executorNoGit = new DefaultPatchExecutor(
        mockWorkspace,
        mockBackupManager,
        mockValidation,
        mockTestRunner,
        mockSessionManager
      );

      const result = await executorNoGit.execute(makeRequest());
      expect(result.success).toBe(true);
    });

    it('records git commit events in session', async () => {
      await executor.execute(makeRequest());

      const eventTypes = mockSessionManager.recordStepCompleted.mock.calls.map(
        (call: any[]) => call[1]
      );

      expect(eventTypes).toContain('GIT_COMMIT_COMPLETED');
    });

    it('records git commit failure events', async () => {
      mockGitManager.commit.mockResolvedValue({
        success: false,
        commitHash: null,
        message: '',
        timestamp: '',
        error: 'Failed',
      });

      await executor.execute(makeRequest());

      const eventTypes = mockSessionManager.recordStepFailed.mock.calls.map(
        (call: any[]) => call[1]
      );

      expect(eventTypes).toContain('GIT_COMMIT_FAILED');
    });

    it('uses commit message from generator', async () => {
      await executor.execute(makeRequest({
        reason: 'Add authentication middleware',
      }));

      const commitCall = mockGitManager.commit.mock.calls[0][0];
      expect(commitCall.message).toContain('auth');
      expect(commitCall.sessionId).toBe('sess-1');
    });
  });
});
