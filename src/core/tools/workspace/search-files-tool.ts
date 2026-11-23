import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.ai', 'dist', 'build', '.next', '.patch-backups']);

export class SearchFilesTool implements Tool {
  readonly name = 'search_files';
  readonly description = 'Search file names recursively in the workspace. Case-insensitive regex match. Returns relative paths, sorted alphabetically.';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to match file names (case-insensitive)'
      }
    },
    required: ['pattern']
  };

  constructor(private readonly workspace: Workspace) {}

  async execute(input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    if (!pattern || typeof pattern !== 'string') {
      return { toolCallId: '', content: 'Invalid input: pattern must be a non-empty string', isError: true };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (e: any) {
      return { toolCallId: '', content: `Invalid regex pattern: ${e.message}`, isError: true };
    }

    const matches: string[] = [];
    await this.walk('.', regex, matches);
    matches.sort();

    if (matches.length === 0) {
      return { toolCallId: '', content: '(no matches found)', isError: false };
    }
    return { toolCallId: '', content: matches.join('\n'), isError: false };
  }

  private async walk(dir: string, regex: RegExp, matches: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await this.workspace.listFiles(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const fullPath = dir === '.' ? entry : `${dir}/${entry}`;

      let isDir = false;
      try {
        isDir = await this.workspace.isDirectory(fullPath);
      } catch {
        continue;
      }

      if (isDir) {
        if (IGNORED_DIRS.has(entry)) continue;
        await this.walk(fullPath, regex, matches);
      } else {
        if (regex.test(entry) || regex.test(fullPath)) {
          matches.push(fullPath);
        }
      }
    }
  }
}
