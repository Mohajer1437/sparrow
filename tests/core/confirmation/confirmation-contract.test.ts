import {
  ConfirmationRequest,
  ConfirmationDecision,
  ConfirmationType,
  ConfirmationStatus,
  computeConfirmationFingerprint,
  isConfirmationExpired,
  validateDecisionTransition,
  formatConfirmationRequest,
} from '../../../src/domain/confirmation';

describe('Confirmation Contract (R5.1, R5.2, R5.3, R5.4, R5.5)', () => {
  it('creates and validates a valid confirmation request structure', () => {
    const request: ConfirmationRequest = {
      id: 'conf-1234',
      taskId: 'task-abc',
      type: 'HIGH_RISK_CHANGE',
      status: 'PENDING',
      reason: 'High risk modification to critical file',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/core/critical.ts'],
      affectedArtifacts: ['artifact-1'],
      evidenceRefs: ['evidence-1'],
      fingerprint: computeConfirmationFingerprint({
        taskId: 'task-abc',
        type: 'HIGH_RISK_CHANGE',
        risk: 'HIGH',
        requestedAction: 'EXECUTE_PLAN',
        affectedFiles: ['src/core/critical.ts'],
        affectedArtifacts: ['artifact-1'],
        evidenceRefs: ['evidence-1'],
      }),
      createdAt: '2026-08-29T12:00:00.000Z',
      expiresAt: '2026-08-29T12:15:00.000Z',
    };

    expect(request.id).toBe('conf-1234');
    expect(request.status).toBe('PENDING');
    expect(request.type).toBe('HIGH_RISK_CHANGE');
    expect(request.risk).toBe('HIGH');
    expect(request.affectedFiles).toEqual(['src/core/critical.ts']);
    expect(request.fingerprint).toHaveLength(32);
  });

  it('validates decision transition rules and lifecycle status machine', () => {
    // PENDING transitions
    expect(validateDecisionTransition('PENDING', 'APPROVE')).toEqual({ valid: true });
    expect(validateDecisionTransition('PENDING', 'REJECT')).toEqual({ valid: true });
    expect(validateDecisionTransition('PENDING', 'PROVIDE')).toEqual({ valid: true });
    expect(validateDecisionTransition('PENDING', 'CANCEL')).toEqual({ valid: true });

    // Idempotent transitions
    expect(validateDecisionTransition('APPROVED', 'APPROVE')).toEqual({ valid: true });
    expect(validateDecisionTransition('APPROVED', 'PROVIDE')).toEqual({ valid: true });
    expect(validateDecisionTransition('REJECTED', 'REJECT')).toEqual({ valid: true });

    // Invalid transitions
    expect(validateDecisionTransition('EXPIRED', 'APPROVE').valid).toBe(false);
    expect(validateDecisionTransition('CANCELLED', 'APPROVE').valid).toBe(false);
    expect(validateDecisionTransition('REJECTED', 'APPROVE').valid).toBe(false);
    expect(validateDecisionTransition('APPROVED', 'REJECT').valid).toBe(false);
  });

  it('detects expiration deterministically', () => {
    const request: ConfirmationRequest = {
      id: 'conf-exp',
      taskId: 'task-1',
      type: 'CONFIRMATION_REQUIRED',
      status: 'PENDING',
      reason: 'Need approval',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: [],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'abc',
      createdAt: '2026-08-29T10:00:00.000Z',
      expiresAt: '2026-08-29T10:15:00.000Z',
    };

    expect(isConfirmationExpired(request, '2026-08-29T10:10:00.000Z')).toBe(false);
    expect(isConfirmationExpired(request, '2026-08-29T10:15:00.000Z')).toBe(true);
    expect(isConfirmationExpired(request, '2026-08-29T10:20:00.000Z')).toBe(true);
  });

  it('formats confirmation request safely without secrets', () => {
    const request: ConfirmationRequest = {
      id: 'conf-sec',
      taskId: 'task-sec',
      type: 'REQUIRES_TEST_CREDENTIAL',
      status: 'PENDING',
      reason: 'Admin endpoint requires credential',
      risk: 'HIGH',
      requestedAction: 'BACKEND_VERIFICATION',
      affectedFiles: [],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'xyz',
      createdAt: '2026-08-29T10:00:00.000Z',
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'Admin endpoint detected',
      },
    };

    const formatted = formatConfirmationRequest(request);
    expect(formatted).toContain('REQUIRES_TEST_CREDENTIAL');
    expect(formatted).toContain('conf-sec');
    expect(formatted).toContain('admin_access_token');
    expect(formatted).not.toContain('Bearer');
    expect(formatted).not.toContain('password');
  });
});
