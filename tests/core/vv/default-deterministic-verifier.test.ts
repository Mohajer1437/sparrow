import { DefaultDeterministicVerifier } from '../../../src/core/vv/default-deterministic-verifier';
import { CommandExecutor, CommandResult } from '../../../src/contracts/command-executor';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

class FakeExecutor implements CommandExecutor {
  readonly calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  constructor(private readonly result: CommandResult) {}
  async execute(command: string, args: ReadonlyArray<string>): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.result;
  }
}

describe('DefaultDeterministicVerifier', () => {
  it('runs typecheck when tsconfig exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-det-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest', build: 'tsc' } }));
    const executor = new FakeExecutor({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });
    const verifier = new DefaultDeterministicVerifier(executor);
    const checks = await verifier.verify({ workspacePath: dir, profile: 'STANDARD' });
    expect(checks.some(c => c.id === 'deterministic-typecheck' && c.passed)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails PRODUCTION build when the command fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-det-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest', lint: 'eslint .', build: 'tsc' } }));
    const executor = new FakeExecutor({ exitCode: 1, stdout: '', stderr: 'build failed', timedOut: false });
    const verifier = new DefaultDeterministicVerifier(executor);
    const checks = await verifier.verify({ workspacePath: dir, profile: 'PRODUCTION' });
    expect(checks.some(c => c.id === 'deterministic-build' && c.passed === false)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails PRODUCTION lint when ESLint is not configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-det-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest', lint: 'next lint', build: 'tsc' } }));
    const executor = new FakeExecutor({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });
    const verifier = new DefaultDeterministicVerifier(executor);
    const checks = await verifier.verify({ workspacePath: dir, profile: 'PRODUCTION' });
    expect(checks.some(c => c.id === 'deterministic-lint' && c.passed === false)).toBe(true);
    expect(executor.calls.some(c => c.args.includes('lint'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
