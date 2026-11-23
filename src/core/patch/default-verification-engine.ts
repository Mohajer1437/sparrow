import { exec } from 'child_process';
import { promisify } from 'util';
import { VerificationEngine, VerificationResult, VerificationCheck } from '../../contracts/verification-engine';

const execAsync = promisify(exec);

export class DefaultVerificationEngine implements VerificationEngine {
  async verify(workspacePath: string): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const errors: string[] = [];
    const timestamp = new Date().toISOString();

    const tsCheck = await this.verifyTypeScript(workspacePath);
    checks.push(tsCheck);
    if (!tsCheck.passed && tsCheck.message) {
      errors.push(`TypeScript: ${tsCheck.message}`);
    }

    const testCheck = await this.verifyTests(workspacePath);
    checks.push(testCheck);
    if (!testCheck.passed && testCheck.message) {
      errors.push(`Tests: ${testCheck.message}`);
    }

    const lintCheck = await this.verifyLint(workspacePath);
    checks.push(lintCheck);
    if (!lintCheck.passed && lintCheck.message && !lintCheck.message.includes('not configured')) {
      errors.push(`Lint: ${lintCheck.message}`);
    }

    const success = checks.every(c => c.passed || c.message?.includes('not configured'));

    return { success, checks, errors, timestamp };
  }

  private async verifyTypeScript(workspacePath: string): Promise<VerificationCheck> {
    const start = Date.now();
    try {
      await execAsync('npx tsc --noEmit', { cwd: workspacePath, timeout: 60000 });
      return {
        name: 'TypeScript Compilation',
        passed: true,
        message: 'Compilation successful',
        duration: Date.now() - start
      };
    } catch (error: any) {
      return {
        name: 'TypeScript Compilation',
        passed: false,
        message: error.stderr || error.stdout || error.message,
        duration: Date.now() - start
      };
    }
  }

  private async verifyTests(workspacePath: string): Promise<VerificationCheck> {
    const start = Date.now();
    try {
      await execAsync('npm test', { cwd: workspacePath, timeout: 120000 });
      return {
        name: 'Test Suite',
        passed: true,
        message: 'All tests passed',
        duration: Date.now() - start
      };
    } catch (error: any) {
      return {
        name: 'Test Suite',
        passed: false,
        message: error.stderr || error.stdout || error.message,
        duration: Date.now() - start
      };
    }
  }

  private async verifyLint(workspacePath: string): Promise<VerificationCheck> {
    const start = Date.now();
    try {
      await execAsync('npm run lint', { cwd: workspacePath, timeout: 60000 });
      return {
        name: 'Linting',
        passed: true,
        message: 'No lint errors',
        duration: Date.now() - start
      };
    } catch (error: any) {
      if (error.message && error.message.includes('Missing script')) {
        return {
          name: 'Linting',
          passed: true,
          message: 'Lint script not configured (skipped)',
          duration: Date.now() - start
        };
      }
      return {
        name: 'Linting',
        passed: false,
        message: error.stderr || error.stdout || error.message,
        duration: Date.now() - start
      };
    }
  }
}
