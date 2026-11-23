import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';
import { PatchExecutor } from '../../../contracts/patch-executor';
import * as path from 'path';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly description = 'Write content to a file. CREATES the file if missing, OVERWRITES it if exists. Use this for both creating new files and updating existing files. Creates parent directories automatically. Input: { path: string, content: string }';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file (new or existing)'
      },
      content: {
        type: 'string',
        description: 'Content to write to the file'
      }
    },
    required: ['path', 'content']
  };

  constructor(
    private readonly workspace: Workspace,
    private readonly patchExecutor: PatchExecutor
  ) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const filePath = input.path as string;
    const content = input.content as string;

    if (!filePath || typeof filePath !== 'string') {
      return { toolCallId: '', content: 'Invalid input: path must be a string', isError: true };
    }
    if (typeof content !== 'string') {
      return { toolCallId: '', content: 'Invalid input: content must be a string', isError: true };
    }

    try {
      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      if (dir && dir !== '.' && dir !== '/' && dir !== '\\') {
        await this.workspace.mkdir(dir, { recursive: true });
      }

      // Check if file exists to determine operation type
      const fileExists = await this.workspace.exists(filePath);
      const originalContent = fileExists ? await this.workspace.readFile(filePath) : undefined;

      // Build PatchRequest — routes through SafePatchExecutor (D.4 checks, validation, etc.)
      const patchRequest = {
        sessionId: 'write-file-' + Date.now(),
        operations: [{
          path: filePath,
          operation: fileExists ? 'modify' as const : 'create' as const,
          originalContent,
          newContent: content,
        }],
        reason: `Write file: ${filePath}`,
        autoCommit: false,
      };

      const result = await this.patchExecutor.execute(patchRequest);

      if (result.success) {
        return {
          toolCallId: '',
          content: `Successfully wrote to ${filePath}`,
          isError: false,
        };
      } else {
        return {
          toolCallId: '',
          content: `Failed to write file: ${result.error || 'Unknown error'}`,
          isError: true,
        };
      }
    } catch (error: any) {
      return { toolCallId: '', content: `Failed to write file: ${error.message}`, isError: true };
    }
  }
}
