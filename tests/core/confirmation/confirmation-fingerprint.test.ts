import { computeConfirmationFingerprint } from '../../../src/domain/confirmation';

describe('Confirmation Fingerprint (R5.13, R5.14)', () => {
  const baseInput = {
    taskId: 'task-100',
    type: 'HIGH_RISK_CHANGE' as const,
    risk: 'HIGH' as const,
    requestedAction: 'EXECUTE_PLAN',
    affectedFiles: ['src/app.ts', 'src/server.ts'],
    affectedArtifacts: ['artifact-a'],
    evidenceRefs: ['check-1'],
  };

  it('produces identical fingerprints for identical structured facts', () => {
    const fp1 = computeConfirmationFingerprint(baseInput);
    const fp2 = computeConfirmationFingerprint({
      ...baseInput,
      // order of files shouldn't affect deterministic fingerprint
      affectedFiles: ['src/server.ts', 'src/app.ts'],
    });

    expect(fp1).toBe(fp2);
  });

  it('changes fingerprint when files change (R5.13)', () => {
    const fp1 = computeConfirmationFingerprint(baseInput);
    const fp2 = computeConfirmationFingerprint({
      ...baseInput,
      affectedFiles: ['src/app.ts', 'src/server.ts', 'package.json'],
    });

    expect(fp1).not.toBe(fp2);
  });

  it('changes fingerprint when risk changes', () => {
    const fp1 = computeConfirmationFingerprint(baseInput);
    const fp2 = computeConfirmationFingerprint({
      ...baseInput,
      risk: 'CRITICAL',
    });

    expect(fp1).not.toBe(fp2);
  });

  it('changes fingerprint when operation/action changes', () => {
    const fp1 = computeConfirmationFingerprint(baseInput);
    const fp2 = computeConfirmationFingerprint({
      ...baseInput,
      requestedAction: 'APPLY_REPAIR',
    });

    expect(fp1).not.toBe(fp2);
  });

  it('changes fingerprint when credential requirement scope changes', () => {
    const fp1 = computeConfirmationFingerprint({
      ...baseInput,
      type: 'REQUIRES_TEST_CREDENTIAL',
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'admin endpoint',
      },
    });

    const fp2 = computeConfirmationFingerprint({
      ...baseInput,
      type: 'REQUIRES_TEST_CREDENTIAL',
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'superuser API',
        endpoints: ['POST /api/admin/users'],
        reason: 'admin endpoint',
      },
    });

    expect(fp1).not.toBe(fp2);
  });
});
