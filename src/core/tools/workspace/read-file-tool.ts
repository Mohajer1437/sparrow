import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly description = 'Read the contents of a file from the workspace. Returns the file content as UTF-8 text.';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file to read'
      }
    },
    required: ['path']
  };
  
  constructor(private readonly workspace: Workspace) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const path = input.path as string;
    if (!path || typeof path !== 'string') {
      return { toolCallId: '', content: 'Invalid input: path must be a string', isError: true };
    }
    try {
      const content = await this.workspace.readFile(path);
      return { toolCallId: '', content, isError: false };
    } catch (error: any) {
      const msg = error.message || String(error);
      if (msg.includes('ENOENT') || msg.includes('no such file') || msg.includes('not found')) {
        return {
          toolCallId: '',
          content: `TARGET_NOT_FOUND: File not found in active workspace: ${path}`,
          isError: true,
        };
      }
      return { toolCallId: '', content: `Failed to read file: ${msg}`, isError: true };
    }
  }
}
