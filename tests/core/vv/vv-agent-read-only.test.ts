/**
 * R1.21, R1.24 — regression for a real E2E bug: a READ_ONLY inspection was
 * failed by live product verification that READ_ONLY itself had blocked, which
 * then dragged the run into a repair loop.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdaptiveAdversary } from '../../../src/contracts/adaptive-adversary';
import { ApiVerifier } from '../../../src/contracts/api-verifier';
import { BrowserVerifier } from '../../../src/contracts/browser-verifier';
import { DefaultQualityPolicy } from '../../../src/core/vv/default-quality-policy';
import { DefaultVvAgent } from '../../../src/core/vv/default-vv-agent';
import { DeterministicVerifier } from '../../../src/contracts/deterministic-verifier';
import { RegressionStore } from '../../../src/contracts/regression-store';
import { SecurityVerifier } from '../../../src/contracts/security-verifier';
import { VerificationCheck } from '../../../src/domain/verification-check';

function check(id: string, passed: boolean, category: VerificationCheck['category']): VerificationCheck {
  return { id, name: id, category, passed, severity: 'HIGH', evidence: passed ? 'ok' : 'not reachable' };
}

function makeAgent(overrides: {
  api?: ApiVerifier;
  browser?: BrowserVerifier;
} = {}) {
  const productValidator = {
    analyze: jest.fn().mockResolvedValue({
      objective: 'inspect',
      productUnderstanding: 'read only',
      acceptanceCriteria: [],
      risks: [],
      verificationRequirements: ['deterministic'],
      assumptions: [],
      blockingQuestions: [],
      materialAmbiguities: [],
      qualityProfile: 'PRODUCTION',
    }),
  };
  const deterministic: DeterministicVerifier = {
    verify: jest.fn().mockResolvedValue([check('deterministic-typecheck', true, 'deterministic')]),
  };
  const api: ApiVerifier = overrides.api ?? {
    verify: jest.fn().mockResolvedValue([check('api-runtime', false, 'api')]),
  };
  const browser: BrowserVerifier = overrides.browser ?? {
    verify: jest.fn().mockResolvedValue([check('browser-runtime', false, 'browser')]),
  };
  const security: SecurityVerifier = { verify: jest.fn().mockResolvedValue([]) };
  const adversary: AdaptiveAdversary = { generate: jest.fn().mockResolvedValue([]) };
  const regressionStore: RegressionStore = {
    record: jest.fn().mockResolvedValue(undefined),
    loadRecent: jest.fn().mockResolvedValue([]),
    loadFailures: jest.fn().mockResolvedValue([]),
    loadCases: jest.fn().mockResolvedValue([]),
    saveCase: jest.fn().mockResolvedValue(undefined),
  };

  const agent = new DefaultVvAgent(
    productValidator as never,
    new DefaultQualityPolicy('PRODUCTION'),
    deterministic,
    api,
    browser,
    security,
    adversary,
    regressionStore,
  );
  return { agent, api, browser };
}

describe('V&V under READ_ONLY (R1.21, R1.24)', () => {
  const previousBaseUrl = process.env.AGENT_VV_BASE_URL;

  beforeAll(() => {
    // Nothing is listening on this port, so live verification is unreachable.
    process.env.AGENT_VV_BASE_URL = 'http://127.0.0.1:1';
  });

  afterAll(() => {
    if (previousBaseUrl === undefined) delete process.env.AGENT_VV_BASE_URL;
    else process.env.AGENT_VV_BASE_URL = previousBaseUrl;
  });

  it('does not run live API or browser verification it has structurally blocked', async () => {
    const { agent, api, browser } = makeAgent();

    const report = await agent.verify({
      task: 'Inspect app/page.tsx',
      qualityProfile: 'PRODUCTION',
      workspacePath: process.cwd(),
      executionMode: 'READ_ONLY',
    });

    expect(api.verify).not.toHaveBeenCalled();
    expect(browser.verify).not.toHaveBeenCalled();
    expect(report.checks.some(entry => entry.id === 'read-only-live-verification')).toBe(true);
  });

  it('records the absence of runtime evidence instead of failing the run for it', async () => {
    const { agent } = makeAgent();

    const report = await agent.verify({
      task: 'Inspect app/page.tsx',
      qualityProfile: 'PRODUCTION',
      workspacePath: process.cwd(),
      executionMode: 'READ_ONLY',
    });

    const blocked = report.checks.find(entry => entry.id === 'read-only-live-verification');
    expect(blocked?.evidence).toContain('BLOCKED_BY_POLICY');
    expect(blocked?.evidence).toContain('no product-level runtime evidence');
    expect(blocked?.scope).toBe('WHOLE_RUN');
    expect(report.passed).toBe(true);
  });

  it('declares the skipped live verification in the side-effect ledger', async () => {
    const { agent } = makeAgent();

    const report = await agent.verify({
      task: 'Inspect app/page.tsx',
      qualityProfile: 'PRODUCTION',
      workspacePath: process.cwd(),
      executionMode: 'READ_ONLY',
    });

    expect(report.sideEffects?.policy).toBe('READ_ONLY');
    const effect = report.sideEffects?.effects.find(entry => entry.id === 'vv-live-verification');
    expect(effect?.status).toBe('BLOCKED');
    expect(effect?.declared).toBe(true);
    expect(report.sideEffects?.undeclaredCount).toBe(0);
  });

  it('still runs live verification in STANDARD mode', async () => {
    const { agent, api, browser } = makeAgent();
    // An empty workspace has no start script, so the production server bails
    // out immediately instead of running a real build inside the test.
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-vv-standard-'));

    const report = await agent.verify({
      task: 'Add an endpoint',
      qualityProfile: 'PRODUCTION',
      workspacePath: empty,
      executionMode: 'STANDARD',
      sideEffectPolicy: 'CONTROLLED_MUTATION',
    });
    await fs.rm(empty, { recursive: true, force: true });

    expect(api.verify).toHaveBeenCalled();
    expect(browser.verify).toHaveBeenCalled();
    expect(report.passed).toBe(false);
  });
});
