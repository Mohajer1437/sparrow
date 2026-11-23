import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfirmationService } from '../../../src/app/confirmation-service';
import { FileConfirmationStore } from '../../../src/core/confirmation/file-confirmation-store';
import { ConfirmationPolicy } from '../../../src/core/confirmation/confirmation-policy';
import { RuntimeSecretHolder } from '../../../src/core/backend/runtime-secrets';

describe('Confirmation Lifecycle (R5.3, R5.12, R5.16, R5.17, R5.18, R5.40, R5.43, R5.44)', () => {
  let tempDir: string;
  let service: ConfirmationService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-conf-lifecycle-'));
    const store = new FileConfirmationStore(tempDir);
    const policy = new ConfirmationPolicy();
    service = new ConfirmationService(store, policy);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles PENDING -> APPROVED lifecycle and validates fresh decision', async () => {
    const req = await service.createRequest({
      taskId: 'task-1',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      reason: 'Delete test file during repair',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['tests/page.test.tsx'],
    });

    expect(req.status).toBe('PENDING');

    const approved = await service.approve(req.id, {
      actor: 'cli-user',
      reason: 'Confirmed safe repair',
    });

    expect(approved.status).toBe('APPROVED');
    expect(approved.decision?.decision).toBe('APPROVE');
    expect(approved.decision?.actor).toBe('cli-user');

    // Validates with matching facts
    const validation = await service.validateDecision(req.id, {
      taskId: 'task-1',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['tests/page.test.tsx'],
    });

    expect(validation.valid).toBe(true);
    expect(validation.stale).toBeFalsy();
  });

  it('handles PENDING -> REJECTED lifecycle (R5.17)', async () => {
    const req = await service.createRequest({
      taskId: 'task-2',
      type: 'AMBIGUOUS_SCOPE',
      risk: 'MEDIUM',
      reason: 'Scope unclear',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/app.ts'],
    });

    const rejected = await service.reject(req.id, {
      actor: 'repl-user',
      reason: 'User declined action',
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decision?.decision).toBe('REJECT');

    // Attempting to validate rejected decision must fail
    const validation = await service.validateDecision(req.id, {
      taskId: 'task-2',
      type: 'AMBIGUOUS_SCOPE',
      risk: 'MEDIUM',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/app.ts'],
    });

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('REJECTED');
  });

  it('handles PENDING -> CANCELLED lifecycle (R5.43)', async () => {
    const req = await service.createRequest({
      taskId: 'task-3',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['package.json'],
    });

    const cancelled = await service.cancel(req.id, { actor: 'local-user' });
    expect(cancelled.status).toBe('CANCELLED');

    const validation = await service.validateDecision(req.id, {
      taskId: 'task-3',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['package.json'],
    });

    expect(validation.valid).toBe(false);
  });

  it('enforces idempotency on repeated approval or rejection (R5.40)', async () => {
    const req = await service.createRequest({
      taskId: 'task-4',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/a.ts'],
    });

    const appr1 = await service.approve(req.id, { actor: 'cli-user' });
    const appr2 = await service.approve(req.id, { actor: 'cli-user' });

    expect(appr1.id).toBe(appr2.id);
    expect(appr2.status).toBe('APPROVED');

    const req2 = await service.createRequest({
      taskId: 'task-5',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/b.ts'],
    });

    const rej1 = await service.reject(req2.id, { actor: 'cli-user' });
    const rej2 = await service.reject(req2.id, { actor: 'cli-user' });

    expect(rej1.id).toBe(rej2.id);
    expect(rej2.status).toBe('REJECTED');
  });

  it('handles test credential provision and runtime secret storage (R5.18, R5.19)', async () => {
    const secrets = new RuntimeSecretHolder();

    const req = await service.createRequest({
      taskId: 'task-cred',
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
      reason: 'Admin endpoint requires admin access token',
      requestedAction: 'BACKEND_VERIFICATION',
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'admin endpoint',
      },
    });

    const provided = await service.provideCredential(req.id, 'super-test-token-1234', {
      actor: 'cli-user',
      secrets,
    });

    expect(provided.status).toBe('APPROVED');
    expect(provided.decision?.decision).toBe('PROVIDE');
    expect(provided.decision?.input?.credentialProvided).toBe(true);

    // Verify secret is held in memory
    expect(secrets.get().adminAccessToken).toBe('super-test-token-1234');

    // Verify raw secret is NOT written in request or decision object
    const serialized = JSON.stringify(provided);
    expect(serialized).not.toContain('super-test-token-1234');

    // Clearing secrets removes it from memory
    secrets.clear();
    expect(secrets.get().adminAccessToken).toBeUndefined();
  });
});
