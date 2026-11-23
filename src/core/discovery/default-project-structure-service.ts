import * as fs from 'fs';
import * as path from 'path';
import { ProjectStructureService } from '../../contracts/project-structure-service';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.git', '.ai',
  '.patch-backups', 'coverage', '.nyc_output', '__pycache__',
  '.cache', 'tmp', 'temp',
]);

const MAX_DEPTH = 3;
const MAX_FILES = 150;

export class DefaultProjectStructureService implements ProjectStructureService {
  async scan(workspacePath: string): Promise<string> {
    try {
      const root = path.resolve(workspacePath);
      if (!fs.existsSync(root)) return '';

      const lines: string[] = [];
      lines.push('# Project Structure');
      lines.push('');
      lines.push('Use this tree to understand where files live in the project.');
      lines.push('When creating new files, place them in the appropriate directory.');
      lines.push('');
      lines.push('```');
      lines.push(path.basename(root) + '/');

      let fileCount = 0;
      this.walk(root, '', 0, lines, () => {
        fileCount++;
        return fileCount;
      });

      lines.push('```');

      if (fileCount >= MAX_FILES) {
        lines.push('');
        lines.push(`(tree truncated at ${MAX_FILES} files — use list_directory to explore deeper)`);
      }

      return lines.join('\n');
    } catch (err: any) {
      return '';
    }
  }

  private walk(
    dir: string,
    prefix: string,
    depth: number,
    lines: string[],
    counter: () => number,
  ): void {
    if (depth >= MAX_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (counter() >= MAX_FILES) return;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          lines.push(`${prefix}${entry.name}/ [excluded]`);
          continue;
        }
        lines.push(`${prefix}${entry.name}/`);
        this.walk(
          path.join(dir, entry.name),
          prefix + '  ',
          depth + 1,
          lines,
          counter,
        );
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const skipExts = new Set(['.lock', '.map', '.bin', '.exe', '.dll', '.so', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot']);
        if (skipExts.has(ext)) continue;

        try {
          const stats = fs.statSync(path.join(dir, entry.name));
          const sizeKb = Math.round(stats.size / 1024);
          lines.push(`${prefix}${entry.name} (${sizeKb}kb)`);
        } catch {
          lines.push(`${prefix}${entry.name}`);
        }
      }
    }
  }
}
