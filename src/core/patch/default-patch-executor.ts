import { PatchExecutor } from '../../contracts/patch-executor';
import { randomUUID } from 'crypto';
import { BackupManager } from '../../contracts/backup-manager';
import { ValidationEngine } from '../../contracts/validation-engine';
import { TestRunner } from '../../contracts/test-runner';
import { SessionManager } from '../session/session-manager';
import { GitManager } from '../../contracts/git-manager';
import { CommitMessageGenerator } from '../git/commit-message-generator';
import { PatchRequest, PatchResult } from '../../domain/patch';
import { Workspace } from '../../contracts/workspace';
import path from 'path';
import { ExecutionLogger } from '../observability/execution-logger';

/**
 * R2.6: DefaultPatchExecutor
 *
 * Orchestrates safe patch execution:
 *   1. Validate request
 *   2. Create backup of affected files
 *   3. Apply operations (create/modify/delete)
 *   4. Run validation (build)
 *   5. Run tests
 *   6. On failure: automatic rollback
 *
 * Records every phase in session audit trail.
 * Never throws — always returns a PatchResult.
 */
export class DefaultPatchExecutor implements PatchExecutor {
  private readonly commitMessageGenerator: CommitMessageGenerator;

  constructor(
    private readonly workspace: Workspace,
    private readonly backupManager: BackupManager,
    private readonly validationEngine: ValidationEngine,
    private readonly testRunner: TestRunner,
    private readonly sessionManager?: SessionManager,
    private readonly gitManager?: GitManager
  ) {
    this.commitMessageGenerator = new CommitMessageGenerator();
  }

