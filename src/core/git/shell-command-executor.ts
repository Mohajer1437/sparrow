import { CommandExecutor, CommandResult } from '../../contracts/command-executor';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1_000_000;

export class ShellCommandExecutor implements CommandExecutor {
  async execute(
    command: string,
    args: ReadonlyArray<string>,
    options?: {
      cwd?: string;
      timeoutMs?: number;
      env?: Readonly<Record<string, string>>;
    }
  ): Promise<CommandResult> {
    const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = options?.cwd ?? process.cwd();

    try {
      const { stdout, stderr } = await execFileAsync(command, [...args], {
        timeout,
        maxBuffer: MAX_BUFFER_BYTES,
        cwd,
        env: options?.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
        // .cmd/.bat need a shell on Windows; node.exe must not use one (cmd mishandles -e).
        shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
      });

      return {
        exitCode: 0,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: false,
      };
    } catch (error: any) {
      const timedOut = error.killed === true || error.signal === 'SIGTERM';
      const exitCode = typeof error.code === 'number' ? error.code : (error.status ?? 1);
      return {
        exitCode,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        timedOut,
      };
    }
  }
}
