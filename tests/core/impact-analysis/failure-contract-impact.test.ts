import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { formatFailureContract } from '../../../src/domain/failure-contract';
import { seedRepairFiles } from '../../../src/core/repair/repair-context';

describe('Failure Contract & Repair Impact Integration', () => {
  it('extracts impact evidence, affected artifact, regression check, and failedTodoId into failure contract', () => {
    const check = {
      id: 'reg-check-1',
      name: 'User Regression Verification',
      category: 'regression',
      severity: 'CRITICAL',
      passed: false,
      evidence: 'endpointId: GET /api/users | actualStatus: 500 | expectedStatus: 200 | failedTodoId: todo-2 | affectedArtifact: src/users/service.ts | regressionCheck: endpoint:GET /api/users | impactEvidence: users.controller.ts imports users.service.ts',
    };

    const contract = buildFailureContract({
      profile: 'STANDARD',
      checks: [check as any],
      acceptanceCriteria: ['Users endpoint must return 200'],
      attempt: 1,
    });

    expect(contract).toBeDefined();
    expect(contract?.failedTodoId).toBe('todo-2');
    expect(contract?.affectedArtifact).toBe('src/users/service.ts');
    expect(contract?.regressionCheck).toBe('endpoint:GET /api/users');
    expect(contract?.impactEvidence).toEqual(['users.controller.ts imports users.service.ts']);

    const formatted = formatFailureContract(contract!);
    expect(formatted).toContain('Failed todo: todo-2');
    expect(formatted).toContain('Affected artifact: src/users/service.ts');
    expect(formatted).toContain('Regression check: endpoint:GET /api/users');
    expect(formatted).toContain('Impact evidence: users.controller.ts imports users.service.ts');
  });

  it('leaves failedTodoId undefined when evidence is ambiguous or UNKNOWN without inventing', () => {
    const check = {
      id: 'reg-check-2',
      name: 'Ambiguous Failure',
      category: 'regression',
      severity: 'MAJOR',
      passed: false,
      evidence: 'failedTodoId: UNKNOWN | defect observed',
    };

    const contract = buildFailureContract({
      profile: 'STANDARD',
      checks: [check as any],
      acceptanceCriteria: [],
      attempt: 1,
    });

    expect(contract).toBeDefined();
    expect(contract?.failedTodoId).toBeUndefined();
  });

  it('seeds affectedArtifact into repair context candidate files', () => {
    const fakeContract: any = {
      location: { file: 'src/main.ts' },
      affectedArtifact: 'src/impacted-service.ts',
      implicatedFiles: ['src/helper.ts'],
    };

    const seeded = seedRepairFiles({
      originalTask: 'Fix login',
      failureContract: fakeContract,
    });

    expect(seeded).toContain('src/main.ts');
    expect(seeded).toContain('src/impacted-service.ts');
    expect(seeded).toContain('src/helper.ts');
  });
});
