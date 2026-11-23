import { extractAuthzProbes, verifyIntentContract } from '../../../src/core/vv/intent-contract-verifier';
import { HeuristicProductValidator } from '../../../src/core/vv/heuristic-product-validator';
import { DefaultVvAgent } from '../../../src/core/vv/default-vv-agent';
import { DefaultQualityPolicy } from '../../../src/core/vv/default-quality-policy';
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

describe('intent-contract-verifier', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts unauthenticated API probes from acceptance criteria', () => {
    const probes = extractAuthzProbes([
      'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.',
    ], 'POST /api/save must succeed only for authenticated users.');
    expect(probes).toHaveLength(1);
    expect(probes[0].method).toBe('POST');
    expect(probes[0].route).toBe('/api/save');
    expect(probes[0].expectedStatuses).toEqual([401, 403]);
  });

  it('extracts /api/save from a route.ts file mention and never /api/save/route', () => {
    const probes = extractAuthzProbes(
      undefined,
      'In app/api/save/route.ts, unauthenticated POST /api/save must return 401 or 403.',
    );
    expect(probes).toHaveLength(1);
    expect(probes[0].route).toBe('/api/save');
    expect(probes[0].sourceFile).toBe('app/api/save/route.ts');
    expect(probes[0].route).not.toBe('/api/save/route');
    expect(probes[0].sourceFile).not.toBe('app/api/save/route/route.ts');
  });

  it('fails when observed behavior violates the accepted authorization criterion', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      text: async () => '{"ok":true}',
    }) as any;
    const checks = await verifyIntentContract({
      workspacePath: '/tmp/ws',
      profile: 'PRODUCTION',
      task: 'POST /api/save only for authenticated users',
      acceptanceCriteria: [
        'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.',
      ],
    });
    const authz = checks.find(item => item.id.startsWith('intent-authz-'));
    expect(authz).toBeDefined();
    expect(authz!.passed).toBe(false);
    expect(authz!.evidence).toMatch(/Expected: 401\|403/);
    expect(authz!.evidence).toMatch(/Actual: 200/);
    expect(authz!.evidence).toMatch(/source: app\/api\/save\/route.ts/);
  });

  it('passes when unauthenticated callers receive 401', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'unauthenticated',
    }) as any;
    const checks = await verifyIntentContract({
      workspacePath: '/tmp/ws',
      profile: 'STANDARD',
      acceptanceCriteria: [
        'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.',
      ],
    });
    expect(checks.find(item => item.id.startsWith('intent-authz-'))?.passed).toBe(true);
  });

  it('skips live probes on MVP', async () => {
    global.fetch = jest.fn() as any;
    const checks = await verifyIntentContract({
      workspacePath: '/tmp/ws',
      profile: 'MVP',
      acceptanceCriteria: [
        'Given an unauthenticated caller, when POST /api/save is issued, then the response status is 401 or 403.',
      ],
    });
    expect(checks).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('acceptance criteria survive Product QA → V&V', () => {
  it('makes pre-planning criteria available to DefaultVvAgent', async () => {
    const validator = new HeuristicProductValidator();
    const analysis = await validator.analyze({
      task: 'On app/page.tsx add data-testid=sandbox-p21-status with exact visible text Product QA ready. Do not add authentication.',
      qualityProfile: 'STANDARD',
    });
    const agent = new DefaultVvAgent(
      validator,
      new DefaultQualityPolicy('STANDARD'),
      { verify: jest.fn().mockResolvedValue([check({ id: 'deterministic-typecheck', passed: true })]) },
      { verify: jest.fn().mockResolvedValue([]) },
      { verify: jest.fn().mockResolvedValue([]) },
      { verify: jest.fn().mockResolvedValue([]) },
      { generate: jest.fn().mockResolvedValue([]) },
      {
        record: jest.fn().mockResolvedValue(undefined),
        loadRecent: jest.fn().mockResolvedValue([]),
        loadFailures: jest.fn().mockResolvedValue([]),
        loadCases: jest.fn().mockResolvedValue([]),
        saveCase: jest.fn().mockResolvedValue(undefined),
      },
    );
    const report = await agent.verify({
      task: 'On app/page.tsx add data-testid=sandbox-p21-status',
      qualityProfile: 'STANDARD',
      workspacePath: '/tmp/ws',
      acceptanceCriteria: analysis.acceptanceCriteria,
      intentContract: analysis,
      repairAttempt: 1,
    });
    const trace = report.checks.find(item => item.id === 'intent-acceptance-traceability');
    expect(trace?.passed).toBe(true);
    expect(trace?.evidence).toMatch(/data-testid="sandbox-p21-status"/);
    expect(report.passed).toBe(true);
  });
});