  async execute(request: PatchRequest): Promise<PatchResult> {
    const { sessionId, operations } = request;
    const changedFiles: string[] = [];
    const failedFiles: string[] = [];
    let rollbackPerformed = false;

    try {
      // Validate request
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        return this.failureResult(
          changedFiles,
          failedFiles,
          false,
          false,
          false,
          validation.error
        );
      }

      // E.3: Scope validation — check if operations target expected files
      if (request.expectedFiles && request.expectedFiles.length > 0) {
        const scopeSet = new Set(request.expectedFiles);
        const justificationKeywords = ['required', 'helper', 'dependency', 'necessary', 'needed'];
        const reasonLower = (request.reason || '').toLowerCase();
        const hasJustification = justificationKeywords.some(kw => reasonLower.includes(kw));

        const outOfScope: string[] = [];
        for (const op of operations) {
          if (!scopeSet.has(op.path)) {
            outOfScope.push(op.path);
          }
        }

        if (outOfScope.length > 0 && !hasJustification) {
          const errMsg = `E.3 SCOPE_VIOLATION: Attempted to modify file(s) outside step scope without justification.\n` +
            `  Out-of-scope files: ${outOfScope.join(', ')}\n` +
            `  Expected files: ${Array.from(scopeSet).join(', ')}\n` +
            `  If this change is necessary, include one of these keywords in the patch reason: ${justificationKeywords.join(', ')}`;
          ExecutionLogger.log('PATCH', '-', '-',
            `⚠️ E.3 Scope violation: ${outOfScope.length} file(s) out of scope, no justification`,
            { outOfScope, expectedFiles: Array.from(scopeSet) }
          );
          return this.failureResult(
            changedFiles, failedFiles, false, false, false, errMsg
          );
        }

        if (outOfScope.length > 0 && hasJustification) {
          ExecutionLogger.log('PATCH', '-', '-',
            `ℹ️ E.3 Out-of-scope file(s) allowed with justification: ${outOfScope.join(', ')}`,
            { outOfScope, expectedFiles: Array.from(scopeSet) }
          );
        }
      }

      // Step 1: Create backup
      await this.recordEvent(sessionId, 'BACKUP_CREATED', 'Creating backup of affected files');
      const filesToBackup = operations.map(op => op.path);
      ExecutionLogger.log('PATCH', '-', '-', `Creating backup of ${filesToBackup.length} files`);
      const metadata = await this.backupManager.createBackup(sessionId, filesToBackup);

      // Step 2: Apply operations
      try {
        for (const op of operations) {
          try {
            await this.applyOperation(op);
            changedFiles.push(op.path);
            ExecutionLogger.log('PATCH', '-', '-', `Applied: ${op.operation} ${op.path}`);
          } catch (error: any) {
            failedFiles.push(op.path);
            throw new Error(`Apply failed for ${op.path}: ${error.message}`);
          }
        }

        await this.recordEvent(
          sessionId,
          'PATCH_APPLIED',
          `Patch applied: ${changedFiles.length} file(s)`,
          { changedFiles: [...changedFiles] }
        );
      } catch (error: any) {
        // Apply phase failed — rollback immediately (no validation yet)
        await this.recordEvent(sessionId, 'PATCH_FAILED', `Apply phase failed: ${error.message}`);
        rollbackPerformed = await this.performRollback(sessionId);
        return this.failureResult(changedFiles, failedFiles, rollbackPerformed, false, false, error.message);
      }

      // Step 3: Run validation
      await this.recordEvent(sessionId, 'VALIDATION_STARTED', 'Running validation');
      ExecutionLogger.log('PATCH', '-', '-', 'Running build validation');
      const validationResult = await this.validationEngine.validate(changedFiles);
      if (!validationResult.passed) {
        await this.recordEvent(
          sessionId,
          'VALIDATION_FAILED',
          `Validation failed: ${validationResult.command}`,
          { stderr: validationResult.stderr.substring(0, 1000) }
        );
        rollbackPerformed = await this.performRollback(sessionId);
        return this.failureResult(
          changedFiles,
          failedFiles,
          rollbackPerformed,
          false,
          false,
          `Validation failed: ${validationResult.stderr || validationResult.stdout}`.substring(0, 500)
        );
      }
      await this.recordEvent(sessionId, 'VALIDATION_PASSED', 'Validation passed');

      // Step 4: Run tests
      await this.recordEvent(sessionId, 'TESTS_STARTED', 'Running tests');
      ExecutionLogger.log('PATCH', '-', '-', 'Running tests');
      const testResult = await this.testRunner.run(changedFiles);
      if (!testResult.passed) {
        await this.recordEvent(
          sessionId,
          'TESTS_FAILED',
          `Tests failed: ${testResult.command}`,
          { stderr: testResult.stderr.substring(0, 1000) }
        );
        rollbackPerformed = await this.performRollback(sessionId);
        return this.failureResult(
          changedFiles,
          failedFiles,
          rollbackPerformed,
          true,
          false,
          `Tests failed: ${testResult.stderr || testResult.stdout}`.substring(0, 500)
        );
      }
      await this.recordEvent(sessionId, 'TESTS_PASSED', 'Tests passed');

      // Step 5: Commit if git manager available
      let commitHash: string | null = null;
      if (this.gitManager && request.autoCommit === true) {
        await this.recordEvent(sessionId, 'GIT_COMMIT_STARTED', 'Creating git commit');
        const commitMessage = this.commitMessageGenerator.generate({
          userRequest: request.reason || 'Update code',
          changedFiles,
          patchReason: request.reason,
          validationPassed: true,
          testsPassed: true,
        });

        const commitResult = await this.gitManager.commit({
          sessionId,
          message: commitMessage,
          changedFiles,
        });

        if (commitResult.success) {
          commitHash = commitResult.commitHash;
          await this.sessionManager?.recordStepCompleted(
            sessionId,
            'GIT_COMMIT_COMPLETED',
            `Committed: ${commitMessage} (${commitHash?.substring(0, 7)})`
          );
        } else {
          await this.sessionManager?.recordStepFailed(
            sessionId,
            'GIT_COMMIT_FAILED',
            `Git commit failed: ${commitResult.error}`
          );
        }
      }

      // Step 6: Success!
      return Object.freeze({
        success: true,
        changedFiles: Object.freeze(changedFiles),
        failedFiles: Object.freeze([]),
        rollbackPerformed: false,
        validationPassed: true,
        testsPassed: true,
        commitHash,
      });

    } catch (error: any) {
      // Unexpected error — attempt rollback as last resort
      console.warn(`[PatchExecutor] Unexpected error: ${error.message}`);
      try {
        rollbackPerformed = await this.performRollback(sessionId);
      } catch {}
      return this.failureResult(changedFiles, failedFiles, rollbackPerformed, false, false, error.message);
    }
  }

  async rollback(sessionId: string): Promise<boolean> {
    return this.performRollback(sessionId);
  }

  // ─── Private helpers ───────────────────────────────────────────

  private async applyOperation(op: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    originalContent?: string;
    newContent?: string;
  }): Promise<void> {
    switch (op.operation) {
      case 'create': {
        const exists = await this.workspace.exists(op.path);
        if (exists) {
          throw new Error(`Cannot create: file already exists at ${op.path}`);
        }
        const dir = path.dirname(op.path);
        if (dir && dir !== '.' && dir !== '/' && dir !== '\\') {
          try {
            await this.workspace.mkdir(dir, { recursive: true });
          } catch {
            // Directory may already exist
          }
        }
        await this.workspace.writeFile(op.path, op.newContent ?? '');
        break;
      }

      case 'modify': {
        const exists = await this.workspace.exists(op.path);
        if (!exists) {
          throw new Error(`Cannot modify: file does not exist at ${op.path}`);
        }
        await this.workspace.writeFile(op.path, op.newContent ?? '');
        break;
      }

      case 'delete': {
        const exists = await this.workspace.exists(op.path);
        if (!exists) {
          throw new Error(`Cannot delete: file does not exist at ${op.path}`);
        }
        await this.workspace.deleteFile(op.path);
        break;
      }

      default:
        throw new Error(`Unknown operation type: ${(op as any).operation}`);
    }
  }

  private async performRollback(sessionId: string): Promise<boolean> {
    await this.recordEvent(sessionId, 'ROLLBACK_STARTED', 'Rolling back changes');
    await this.sessionManager?.recordStructuredDecision?.(sessionId, {
      id: randomUUID(),
      type: 'ROLLBACK_CHOSEN',
      rationale: 'Verification or test failure detected, initiating rollback',
      evidence: [],
      timestamp: new Date().toISOString(),
      source: 'runtime',
    });
    const success = await this.backupManager.restoreBackup(sessionId);
    if (success) {
      await this.recordEvent(sessionId, 'ROLLBACK_COMPLETED', 'Rollback completed successfully');
    } else {
      await this.recordEvent(sessionId, 'ROLLBACK_COMPLETED', 'Rollback failed — backup not found', {
        success: false,
      });
    }
    return success;
  }

  private validateRequest(request: PatchRequest): { valid: boolean; error?: string } {
    if (!request.sessionId || request.sessionId.trim().length === 0) {
      return { valid: false, error: 'Missing sessionId' };
    }
    if (!Array.isArray(request.operations) || request.operations.length === 0) {
      return { valid: false, error: 'No operations provided' };
    }
    for (const op of request.operations) {
      if (!op.path || typeof op.path !== 'string') {
        return { valid: false, error: `Invalid operation: missing path` };
      }
      if (!['create', 'modify', 'delete'].includes(op.operation)) {
        return { valid: false, error: `Invalid operation type: ${op.operation}` };
      }
      if (op.operation === 'create' && typeof op.newContent !== 'string') {
        return { valid: false, error: `Create operation missing newContent for ${op.path}` };
      }
      if (op.operation === 'modify' && typeof op.newContent !== 'string') {
        return { valid: false, error: `Modify operation missing newContent for ${op.path}` };
      }
    }
    return { valid: true };
  }

  private async recordEvent(
    sessionId: string,
    type: any,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.sessionManager) return;
    try {
      // Use a type-safe dispatch — SessionManager expects SessionEventType strings
      const method = this.eventTypeToMethod(type);
      if (method === 'recordToolExecuted') {
        // Generic audit — encode as tool execution
        await this.sessionManager.recordToolExecuted(sessionId, `patch:${type}`, true, metadata);
      } else if (method === 'recordStepStarted') {
        await this.sessionManager.recordStepStarted(sessionId, type, message);
      } else if (method === 'recordStepCompleted') {
        await this.sessionManager.recordStepCompleted(sessionId, type, message);
      } else if (method === 'recordStepFailed') {
        await this.sessionManager.recordStepFailed(sessionId, type, message);
      }
    } catch (error: any) {
      console.warn(`[PatchExecutor] Event recording failed: ${error.message}`);
    }
  }

  private eventTypeToMethod(type: string): string {
    switch (type) {
      case 'BACKUP_CREATED':
      case 'PATCH_APPLIED':
      case 'VALIDATION_STARTED':
      case 'VALIDATION_PASSED':
      case 'TESTS_STARTED':
      case 'TESTS_PASSED':
      case 'ROLLBACK_STARTED':
      case 'ROLLBACK_COMPLETED':
        return 'recordStepCompleted';
      case 'PATCH_FAILED':
      case 'VALIDATION_FAILED':
      case 'TESTS_FAILED':
        return 'recordStepFailed';
      default:
        return 'recordToolExecuted';
    }
  }

  private failureResult(
    changedFiles: string[],
    failedFiles: string[],
    rollbackPerformed: boolean,
    validationPassed: boolean,
    testsPassed: boolean,
    error?: string
  ): PatchResult {
    return Object.freeze({
      success: false,
      changedFiles: Object.freeze(changedFiles),
      failedFiles: Object.freeze(failedFiles),
      rollbackPerformed,
      validationPassed,
      testsPassed,
      error,
    });
  }
}
