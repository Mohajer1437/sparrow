import { TestRunner } from '../../contracts/test-runner';
import { CommandResult } from '../../domain/patch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 200_000;

export interface TestRunnerConfig {
  readonly command: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
}

/**
 * R2.6: ShellTestRunner
 *
 * Runs the configured test command (e.g., npm test) after patch.
 */
export class ShellTestRunner implements TestRunner {
  constructor(private readonly config: TestRunnerConfig) {}

  async run(changedFiles?: ReadonlyArray<string>): Promise<CommandResult> {
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = this.config.cwd ?? process.cwd();

    try {
      const { stdout, stderr } = await execAsync(this.config.command, {
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
        command: this.config.command,
      };
    } catch (error: any) {
      const timedOut = error.killed === true || error.signal === 'SIGTERM';
      return {
        passed: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        exitCode: error.code ?? 1,
        timedOut,
        command: this.config.command,
      };
    }
  }
}
