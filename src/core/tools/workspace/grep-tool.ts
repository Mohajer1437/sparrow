import { Tool, ToolResult } from '../../../domain/tool';
import { Workspace } from '../../../contracts/workspace';
import * as path from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.ai', 'dist', 'build', '.next', '.patch-backups']);
const MAX_LINE_LENGTH = 300;

export class GrepTool implements Tool {
  readonly name = 'grep';
  readonly description = 'Search text inside project files recursively. Case-sensitive regex. Output format: "path:line_number:line_content". Skips binary and unreadable files.';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for in file contents (case-sensitive)'
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
      regex = new RegExp(pattern);
    } catch (e: any) {
      return { toolCallId: '', content: `Invalid regex pattern: ${e.message}`, isError: true };
    }

    const files: string[] = [];
    await this.collectFiles('.', files);
    files.sort();

    if (files.length === 0) {
      return { toolCallId: '', content: '(no files found in workspace)', isError: false };
    }

    const results: string[] = [];

    for (const file of files) {
      let content: string;
      try {
        content = await this.workspace.readFile(file);
      } catch (e: any) {
        continue;
      }

      if (this.isBinary(content)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          const display = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line;
          results.push(`${file}:${i + 1}:${display}`);
        }
      }
    }

    if (results.length === 0) {
      return { toolCallId: '', content: `(no matches found for pattern: ${pattern})`, isError: false };
    }
    return { toolCallId: '', content: results.join('\n'), isError: false };
  }

  private async collectFiles(dir: string, files: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await this.workspace.listFiles(dir);
    } catch (e: any) {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      // Use path.join for OS-aware path construction (backslash on Windows, forward on Unix)
      const fullPath = dir === '.' ? entry : path.join(dir, entry);

      let isDir = false;
      try {
        isDir = await this.workspace.isDirectory(fullPath);
      } catch (e: any) {
        continue;
      }

      if (isDir) {
        if (IGNORED_DIRS.has(entry)) continue;
        await this.collectFiles(fullPath, files);
      } else {
        files.push(fullPath);
      }
    }
  }

  private isBinary(content: string): boolean {
    const sample = content.substring(0, 8192);
    return sample.includes('\0');
  }
}
