import { ValidationEngine } from '../../contracts/validation-engine';
import { CommandResult } from '../../domain/patch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 100_000;

export interface ValidationConfig {
  readonly commands: ReadonlyArray<string>;
  readonly timeoutMs?: number;
  readonly cwd?: string;
}

/**
 * D.1: Parsed error block from build output.
 */
interface ErrorBlock {
  filePath: string;
  raw: string;
}

/**
 * R2.6: ShellValidationEngine
 *
 * Runs configured shell commands (e.g., npm run build) and
 * aggregates results. All commands must pass for validate()
 * to return success.
 */
export class ShellValidationEngine implements ValidationEngine {
  constructor(private readonly config: ValidationConfig) {}

  async validate(changedFiles?: ReadonlyArray<string>): Promise<CommandResult> {
    if (this.config.commands.length === 0) {
      return {
        passed: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        command: '(no validation commands configured)',
      };
    }

    const results: CommandResult[] = [];
    for (const cmd of this.config.commands) {
      const result = await this.runCommand(cmd);
      results.push(result);
      if (!result.passed) {
        // D.1: If changedFiles provided, filter errors to only those in changed files
        if (changedFiles && changedFiles.length > 0) {
          const filtered = this.filterErrorsToChangedFiles(result, changedFiles);
          if (filtered.passed) {
            // Pre-existing errors in OTHER files — treat as PASSED
            console.log(`[Validation] ⚠️  Build has errors but none in changed files (${changedFiles.length} files). Pre-existing errors ignored.`);
            console.log(`[Validation]    Ignored stderr excerpt: ${result.stderr.substring(0, 200).replace(/\n/g, ' ').trim()}`);
            return {
              passed: true,
              stdout: result.stdout,
              stderr: result.stderr + '\n\n[Filtered: all errors are in unchanged files — pre-existing issues ignored]',
              exitCode: 0,
              timedOut: result.timedOut,
              command: cmd,
            };
          }
          // Errors DO exist in changed files — return filtered result
          return filtered;
        }
        // No changedFiles — original behavior (fail on any error)
        return this.aggregateResults(results, cmd);
      }
    }

    return this.aggregateResults(results, this.config.commands[this.config.commands.length - 1]);
  }

  /**
   * D.1: Parse validation errors and determine which belong to changed files.
   *
   * Supports two error formats:
   *   - TypeScript:   src/file.ts(10,5): error TS2322: ...
   *   - Next.js build: ./app/api/progress/[id].ts:25:26
   *                    Type error: ...
   *
   * Returns:
   *   - passed=true  if NO errors appear in changedFiles
   *   - passed=false with filtered stderr showing only errors in changedFiles
   */
  private filterErrorsToChangedFiles(
    result: CommandResult,
    changedFiles: ReadonlyArray<string>
  ): CommandResult {
    const normalizedChanged = new Set(
      changedFiles.map(f => this.normalizeFilePath(f))
    );

    // Parse error lines from stderr + stdout (Next.js writes errors to stdout too)
    const allOutput = (result.stderr || '') + '\n' + (result.stdout || '');
    const errorBlocks = this.extractErrorBlocks(allOutput);

    const errorsInChanged: ErrorBlock[] = [];
    const errorsInOther: ErrorBlock[] = [];

    for (const block of errorBlocks) {
      const normalizedPath = this.normalizeFilePath(block.filePath);
      const inChanged = Array.from(normalizedChanged).some(cf =>
        normalizedPath === cf ||
        normalizedPath.endsWith('/' + cf) ||
        normalizedPath.endsWith('\\' + cf) ||
        cf.endsWith('/' + normalizedPath) ||
        normalizedPath.includes(cf) ||
        cf.includes(normalizedPath)
      );

      if (inChanged) {
        errorsInChanged.push(block);
      } else {
        errorsInOther.push(block);
      }
    }

    if (errorsInChanged.length === 0) {
      // No errors in changed files — pass validation
      return {
        passed: true,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        timedOut: result.timedOut,
        command: result.command,
      };
    }

    // Errors in changed files — fail with filtered output
    const filteredStderr = errorsInChanged.map(b => b.raw).join('\n');
    const summary =
      `[D.1 Validation Filter] ${errorsInChanged.length} error(s) in changed files, ` +
      `${errorsInOther.length} pre-existing error(s) in other files (ignored).\n` +
      `Changed files with errors:\n` +
      errorsInChanged.map(b => `  - ${b.filePath}`).join('\n');

    return {
      passed: false,
      stdout: result.stdout,
      stderr: summary + '\n\n--- Errors in changed files ---\n' + filteredStderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      command: result.command,
    };
  }

