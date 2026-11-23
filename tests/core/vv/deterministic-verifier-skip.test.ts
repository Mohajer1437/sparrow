import { aggregateVerificationPassed, resolveVerificationResultStatus } from '../../../src/domain/verification-check';
import { DefaultDeterministicVerifier } from '../../../src/core/vv/default-deterministic-verifier';

describe('Verification skip != pass (PHASE-09)', () => {
  it('aggregateVerificationPassed is false when checks are SKIPPED', () => {
    const checks = [
      {
        id: 'deterministic-unit-tests',
        category: 'deterministic' as const,
        name: 'Unit tests',
        passed: false,
        resultStatus: 'SKIPPED' as const,
        severity: 'LOW' as const,
        evidence: 'No files were modified; unit tests skipped',
      },
    ];
    expect(aggregateVerificationPassed(checks)).toBe(false);
    expect(resolveVerificationResultStatus(checks[0])).toBe('SKIPPED');
  });

  it('DefaultDeterministicVerifier skip emits SKIPPED not passed', async () => {
    const verifier = new DefaultDeterministicVerifier({
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    } as any);
    const checks = await verifier.verify({
      workspacePath: process.cwd(),
      profile: 'STANDARD',
      changedFiles: [],
    });
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.resultStatus).toBe('SKIPPED');
      expect(check.passed).toBe(false);
    }
    expect(aggregateVerificationPassed(checks)).toBe(false);
  });
});