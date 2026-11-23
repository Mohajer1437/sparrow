import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';

export class ListDirectoryTool implements Tool {
  readonly name = 'list_directory';
  readonly description = 'List IMMEDIATE entries (files and directories) in a workspace path. NON-RECURSIVE. Shows only direct children of the specified directory. Directories are shown with trailing slash (e.g., "subdir/"). Input: { path: string }';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the directory to list (use "." for workspace root)'
      }
    },
    required: ['path']
  };
  
  constructor(private readonly workspace: Workspace) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const dirPath = (input.path as string) || '.';
    
    if (typeof dirPath !== 'string') {
      return { toolCallId: '', content: 'Invalid input: path must be a string', isError: true };
    }

    try {
      const entries = await this.workspace.listEntries(dirPath);
      if (entries.length === 0) {
        return { toolCallId: '', content: '(empty directory)', isError: false };
      }
      const output = entries.join('\n');
      const summary = `Found ${entries.length} entries in "${dirPath}":\n${output}`;
      return { toolCallId: '', content: summary, isError: false };
    } catch (error: any) {
      return { toolCallId: '', content: `Failed to list directory: ${error.message}`, isError: true };
    }
  }
}
