import { DefaultVvAgent } from '../../../src/core/vv/default-vv-agent';
import { DefaultQualityPolicy } from '../../../src/core/vv/default-quality-policy';
import { ProductValidator } from '../../../src/contracts/product-validator';
import { DeterministicVerifier } from '../../../src/contracts/deterministic-verifier';
import { ApiVerifier } from '../../../src/contracts/api-verifier';
import { BrowserVerifier } from '../../../src/contracts/browser-verifier';
import { SecurityVerifier } from '../../../src/contracts/security-verifier';
import { AdaptiveAdversary } from '../../../src/contracts/adaptive-adversary';
import { RegressionStore } from '../../../src/contracts/regression-store';
import { VerificationCheck } from '../../../src/domain/verification-check';

function check(partial: Partial<VerificationCheck> & Pick<VerificationCheck, 'id' | 'passed'>): VerificationCheck {
  return {
    category: 'deterministic',
    name: partial.id,
    severity: 'LOW',
    evidence: partial.passed ? 'ok' : 'fail',
    ...partial,
  } as VerificationCheck;
}

describe('DefaultVvAgent', () => {
  it('runs enabled verifiers and records a passing report', async () => {
    const productValidator: ProductValidator = {
      analyze: jest.fn().mockResolvedValue({
        objective: 'task',
        productUnderstanding: 'understand',
        acceptanceCriteria: ['works'],
        risks: [],
        verificationRequirements: ['deterministic'],
        assumptions: [],
        blockingQuestions: [],
        materialAmbiguities: [],
        qualityProfile: 'STANDARD',
      }),
    };
    const deterministic: DeterministicVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'deterministic-typecheck', passed: true })]),
    };
    const api: ApiVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'api-route-discovery', passed: true, category: 'api' })]),
    };
    const browser: BrowserVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'browser-no-pages', passed: true, category: 'browser' })]),
    };
    const security: SecurityVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'security-secrets', passed: true, category: 'security' })]),
    };
    const adversary: AdaptiveAdversary = {
      generate: jest.fn().mockResolvedValue([]),
    };
    const regressionStore: RegressionStore = {
      record: jest.fn().mockResolvedValue(undefined),
      loadRecent: jest.fn().mockResolvedValue([]),
      loadFailures: jest.fn().mockResolvedValue([]),
      loadCases: jest.fn().mockResolvedValue([]),
      saveCase: jest.fn().mockResolvedValue(undefined),
    };

    const agent = new DefaultVvAgent(
      productValidator,
      new DefaultQualityPolicy('STANDARD'),
      deterministic,
      api,
      browser,
      security,
      adversary,
      regressionStore,
    );

    const report = await agent.verify({
      task: 'Add a footer note',
      qualityProfile: 'STANDARD',
      workspacePath: '/tmp/ws',
      changedFiles: ['src/page.tsx'],
      acceptanceCriteria: ['works'],
      repairAttempt: 1,
    });

    expect(report.passed).toBe(true);
    expect(deterministic.verify).toHaveBeenCalled();
    expect(api.verify).toHaveBeenCalled();
    expect(browser.verify).toHaveBeenCalled();
    expect(security.verify).toHaveBeenCalled();
    expect(adversary.generate).not.toHaveBeenCalled();
    expect(regressionStore.record).toHaveBeenCalledWith(report);
    expect(report.failureContract).toBeUndefined();
  });

  it('builds a failure contract when a check fails and does not repair code', async () => {
    const productValidator: ProductValidator = { analyze: jest.fn() };
    const deterministic: DeterministicVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'deterministic-build', passed: false, category: 'deterministic' })]),
    };
    const noop = { verify: jest.fn().mockResolvedValue([]) };
    const adversary: AdaptiveAdversary = { generate: jest.fn().mockResolvedValue([]) };
    const regressionStore: RegressionStore = {
      record: jest.fn().mockResolvedValue(undefined),
      loadRecent: jest.fn().mockResolvedValue([]),
      loadFailures: jest.fn().mockResolvedValue([]),
      loadCases: jest.fn().mockResolvedValue([]),
      saveCase: jest.fn().mockResolvedValue(undefined),
    };

    const agent = new DefaultVvAgent(
      productValidator,
      new DefaultQualityPolicy('PRODUCTION'),
      deterministic,
      noop as ApiVerifier,
      noop as BrowserVerifier,
      noop as SecurityVerifier,
      adversary,
      regressionStore,
    );

    const report = await agent.verify({
      task: 'ship it',
      qualityProfile: 'PRODUCTION',
      workspacePath: '/tmp/ws',
      repairAttempt: 1,
    });

    expect(report.passed).toBe(false);
    expect(report.failureContract).toBeDefined();
    expect(report.failureContract?.summary).toMatch(/failed/i);
    expect(adversary.generate).toHaveBeenCalled();
  });

  it('persists a regression case after a meaningful failure later passes', async () => {
    const productValidator: ProductValidator = { analyze: jest.fn() };
    const deterministic: DeterministicVerifier = {
      verify: jest.fn().mockResolvedValue([check({ id: 'deterministic-typecheck', passed: true })]),
    };
    const noop = { verify: jest.fn().mockResolvedValue([]) };
    const adversary: AdaptiveAdversary = { generate: jest.fn().mockResolvedValue([]) };
    const priorFailure = {
      id: 'fail-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'STANDARD' as const,
      summary: '1 verification check(s) failed',
      severity: 'HIGH',
      category: 'api',
      failedChecks: [{
        id: 'api-missing-input-post-api-save',
        category: 'api' as const,
        name: 'POST /api/save missing-input',
        passed: false,
        severity: 'HIGH' as const,
        evidence: 'method: POST; URL: http://127.0.0.1:3010/api/save; route: /api/save; scenario: missing-input; Expected: 400|422; Actual: 500; source: app/api/save/route.ts',
      }],
      acceptanceCriteria: ['400'],
      repairInstructions: 'fix',
      attempt: 1,
      expectation: { expectedBehavior: 'POST /api/save must satisfy 400|422' },
      location: { method: 'POST', route: '/api/save' },
    };
    const regressionStore: RegressionStore = {
      record: jest.fn().mockResolvedValue(undefined),
      loadRecent: jest.fn().mockResolvedValue([]),
      loadFailures: jest.fn().mockResolvedValue([priorFailure]),
      loadCases: jest.fn().mockResolvedValue([]),
      saveCase: jest.fn().mockResolvedValue(undefined),
    };
    const agent = new DefaultVvAgent(
      productValidator,
      new DefaultQualityPolicy('STANDARD'),
      deterministic,
      noop as ApiVerifier,
      noop as BrowserVerifier,
      noop as SecurityVerifier,
      adversary,
      regressionStore,
    );
    const report = await agent.verify({
      task: 'POST /api/save must reject missing JSON with 400',
      qualityProfile: 'STANDARD',
      workspacePath: '/tmp/ws',
      repairAttempt: 2,
    });
    expect(report.passed).toBe(true);
    expect(regressionStore.saveCase).toHaveBeenCalled();
    const saved = (regressionStore.saveCase as jest.Mock).mock.calls[0][0];
    expect(saved.route).toBe('/api/save');
    expect(saved.method).toBe('POST');
  });
});
