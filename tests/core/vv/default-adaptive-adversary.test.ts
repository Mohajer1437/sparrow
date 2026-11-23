import { DefaultAdaptiveAdversary } from '../../../src/core/vv/default-adaptive-adversary';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('DefaultAdaptiveAdversary', () => {
  const adversary = new DefaultAdaptiveAdversary();

  it('does not emit checks for MVP', async () => {
    const checks = await adversary.generate({
      workspacePath: '/tmp',
      profile: 'MVP',
      priorChecks: [],
    });
    expect(checks).toEqual([]);
  });

  it('does not auto-fail PRODUCTION XSS just because a filename matches form', async () => {
    const checks = await adversary.generate({
      workspacePath: '/tmp',
      profile: 'PRODUCTION',
      changedFiles: ['src/login-form.tsx'],
      priorChecks: [],
    });
    expect(checks.some(c => c.id === 'adversarial-xss-payload' && !c.passed)).toBe(false);
  });

  it('records residual PRODUCTION API adversarial evidence without auto-failing', async () => {
    const prior: VerificationCheck[] = [{
      id: 'api-runtime',
      category: 'api',
      name: 'API runtime',
      passed: false,
      severity: 'HIGH',
      evidence: 'unreachable',
    }];
    const checks = await adversary.generate({
      workspacePath: '/tmp',
      profile: 'PRODUCTION',
      priorChecks: prior,
    });
    const unauth = checks.find(c => c.id === 'adversarial-api-unauthenticated');
    expect(unauth?.passed).toBe(true);
    expect(unauth?.evidence).toMatch(/not an auto-fail/i);
  });
});
