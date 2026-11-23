import { DefaultQualityPolicy } from '../../../src/core/vv/default-quality-policy';

describe('DefaultQualityPolicy', () => {
  it('gives MVP, STANDARD, and PRODUCTION different enforcement', () => {
    const mvp = new DefaultQualityPolicy('MVP');
    const standard = new DefaultQualityPolicy('STANDARD');
    const production = new DefaultQualityPolicy('PRODUCTION');
    expect(mvp.requiresPrePlanningValidation).toBe(false);
    expect(standard.requiresPrePlanningValidation).toBe(true);
    expect(production.requiresPrePlanningValidation).toBe(true);
    expect(mvp.maxRepairAttempts).toBe(1);
    expect(standard.maxRepairAttempts).toBe(2);
    expect(production.maxRepairAttempts).toBe(3);
    expect(mvp.requiresBrowserVerification).toBe(false);
    expect(standard.requiresBrowserVerification).toBe(true);
    expect(production.failOnMissingBrowserTooling).toBe(true);
    expect(standard.failOnMissingBrowserTooling).toBe(false);
    expect(standard.requiresAdversarialTesting).toBe(false);
    expect(production.requiresAdversarialTesting).toBe(true);
    expect(mvp.requiresApiVerification).toBe(false);
    expect(standard.requiresApiVerification).toBe(true);
    expect(mvp.requiresRegressionReplay).toBe(false);
    expect(standard.requiresRegressionReplay).toBe(false);
    expect(production.requiresRegressionReplay).toBe(true);
  });
});
