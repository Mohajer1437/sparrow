import { DeterministicRegressionSelector } from '../../../src/core/impact-analysis/deterministic-regression-selector';
import { ImpactAnalysis } from '../../../src/domain/impact-analysis';

describe('DeterministicRegressionSelector', () => {
  let selector: DeterministicRegressionSelector;

  beforeEach(() => {
    selector = new DeterministicRegressionSelector();
  });

  it('selects minimal direct checks for LOW risk change and skips indirect regression', async () => {
    const impact: ImpactAnalysis = {
      changedFiles: ['src/utils/math.ts'],
      directlyAffected: ['src/utils/math.ts'],
      indirectlyAffected: ['src/users/service.ts'],
      affectedEndpoints: ['GET /api/users'],
      affectedTests: ['tests/users/service.test.ts'],
      affectedModules: [],
      affectedDomains: ['backend'],
      relations: [],
      unknowns: [],
      confidence: 'CONFIRMED',
      limitsReached: false,
      summary: 'CONFIRMED math.ts',
      generatedAt: new Date().toISOString(),
    };

    const plan = await selector.selectRegression({
      impactAnalysis: impact,
      changedFiles: ['src/utils/math.ts'],
      risk: 'LOW',
    });

    expect(plan.risk).toBe('LOW');
    expect(plan.policy).toBe('LOW_RISK_DETERMINISTIC_POLICY');
    expect(plan.directChecks).toContain('typecheck');
    expect(plan.directChecks).toContain('lint');
    // Indirect tests should be skipped in LOW risk
    expect(plan.selectedChecks).not.toContain('test:tests/users/service.test.ts');
    expect(plan.skippedChecks.some(s => s.check === 'test:tests/users/service.test.ts')).toBe(true);
  });

  it('expands to affected tests and endpoints for MEDIUM risk change', async () => {
    const impact: ImpactAnalysis = {
      changedFiles: ['src/users/service.ts'],
      directlyAffected: ['src/users/service.ts'],
      indirectlyAffected: ['src/users/controller.ts'],
      affectedEndpoints: ['GET /api/users'],
      affectedTests: ['tests/users/service.test.ts'],
      affectedModules: [],
      affectedDomains: ['backend'],
      relations: [],
      unknowns: [],
      confidence: 'CONFIRMED',
      limitsReached: false,
      summary: 'CONFIRMED service.ts',
      generatedAt: new Date().toISOString(),
    };

    const plan = await selector.selectRegression({
      impactAnalysis: impact,
      changedFiles: ['src/users/service.ts'],
      risk: 'MEDIUM',
    });

    expect(plan.risk).toBe('MEDIUM');
    expect(plan.policy).toBe('MEDIUM_RISK_DETERMINISTIC_POLICY');
    expect(plan.selectedChecks).toContain('test:tests/users/service.test.ts');
    expect(plan.selectedChecks).toContain('endpoint:GET /api/users');
  });

  it('elevates verification for security-sensitive auth changes', async () => {
    const impact: ImpactAnalysis = {
      changedFiles: ['src/auth/jwt-guard.ts'],
      directlyAffected: ['src/auth/jwt-guard.ts'],
      indirectlyAffected: ['src/auth/auth.service.ts'],
      affectedEndpoints: ['POST /api/auth/login'],
      affectedTests: ['tests/auth/guard.test.ts'],
      affectedModules: [],
      affectedDomains: ['auth', 'backend'],
      relations: [],
      unknowns: [],
      confidence: 'CONFIRMED',
      limitsReached: false,
      summary: 'CONFIRMED jwt-guard.ts',
      generatedAt: new Date().toISOString(),
    };

    const plan = await selector.selectRegression({
      impactAnalysis: impact,
      changedFiles: ['src/auth/jwt-guard.ts'],
      risk: 'MEDIUM',
    });

    expect(plan.policy).toBe('SECURITY_SENSITIVE_EXPANSION_POLICY');
    expect(plan.selectedChecks).toContain('auth_verification');
    expect(plan.selectedChecks).toContain('authorization_verification');
  });

  it('applies conservative fallback baseline when impact is UNKNOWN', async () => {
    const plan = await selector.selectRegression({
      impactAnalysis: null,
      changedFiles: ['src/unindexed-component.tsx'],
      risk: 'LOW',
    });

    expect(plan.policy).toBe('CONSERVATIVE_UNKNOWN_IMPACT_POLICY');
    expect(plan.directChecks).toContain('build');
    expect(plan.selectedChecks).toContain('build');
    expect(plan.reasons.some(r => r.includes('FALLBACK'))).toBe(true);
  });

  it('produces strictly deterministic output given identical inputs', async () => {
    const impact: ImpactAnalysis = {
      changedFiles: ['src/b.ts', 'src/a.ts'],
      directlyAffected: ['src/b.ts', 'src/a.ts'],
      indirectlyAffected: ['src/d.ts', 'src/c.ts'],
      affectedEndpoints: ['GET /api/z', 'GET /api/a'],
      affectedTests: ['tests/b.test.ts', 'tests/a.test.ts'],
      affectedModules: [],
      affectedDomains: ['backend'],
      relations: [],
      unknowns: [],
      confidence: 'CONFIRMED',
      limitsReached: false,
      summary: 'Determinism check',
      generatedAt: '2026-08-28T00:00:00Z',
    };

    const plan1 = await selector.selectRegression({ impactAnalysis: impact, changedFiles: ['src/b.ts', 'src/a.ts'], risk: 'MEDIUM' });
    const plan2 = await selector.selectRegression({ impactAnalysis: impact, changedFiles: ['src/b.ts', 'src/a.ts'], risk: 'MEDIUM' });

    expect(plan1.selectedChecks).toEqual(plan2.selectedChecks);
    expect(plan1.affectedArtifacts).toEqual(plan2.affectedArtifacts);
    expect(plan1.verifiedArtifacts).toEqual(plan2.verifiedArtifacts);
    expect(plan1.unverifiedArtifacts).toEqual(plan2.unverifiedArtifacts);
  });
});
