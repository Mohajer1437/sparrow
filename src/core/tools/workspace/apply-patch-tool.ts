import { Tool, ToolResult } from '../../../domain/tool';
import { PatchExecutor } from '../../../contracts/patch-executor';
import { SessionManager } from '../../session/session-manager';
import { PatchRequest, PatchOperation } from '../../../domain/patch';

/**
 * R2.6: ApplyPatchTool
 *
 * LLM-facing tool for safe batch file operations.
 * Preferred over individual write_file/create_file/delete_file
 * when multiple files need to change atomically.
 *
 * All operations are:
 *   - Backed up before application
 *   - Validated after application
 *   - Tested
 *   - Rolled back automatically on failure
 */
export class ApplyPatchTool implements Tool {
  readonly name = 'apply_patch';
  readonly description = `Apply a batch of file operations atomically with automatic backup, validation, testing, and rollback on failure.
PREFERRED over individual write_file/create_file/delete_file for multi-file changes.

Operations:
- create: Create a new file (fails if exists)
- modify: Update existing file (fails if missing)
- delete: Delete existing file (fails if missing)

Input: {
  reason: string,          // Human-readable reason for this patch
  operations: Array<{
    path: string,
    operation: "create" | "modify" | "delete",
    newContent?: string    // Required for create/modify
  }>
}`;

  readonly parameters = {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Human-readable reason for this patch' },
      operations: {
        type: 'array',
        description: 'List of file operations to apply atomically',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            operation: { type: 'string', enum: ['create', 'modify', 'delete'] },
            newContent: { type: 'string' },
          },
          required: ['path', 'operation'],
        },
      },
    },
    required: ['reason', 'operations'],
  };

  constructor(
    private readonly patchExecutor: PatchExecutor,
    private readonly sessionManager?: SessionManager
  ) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const rawSessionId = input.sessionId;
    const sessionId = (typeof rawSessionId === 'string' && rawSessionId.trim().length > 0)
      ? rawSessionId
      : 'apply-patch-' + Date.now();
    const reason = (typeof input.reason === 'string' && input.reason.trim().length > 0)
      ? input.reason
      : 'Apply patch';
    const operations = (input.operations as any[]) || [];

    if (!Array.isArray(operations) || operations.length === 0) {
      return {
        toolCallId: '',
        content: 'Invalid input: operations must be a non-empty array',
        isError: true,
      };
    }

    const patchOps: PatchOperation[] = operations.map(op => ({
      path: String(op.path || ''),
      operation: op.operation,
      newContent: typeof op.newContent === 'string' ? op.newContent : undefined,
    }));

    // E.3: Read expectedFiles from session scope (set by StepExecutionEngine)
    const expectedFiles = this.sessionManager?.getExpectedFiles(sessionId);

    const request: PatchRequest = {
      sessionId,
      operations: patchOps,
      reason,
      autoCommit: false,  // Per-step commit: commit happens at StepExecutionEngine
      expectedFiles,
    };

    try {
      const result = await this.patchExecutor.execute(request);

      if (result.success) {
        const msg = [
          `✓ Patch applied successfully`,
          `  Changed files: ${result.changedFiles.length}`,
          `  Validation: passed`,
          `  Tests: passed`,
          ``,
          `Files:`,
          ...result.changedFiles.map(f => `  - ${f}`),
        ].join('\n');
        return { toolCallId: '', content: msg, isError: false };
      }

      const msg = [
        `✗ Patch failed${result.rollbackPerformed ? ' (rolled back)' : ''}`,
        ``,
        `Error: ${result.error || 'Unknown error'}`,
        ``,
        `Changed files: ${result.changedFiles.length}`,
        `Failed files: ${result.failedFiles.length}`,
        `Validation: ${result.validationPassed ? 'passed' : 'failed'}`,
        `Tests: ${result.testsPassed ? 'passed' : 'failed'}`,
        `Rollback: ${result.rollbackPerformed ? 'yes' : 'no'}`,
      ].join('\n');
      return { toolCallId: '', content: msg, isError: true };
    } catch (error: any) {
      return {
        toolCallId: '',
        content: `Patch execution error: ${error.message}`,
        isError: true,
      };
    }
  }
}
