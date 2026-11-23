import {
  DEFAULT_IMPACT_LIMITS,
  freezeImpactAnalysis,
  freezeImpactRelation,
  formatImpactAnalysisSummary,
  ImpactAnalysis,
  ImpactRelation,
} from '../../../src/domain/impact-analysis';

describe('Impact Model & Contracts', () => {
  it('creates and freezes a valid confirmed impact relation', () => {
    const relation: ImpactRelation = {
      source: 'app/login/page.tsx',
      target: 'components/LoginForm.tsx',
      relationType: 'imports',
      confidence: 'CONFIRMED',
      evidenceRef: 'app/login/page.tsx imports ./LoginForm',
      reason: 'Direct import in source file',
    };

    const frozen = freezeImpactRelation(relation);
    expect(frozen.source).toBe('app/login/page.tsx');
    expect(frozen.target).toBe('components/LoginForm.tsx');
    expect(frozen.relationType).toBe('imports');
    expect(frozen.confidence).toBe('CONFIRMED');
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('creates and freezes an ImpactAnalysis with all required fields', () => {
    const analysis: ImpactAnalysis = {
      changedFiles: ['src/auth/guard.ts'],
      directlyAffected: ['src/auth/guard.ts'],
      indirectlyAffected: ['src/users/controller.ts'],
      affectedEndpoints: ['GET /api/users'],
      affectedTests: ['tests/auth/guard.test.ts'],
      affectedModules: ['Auth', 'Users'],
      affectedDomains: ['auth', 'backend'],
      relations: [
        {
          source: 'src/users/controller.ts',
          target: 'src/auth/guard.ts',
          relationType: 'imported_by',
          confidence: 'CONFIRMED',
          evidenceRef: 'src/users/controller.ts imports ./guard',
          reason: 'Controller uses guard',
        },
      ],
      unknowns: [],
      confidence: 'CONFIRMED',
      limitsReached: false,
      summary: 'CONFIRMED impact for guard.ts',
      generatedAt: '2026-08-28T12:00:00Z',
    };

    const frozen = freezeImpactAnalysis(analysis);
    expect(frozen.confidence).toBe('CONFIRMED');
    expect(frozen.directlyAffected).toEqual(['src/auth/guard.ts']);
    expect(frozen.indirectlyAffected).toEqual(['src/users/controller.ts']);
    expect(frozen.affectedEndpoints).toEqual(['GET /api/users']);
    expect(frozen.affectedTests).toEqual(['tests/auth/guard.test.ts']);
    expect(frozen.relations).toHaveLength(1);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.relations)).toBe(true);
    expect(Object.isFrozen(frozen.relations[0])).toBe(true);
  });

  it('formats impact analysis summary correctly', () => {
    const analysis: ImpactAnalysis = {
      changedFiles: ['a.ts'],
      directlyAffected: ['a.ts'],
      indirectlyAffected: ['b.ts', 'c.ts'],
      affectedEndpoints: ['GET /api/test'],
      affectedTests: ['tests/a.test.ts'],
      affectedModules: ['Core'],
      affectedDomains: ['backend'],
      relations: [],
      unknowns: ['No graph data for external lib'],
      confidence: 'CONFIRMED',
      limitsReached: true,
      summary: 'Test summary',
      generatedAt: '2026-08-28T12:00:00Z',
    };

    const formatted = formatImpactAnalysisSummary(analysis);
    expect(formatted).toContain('confidence=CONFIRMED');
    expect(formatted).toContain('changed=1');
    expect(formatted).toContain('direct=1');
    expect(formatted).toContain('indirect=2');
    expect(formatted).toContain('endpoints=1');
    expect(formatted).toContain('tests=1');
    expect(formatted).toContain('unknowns=1');
    expect(formatted).toContain('LIMIT_REACHED');
  });

  it('exposes default limits as frozen immutable configuration', () => {
    expect(DEFAULT_IMPACT_LIMITS.maxImpactNodes).toBe(50);
    expect(DEFAULT_IMPACT_LIMITS.maxImpactDepth).toBe(4);
    expect(DEFAULT_IMPACT_LIMITS.maxRelations).toBe(100);
    expect(DEFAULT_IMPACT_LIMITS.maxAffectedTests).toBe(20);
    expect(DEFAULT_IMPACT_LIMITS.maxAffectedEndpoints).toBe(20);
    expect(Object.isFrozen(DEFAULT_IMPACT_LIMITS)).toBe(true);
  });
});
