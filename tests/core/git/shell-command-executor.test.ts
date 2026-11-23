import { ShellCommandExecutor } from '../../../src/core/git/shell-command-executor';

describe('ShellCommandExecutor', () => {
  it('runs node without spawn EINVAL', async () => {
    const executor = new ShellCommandExecutor();
    const result = await executor.execute(process.execPath, ['-e', 'process.stdout.write("ok")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ok');
    expect(result.stderr).not.toMatch(/EINVAL/);
  });

  it('runs npm.cmd on Windows without spawn EINVAL', async () => {
    if (process.platform !== 'win32') {
      return;
    }
    const executor = new ShellCommandExecutor();
    const result = await executor.execute('npm.cmd', ['--version']);
    expect(result.stderr).not.toMatch(/EINVAL/);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});
