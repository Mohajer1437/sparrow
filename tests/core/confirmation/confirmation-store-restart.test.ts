import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileConfirmationStore } from '../../../src/core/confirmation/file-confirmation-store';
import { ConfirmationRequest } from '../../../src/domain/confirmation';

describe('Confirmation Persistence & Process Restart (R5.10, R5.11, R5.42)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-conf-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('persists a pending confirmation and preserves PENDING state after restart (R5.42)', async () => {
    const store1 = new FileConfirmationStore(tempDir);
    const request: ConfirmationRequest = {
      id: 'conf-restart-1',
      taskId: 'task-restart',
      type: 'DESTRUCTIVE_REPAIR',
      status: 'PENDING',
      reason: 'Destructive repair proposed',
      risk: 'HIGH',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['app/CrashBeacon.tsx'],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'fp-12345',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    await store1.save(request);

    // Simulate process restart by creating a new store instance pointing to same directory
    const store2 = new FileConfirmationStore(tempDir);
    const loaded = await store2.get('conf-restart-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('conf-restart-1');
    expect(loaded?.status).toBe('PENDING');
    expect(loaded?.affectedFiles).toEqual(['app/CrashBeacon.tsx']);

    const list = await store2.list({ status: 'PENDING' });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('conf-restart-1');
  });

  it('persists approved, rejected, and expired states across restart', async () => {
    const store1 = new FileConfirmationStore(tempDir);

    const approved: ConfirmationRequest = {
      id: 'conf-appr',
      taskId: 'task-1',
      type: 'HIGH_RISK_CHANGE',
      status: 'APPROVED',
      reason: 'High risk',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: [],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'fp-appr',
      createdAt: new Date().toISOString(),
      decision: {
        requestId: 'conf-appr',
        decision: 'APPROVE',
        actor: 'cli-user',
        decidedAt: new Date().toISOString(),
      },
    };

    const rejected: ConfirmationRequest = {
      id: 'conf-rej',
      taskId: 'task-2',
      type: 'HIGH_RISK_CHANGE',
      status: 'REJECTED',
      reason: 'High risk',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: [],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'fp-rej',
      createdAt: new Date().toISOString(),
      decision: {
        requestId: 'conf-rej',
        decision: 'REJECT',
        actor: 'cli-user',
        decidedAt: new Date().toISOString(),
        reason: 'User declined',
      },
    };

    await store1.save(approved);
    await store1.save(rejected);

    const store2 = new FileConfirmationStore(tempDir);
    const loadedAppr = await store2.get('conf-appr');
    const loadedRej = await store2.get('conf-rej');

    expect(loadedAppr?.status).toBe('APPROVED');
    expect(loadedAppr?.decision?.actor).toBe('cli-user');

    expect(loadedRej?.status).toBe('REJECTED');
    expect(loadedRej?.decision?.reason).toBe('User declined');
  });

  it('marks request EXPIRED on read if expiration time has passed', async () => {
    const store1 = new FileConfirmationStore(tempDir);

    const expired: ConfirmationRequest = {
      id: 'conf-old',
      taskId: 'task-old',
      type: 'HIGH_RISK_CHANGE',
      status: 'PENDING',
      reason: 'Old request',
      risk: 'HIGH',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: [],
      affectedArtifacts: [],
      evidenceRefs: [],
      fingerprint: 'fp-old',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:15:00.000Z',
    };

    await store1.save(expired);

    const store2 = new FileConfirmationStore(tempDir);
    const loaded = await store2.get('conf-old');

    expect(loaded?.status).toBe('EXPIRED');
  });
});
