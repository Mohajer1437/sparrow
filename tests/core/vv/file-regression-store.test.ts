import { FileRegressionStore } from '../../../src/core/vv/file-regression-store';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { VerificationReport } from '../../../src/domain/verification-report';

class MemoryRuntime implements RuntimeRepository {
  private readonly files = new Map<string, string>();
  async readFile(filePath: string): Promise<string> {
    const value = this.files.get(filePath);
    if (value === undefined) throw new Error('missing ' + filePath);
    return value;
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async mkdir(): Promise<void> {}
  async appendFeedbackCandidates(): Promise<void> {}
}

describe('FileRegressionStore', () => {
  it('records reports and failed contracts for later adversarial use', async () => {
    const runtime = new MemoryRuntime();
    const store = new FileRegressionStore(runtime);
    const report: VerificationReport = {
      id: 'vv-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      passed: false,
      checks: [{
        id: 'api-runtime',
        category: 'api',
        name: 'API runtime',
        passed: false,
        severity: 'HIGH',
        evidence: 'down',
      }],
      evidence: ['api-runtime: FAIL down'],
      failureContract: {
        id: 'fail-1',
        createdAt: new Date().toISOString(),
        qualityProfile: 'PRODUCTION',
        summary: '1 verification check(s) failed',
        failedChecks: [],
        acceptanceCriteria: [],
        repairInstructions: 'fix it',
        attempt: 1,
      },
    };

    await store.record(report);
    const recent = await store.loadRecent(5);
    const failures = await store.loadFailures(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('vv-1');
    expect(failures).toHaveLength(1);
    expect(failures[0].id).toBe('fail-1');
  });

  it('persists replayable regression cases without duplicating the same defect', async () => {
    const runtime = new MemoryRuntime();
    const store = new FileRegressionStore(runtime);
    await store.saveCase({
      id: 'reg-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'api',
      checkId: 'api-missing-input-post-api-save',
      name: 'POST /api/save missing-input',
      expectedBehavior: 'POST /api/save must satisfy 400|422',
      method: 'POST',
      route: '/api/save',
      scenario: 'missing-input',
      expectedStatuses: [400, 422],
      evidence: 'Actual: 500',
    });
    await store.saveCase({
      id: 'reg-2',
      createdAt: new Date().toISOString(),
      qualityProfile: 'PRODUCTION',
      category: 'api',
      checkId: 'api-missing-input-post-api-save',
      name: 'POST /api/save missing-input',
      expectedBehavior: 'POST /api/save must satisfy 400|422',
      method: 'POST',
      route: '/api/save',
      scenario: 'missing-input',
      expectedStatuses: [400, 422],
      evidence: 'Actual: 500 again',
    });
    const cases = await store.loadCases(10);
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('reg-2');
    expect(cases[0].method).toBe('POST');
    expect(cases[0].route).toBe('/api/save');
  });
});
