import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';
import { PatchExecutor } from '../../../contracts/patch-executor';
import * as path from 'path';

export class CreateFileTool implements Tool {
  readonly name = 'create_file';
  readonly description = 'Create a new file. FAILS if the file already exists. Input: { path: string, content: string }';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the new file'
      },
      content: {
        type: 'string',
        description: 'Content for the new file'
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
      const dir = path.dirname(filePath);
      if (dir && dir !== '.' && dir !== '/' && dir !== '\\') {
        await this.workspace.mkdir(dir, { recursive: true });
      }

      // Contract from description: "FAILS if the file already exists"
      const fileExists = await this.workspace.exists(filePath);
      if (fileExists) {
        return {
          toolCallId: '',
          content: `File already exists: ${filePath}. Use write_file tool to overwrite existing files.`,
          isError: true,
        };
      }

      const patchRequest = {
        sessionId: 'create-file-' + Date.now(),
        operations: [{
          path: filePath,
          operation: 'create' as const,
          newContent: content,
        }],
        reason: `Create file: ${filePath}`,
        autoCommit: false,
      };

      const result = await this.patchExecutor.execute(patchRequest);

      if (result.success) {
        return {
          toolCallId: '',
          content: `Successfully created ${filePath}`,
          isError: false,
        };
      } else {
        return {
          toolCallId: '',
          content: `Failed to create file: ${result.error || 'Unknown error'}`,
          isError: true,
        };
      }
    } catch (error: any) {
      return { toolCallId: '', content: `Failed to create file: ${error.message}`, isError: true };
    }
  }
}
