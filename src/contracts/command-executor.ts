export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandExecutor {
  execute(
    command: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly cwd?: string;
      readonly timeoutMs?: number;
      readonly env?: Readonly<Record<string, string>>;
    }
  ): Promise<CommandResult>;
}