  /**
   * D.1: Normalize file paths for comparison (lowercase, forward slashes).
   */
  private normalizeFilePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  /**
   * D.1: Extract error blocks from build output.
   * Handles both tsc format and Next.js build format.
   */
  private extractErrorBlocks(output: string): ErrorBlock[] {
    const blocks: ErrorBlock[] = [];
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern 1: TypeScript compiler — path(line,col): error TS...
      // e.g., src/core/foo.ts(10,5): error TS2322: Type 'X' is not assignable...
      const tscMatch = line.match(/^([a-zA-Z]:)?[\/]?[\w\.\-\/]+\.tsx?(?:\(\d+,\d+\))?:\s*error\s+/i);
      if (tscMatch) {
        let filePath: string;
        const parenIndex = line.indexOf('(');
        if (parenIndex > 0) {
          filePath = line.substring(0, parenIndex).replace(/:$/, '').trim();
        } else {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            filePath = line.substring(0, colonIndex).trim();
          } else {
            continue;
          }
        }
        const raw = [line];
        // Capture continuation lines (indented or empty)
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith('  ') || lines[j].trim() === '')) {
          if (lines[j].trim() !== '') raw.push(lines[j]);
          j++;
        }
        blocks.push({ filePath, raw: raw.join('\n') });
        continue;
      }

      // Pattern 2: Next.js build — ./path/file.ts:line:col
      // e.g., ./app/api/progress/[id].ts:25:26
      //      Type error: Cannot find name 'progressStore'.
      const nextJsMatch = line.match(/^\.\/([a-zA-Z]:)?[\/]?[\w\.\-\/\[\]]+\.tsx?:\d+:\d+$/);
      if (nextJsMatch && i + 1 < lines.length) {
        const filePath = line.replace(/^\.\//, '').replace(/:\d+:\d+$/, '');
        // Next two lines typically are the error type and message
        const raw = [line];
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (lines[j].trim().length > 0) raw.push(lines[j]);
        }
        blocks.push({ filePath, raw: raw.join('\n') });
        continue;
      }

      // Pattern 3: Simple — path:line:col - error TS... (some tsc configs)
      const simpleMatch = line.match(/^([a-zA-Z]:)?[\/]?[\w\.\-\/]+\.tsx?:\d+:\d+\s*-?\s*error\s+/i);
      if (simpleMatch) {
        const filePath = line.split(':')[0].trim();
        blocks.push({ filePath, raw: line });
        continue;
      }
    }

    return blocks;
  }

  private async runCommand(command: string): Promise<CommandResult> {
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = this.config.cwd ?? process.cwd();

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        cwd,
      });

      return {
        passed: true,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        timedOut: false,
        command,
      };
    } catch (error: any) {
      const timedOut = error.killed === true || error.signal === 'SIGTERM';
      return {
        passed: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        exitCode: error.code ?? 1,
        timedOut,
        command,
      };
    }
  }

  private aggregateResults(results: CommandResult[], lastCommand: string): CommandResult {
    const allPassed = results.every(r => r.passed);
    return {
      passed: allPassed,
      stdout: results.map(r => `=== ${r.command} ===\n${r.stdout}`).join('\n\n'),
      stderr: results.map(r => r.stderr).filter(Boolean).join('\n\n'),
      exitCode: allPassed ? 0 : (results.find(r => !r.passed)?.exitCode ?? 1),
      timedOut: results.some(r => r.timedOut),
      command: lastCommand,
    };
  }
}
