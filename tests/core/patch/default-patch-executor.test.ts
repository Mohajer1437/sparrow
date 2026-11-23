import { DefaultPatchExecutor } from '../../../src/core/patch/default-patch-executor';
import { BackupManager } from '../../../src/contracts/backup-manager';
import { ValidationEngine } from '../../../src/contracts/validation-engine';
import { TestRunner } from '../../../src/contracts/test-runner';
import { SessionManager } from '../../../src/core/session/session-manager';
import { Workspace } from '../../../src/contracts/workspace';
import { PatchRequest } from '../../../src/domain/patch';

describe('DefaultPatchExecutor', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let mockBackupManager: jest.Mocked<BackupManager>;
  let mockValidation: jest.Mocked<ValidationEngine>;
  let mockTestRunner: jest.Mocked<TestRunner>;
  let mockSessionManager: jest.Mocked<SessionManager>;
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
      writeFile: jest.fn(async (p: string, c: string) => {
        workspaceFiles.set(p, c);
      }),
      exists: jest.fn(async (p: string) => workspaceFiles.has(p)),
      deleteFile: jest.fn(async (p: string) => {
        if (!workspaceFiles.has(p)) throw new Error('ENOENT');
        workspaceFiles.delete(p);
      }),
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
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        operations: [],
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

    executor = new DefaultPatchExecutor(
      mockWorkspace,
      mockBackupManager,
      mockValidation,
      mockTestRunner,
      mockSessionManager
    );
  });

  const makeRequest = (overrides: Partial<PatchRequest> = {}): PatchRequest => ({
    sessionId: 'sess-1',
    operations: [
      { path: 'src/a.ts', operation: 'create', newContent: 'console.log("hello")' },
    ],
    ...overrides,
  });

  describe('successful operations', () => {
    it('creates a file successfully', async () => {
      const result = await executor.execute(makeRequest());
      expect(result.success).toBe(true);
      expect(result.changedFiles).toEqual(['src/a.ts']);
      expect(result.validationPassed).toBe(true);
      expect(result.testsPassed).toBe(true);
      expect(result.rollbackPerformed).toBe(false);
      expect(workspaceFiles.get('src/a.ts')).toBe('console.log("hello")');
    });

    it('modifies a file successfully', async () => {
      workspaceFiles.set('src/a.ts', 'original');

      const result = await executor.execute(makeRequest({
        operations: [{
          path: 'src/a.ts',
          operation: 'modify',
          newContent: 'modified',
        }],
      }));

      expect(result.success).toBe(true);
      expect(workspaceFiles.get('src/a.ts')).toBe('modified');
    });

    it('deletes a file successfully', async () => {
      workspaceFiles.set('src/a.ts', 'to be deleted');

      const result = await executor.execute(makeRequest({
        operations: [{ path: 'src/a.ts', operation: 'delete' }],
      }));

      expect(result.success).toBe(true);
      expect(workspaceFiles.has('src/a.ts')).toBe(false);
    });

    it('backs up files before applying', async () => {
      workspaceFiles.set('src/a.ts', 'original');

      await executor.execute(makeRequest({
        operations: [{
          path: 'src/a.ts',
          operation: 'modify',
          newContent: 'modified',
        }],
      }));

      expect(mockBackupManager.createBackup).toHaveBeenCalledWith(
        'sess-1',
        ['src/a.ts']
      );
    });

    it('records session events throughout execution', async () => {
      await executor.execute(makeRequest());

      // Should record: BACKUP_CREATED, PATCH_APPLIED, VALIDATION_*, TESTS_*
      expect(mockSessionManager.recordStepCompleted).toHaveBeenCalled();
      const eventTypes = mockSessionManager.recordStepCompleted.mock.calls.map(
        (call: any[]) => call[1]
      );
      expect(eventTypes).toContain('BACKUP_CREATED');
      expect(eventTypes).toContain('PATCH_APPLIED');
    });
  });

  describe('rollback behavior', () => {
    it('rolls back on validation failure', async () => {
      mockValidation.validate.mockResolvedValue({
        passed: false, stdout: '', stderr: 'build error',
        exitCode: 1, timedOut: false, command: 'build',
      });

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);
      expect(result.validationPassed).toBe(false);
      expect(mockBackupManager.restoreBackup).toHaveBeenCalledWith('sess-1');
    });

    it('rolls back on test failure', async () => {
      mockTestRunner.run.mockResolvedValue({
        passed: false, stdout: '', stderr: 'test failed',
        exitCode: 1, timedOut: false, command: 'test',
      });

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);
      expect(result.testsPassed).toBe(false);
      expect(result.validationPassed).toBe(true);
    });

    it('rolls back on apply failure (mid-batch)', async () => {
      workspaceFiles.set('src/a.ts', 'A');

      const result = await executor.execute(makeRequest({
        operations: [
          { path: 'src/a.ts', operation: 'modify', newContent: 'A modified' },
          { path: 'src/missing.ts', operation: 'modify', newContent: 'B' }, // will fail
        ],
      }));

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);
      expect(result.failedFiles).toContain('src/missing.ts');
    });

    it('expose rollback() for manual rollback', async () => {
      const success = await executor.rollback('sess-1');
      expect(success).toBe(true);
      expect(mockBackupManager.restoreBackup).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('request validation', () => {
    it('rejects empty sessionId', async () => {
      const result = await executor.execute(makeRequest({ sessionId: '' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId');
    });

    it('rejects empty operations', async () => {
      const result = await executor.execute(makeRequest({ operations: [] }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('operations');
    });

    it('rejects create without newContent', async () => {
      const result = await executor.execute(makeRequest({
        operations: [{ path: 'src/a.ts', operation: 'create' }],
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('newContent');
    });

    it('rejects invalid operation type', async () => {
      const result = await executor.execute(makeRequest({
        operations: [{ path: 'src/a.ts', operation: 'invalid' as any }],
      }));
      expect(result.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('never throws — returns PatchResult on unexpected error', async () => {
      mockBackupManager.createBackup.mockRejectedValue(new Error('Boom'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await expect(executor.execute(makeRequest())).resolves.toBeDefined();
      warnSpy.mockRestore();
    });

    it('works without session manager (graceful)', async () => {
      const executorNoSession = new DefaultPatchExecutor(
        mockWorkspace, mockBackupManager, mockValidation, mockTestRunner
      );

      const result = await executorNoSession.execute(makeRequest());
      expect(result.success).toBe(true);
    });
  });
});
