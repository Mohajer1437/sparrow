import { ShellValidationEngine } from '../../../src/core/patch/shell-validation-engine';

describe('ShellValidationEngine', () => {
  const isWindows = process.platform === 'win32';

  describe('success', () => {
    it('returns success when command passes', async () => {
      const engine = new ShellValidationEngine({
        commands: [isWindows ? 'echo success' : 'echo success'],
        cwd: process.cwd(),
      });

      const result = await engine.validate();
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('success');
    });

    it('runs multiple commands in sequence', async () => {
      const engine = new ShellValidationEngine({
        commands: [
          isWindows ? 'echo one' : 'echo one',
          isWindows ? 'echo two' : 'echo two',
        ],
        cwd: process.cwd(),
      });

      const result = await engine.validate();
      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('one');
      expect(result.stdout).toContain('two');
    });

    it('returns success when no commands configured', async () => {
      const engine = new ShellValidationEngine({ commands: [] });
      const result = await engine.validate();
      expect(result.passed).toBe(true);
    });
  });

  describe('failure', () => {
    it('returns failure when command fails', async () => {
      const engine = new ShellValidationEngine({
        commands: [isWindows ? 'exit 1' : 'exit 1'],
        cwd: process.cwd(),
      });

      const result = await engine.validate();
      expect(result.passed).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('short-circuits on first failure', async () => {
      const engine = new ShellValidationEngine({
        commands: [
          isWindows ? 'exit 1' : 'exit 1',
          isWindows ? 'echo should-not-run' : 'echo should-not-run',
        ],
        cwd: process.cwd(),
      });

      const result = await engine.validate();
      expect(result.passed).toBe(false);
      expect(result.stdout).not.toContain('should-not-run');
    });
  });

  describe('timeout', () => {
    it('handles timeout gracefully', async () => {
      const engine = new ShellValidationEngine({
        commands: [isWindows ? 'ping -n 10 127.0.0.1' : 'sleep 10'],
        timeoutMs: 100,
        cwd: process.cwd(),
      });

      const result = await engine.validate();
      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(true);
    });
  });
});
