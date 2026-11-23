import { promises as fs } from 'fs';
import * as path from 'path';
import { DeterministicVerifier } from '../../contracts/deterministic-verifier';
import { CommandExecutor } from '../../contracts/command-executor';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';

export class DefaultDeterministicVerifier implements DeterministicVerifier {
  constructor(private readonly commandExecutor: CommandExecutor) {}

  async verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<VerificationCheck>> {
    const checks: VerificationCheck[] = [];
    const pkg = await this.readPackageJson(input.workspacePath);
    const hasTsconfig = await this.exists(path.join(input.workspacePath, 'tsconfig.json'));
    const scripts = pkg?.scripts ?? {};
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    const wantTypecheck = hasTsconfig;
    const wantTest = input.profile !== 'MVP' && typeof scripts.test === 'string';
    const wantLint = input.profile === 'PRODUCTION' && typeof scripts.lint === 'string';
    const wantBuild = input.profile === 'PRODUCTION' && typeof scripts.build === 'string';

    const noFilesChanged = input.changedFiles !== undefined && input.changedFiles.length === 0;

    if (noFilesChanged) {
      if (hasTsconfig) {
        checks.push(this.skip('deterministic-typecheck', 'Typecheck', 'No files were modified; deterministic typecheck skipped'));
      }
      if (wantTest) {
        checks.push(this.skip('deterministic-unit-tests', 'Unit tests', 'No files were modified; unit tests skipped'));
      }
      if (wantLint) {
        checks.push(this.skip('deterministic-lint', 'Lint', 'No files were modified; lint skipped'));
      }
      if (wantBuild) {
        checks.push(this.skip('deterministic-build', 'Production build', 'No files were modified; production build skipped'));
      }
      if (checks.length === 0) {
        checks.push(this.skip('deterministic-none', 'Deterministic verification', 'No files were modified; deterministic checks skipped'));
      }
      return Object.freeze(checks);
    }

    if (wantTypecheck) {
      checks.push(await this.runCheck({
        id: 'deterministic-typecheck',
        name: 'Typecheck',
        cwd: input.workspacePath,
        command: npx,
        args: ['tsc', '--noEmit', '-p', 'tsconfig.json'],
        timeoutMs: input.profile === 'PRODUCTION' ? 180000 : 120000,
        acceptanceCriterion: 'TypeScript compiler exits 0',
        severityOnFail: 'HIGH',
      }));
    } else {
      checks.push(this.skip('deterministic-typecheck', 'Typecheck', 'No tsconfig.json; typecheck skipped'));
    }

    if (wantTest) {
      checks.push(await this.runCheck({
        id: 'deterministic-unit-tests',
        name: 'Unit tests',
        cwd: input.workspacePath,
        command: npm,
        args: ['test', '--', '--watchAll=false'],
        timeoutMs: 180000,
        acceptanceCriterion: 'Test script exits 0',
        severityOnFail: 'HIGH',
      }));
    }

    if (wantLint) {
      const hasEslint = await this.hasEslintConfig(input.workspacePath);
      if (!hasEslint) {
        checks.push(Object.freeze({
          id: 'deterministic-lint',
          category: 'deterministic' as const,
          name: 'Lint',
          passed: false,
          severity: 'MEDIUM' as const,
          evidence: 'PRODUCTION lint requires a non-interactive ESLint config; none was found',
          acceptanceCriterion: 'Lint script exits 0',
        }));
      } else {
        checks.push(await this.runCheck({
          id: 'deterministic-lint',
          name: 'Lint',
          cwd: input.workspacePath,
          command: npm,
          args: ['run', 'lint'],
          timeoutMs: 120000,
          acceptanceCriterion: 'Lint script exits 0',
          severityOnFail: 'MEDIUM',
          env: { CI: 'true' },
        }));
      }
    }

    if (wantBuild) {
      checks.push(await this.runCheck({
        id: 'deterministic-build',
        name: 'Production build',
        cwd: input.workspacePath,
        command: npm,
        args: ['run', 'build'],
        timeoutMs: 240000,
        acceptanceCriterion: 'Build script exits 0',
        severityOnFail: 'CRITICAL',
      }));
    }

    if (checks.length === 0) {
      checks.push(this.skip('deterministic-none', 'Deterministic verification', 'No deterministic commands were applicable'));
    }

    return Object.freeze(checks);
  }

  private async runCheck(opts: {
    id: string;
    name: string;
    cwd: string;
    command: string;
    args: string[];
    timeoutMs: number;
    acceptanceCriterion: string;
    severityOnFail: 'MEDIUM' | 'HIGH' | 'CRITICAL';
    env?: Record<string, string>;
  }): Promise<VerificationCheck> {
    const result = await this.commandExecutor.execute(opts.command, opts.args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      env: opts.env,
    });
    const output = (result.stdout + '\n' + result.stderr).trim().slice(0, 4000);
    const passed = result.exitCode === 0 && !result.timedOut;
    return Object.freeze({
      id: opts.id,
      category: 'deterministic' as const,
      name: opts.name,
      passed,
      resultStatus: passed ? ('PASSED' as const) : ('FAILED' as const),
      severity: passed ? 'LOW' as const : opts.severityOnFail,
      evidence: passed
        ? opts.name + ' passed (exit ' + result.exitCode + ')'
        : opts.name + ' failed (exit ' + result.exitCode + ', timedOut=' + result.timedOut + '): ' + (output || 'no output'),
      acceptanceCriterion: opts.acceptanceCriterion,
    });
  }

  private skip(id: string, name: string, evidence: string): VerificationCheck {
    // PHASE-09: SKIPPED != PASSED. Skip must not make verification.passed=true.
    return Object.freeze({
      id,
      category: 'deterministic' as const,
      name,
      passed: false,
      resultStatus: 'SKIPPED' as const,
      severity: 'LOW' as const,
      evidence,
    });
  }

  private async readPackageJson(workspacePath: string): Promise<{ scripts?: Record<string, string> } | null> {
    try {
      const raw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async hasEslintConfig(workspacePath: string): Promise<boolean> {
    const names = [
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
    ];
    for (const name of names) {
      if (await this.exists(path.join(workspacePath, name))) {
        return true;
      }
    }
    const pkg = await this.readPackageJson(workspacePath);
    return Boolean((pkg as { eslintConfig?: unknown } | null)?.eslintConfig);
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
