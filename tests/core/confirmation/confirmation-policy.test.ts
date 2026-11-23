import { ConfirmationPolicy } from '../../../src/core/confirmation/confirmation-policy';

describe('Confirmation Policy (R5.6, R5.7, R5.8, R5.9)', () => {
  const policy = new ConfirmationPolicy();

  it('classifies normal low-risk operations as ALLOW', () => {
    const res = policy.evaluate({
      type: 'CONFIRMATION_REQUIRED',
      risk: 'LOW',
      affectedFiles: ['src/components/Button.tsx'],
      proposedOperations: ['MODIFY'],
    });

    expect(res.layer).toBe('ALLOW');
    expect(res.canBeConfirmed).toBe(true);
  });

  it('classifies confirmable conditions as CONFIRMABLE', () => {
    // 1. HIGH_RISK_CHANGE
    expect(policy.evaluate({
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      affectedFiles: ['package.json'],
    }).layer).toBe('CONFIRMABLE');

    // 2. DESTRUCTIVE_REPAIR
    expect(policy.evaluate({
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      affectedFiles: ['app/page.tsx'],
    }).layer).toBe('CONFIRMABLE');

    // 3. AMBIGUOUS_SCOPE
    expect(policy.evaluate({
      type: 'AMBIGUOUS_SCOPE',
      risk: 'MEDIUM',
    }).layer).toBe('CONFIRMABLE');

    // 4. UNKNOWN_INTENT
    expect(policy.evaluate({
      type: 'UNKNOWN_INTENT',
      risk: 'HIGH',
    }).layer).toBe('CONFIRMABLE');

    // 5. REQUIRES_TEST_CREDENTIAL
    expect(policy.evaluate({
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
    }).layer).toBe('CONFIRMABLE');
  });

  it('enforces HARD_BLOCK for READ_ONLY mutation attempts (R5.8)', () => {
    const res = policy.evaluate({
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      executionMode: 'READ_ONLY',
      proposedOperations: ['MODIFY'],
      affectedFiles: ['app/page.tsx'],
    });

    expect(res.layer).toBe('HARD_BLOCK');
    expect(res.canBeConfirmed).toBe(false);
    expect(res.reason).toContain('READ_ONLY');
  });

  it('enforces HARD_BLOCK for workspace path traversal (R5.8)', () => {
    const res = policy.evaluate({
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      affectedFiles: ['../../etc/passwd'],
    });

    expect(res.layer).toBe('HARD_BLOCK');
    expect(res.canBeConfirmed).toBe(false);
    expect(res.reason).toContain('traversal');
  });

  it('enforces HARD_BLOCK for production environments (R5.8)', () => {
    const res = policy.evaluate({
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
      environment: 'production',
    });

    expect(res.layer).toBe('HARD_BLOCK');
    expect(res.canBeConfirmed).toBe(false);
  });

  it('enforces HARD_BLOCK for verification harness bypass (R5.8)', () => {
    const res = policy.evaluate({
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      modifiesVerificationHarness: true,
    });

    expect(res.layer).toBe('HARD_BLOCK');
    expect(res.canBeConfirmed).toBe(false);
  });
});
