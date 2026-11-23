import { DefaultVerificationStrategyEngine } from '../../../src/core/verification/default-verification-strategy-engine';

describe('DefaultVerificationStrategyEngine', () => {
  let engine: DefaultVerificationStrategyEngine;

  beforeEach(() => {
    engine = new DefaultVerificationStrategyEngine();
  });

  it('applies RULE_01: TypeScript changed -> TypeCheck', async () => {
    const strategy = await engine.generate(null, null, ['src/core/service.ts']);
    expect(strategy.runTypeCheck).toBe(true);
    expect(strategy.reasons.some(r => r.includes('RULE_01'))).toBe(true);
  });

  it('applies RULE_02: package.json changed -> Build', async () => {
    const strategy = await engine.generate(null, null, ['package.json']);
    expect(strategy.runBuild).toBe(true);
    expect(strategy.reasons.some(r => r.includes('RULE_02'))).toBe(true);
  });

  it('applies RULE_03: Test file changed -> Unit Test', async () => {
    const strategy = await engine.generate(null, null, ['src/core/service.test.ts']);
    expect(strategy.runUnitTests).toBe(true);
    expect(strategy.reasons.some(r => r.includes('RULE_03'))).toBe(true);
  });

  it('applies RULE_04: API files changed -> Integration Test', async () => {
    const strategy = await engine.generate(null, null, ['src/api/users.ts']);
    expect(strategy.runIntegrationTests).toBe(true);
    expect(strategy.reasons.some(r => r.includes('RULE_04'))).toBe(true);
  });

  it('applies RULE_05: Only Markdown changed -> No heavy verification', async () => {
    const strategy = await engine.generate(null, null, ['README.md', 'docs/guide.md']);
    expect(strategy.runTypeCheck).toBe(false);
    expect(strategy.runBuild).toBe(false);
    expect(strategy.runUnitTests).toBe(false);
    expect(strategy.confidence).toBe('LOW');
  });

  it('applies RULE_06: > 5 files changed -> Build + TypeCheck', async () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
    const strategy = await engine.generate(null, null, files);
    expect(strategy.runBuild).toBe(true);
    expect(strategy.runTypeCheck).toBe(true);
    expect(strategy.confidence).toBe('HIGH');
  });

  it('inherits from ExecutionPlan validation strategy', async () => {
    const plan: any = { validationStrategy: { requiredTests: ['auth.test.ts'], successCriteria: [] } };
    const strategy = await engine.generate(plan, null, ['src/auth.ts']);
    expect(strategy.runUnitTests).toBe(true);
    expect(strategy.reasons.some(r => r.includes('PLAN'))).toBe(true);
  });
});
