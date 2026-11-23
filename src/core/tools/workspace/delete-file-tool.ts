import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';

export class DeleteFileTool implements Tool {
  readonly name = 'delete_file';
  readonly description = 'Delete a file from the workspace. Does not delete directories.';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file to delete'
      }
    },
    required: ['path']
  };
  
  constructor(private readonly workspace: Workspace) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const filePath = input.path as string;
    
    if (!filePath || typeof filePath !== 'string') {
      return { toolCallId: '', content: 'Invalid input: path must be a string', isError: true };
    }

    try {
      await this.workspace.deleteFile(filePath);
      return { toolCallId: '', content: `Successfully deleted ${filePath}`, isError: false };
    } catch (error: any) {
      const msg = error.message || '';
      const code = error.code || '';
      
      if (code === 'EISDIR' || msg.toLowerCase().includes('directory')) {
        return { toolCallId: '', content: `Cannot delete directory: ${filePath}`, isError: true };
      }
      if (code === 'ENOENT' || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('enoent')) {
        return { toolCallId: '', content: `File not found: ${filePath}`, isError: true };
      }
      
      return { toolCallId: '', content: `Failed to delete file: ${msg}`, isError: true };
    }
  }
}
