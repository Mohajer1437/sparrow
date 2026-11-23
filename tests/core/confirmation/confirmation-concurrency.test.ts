import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfirmationService } from '../../../src/app/confirmation-service';
import { FileConfirmationStore } from '../../../src/core/confirmation/file-confirmation-store';
import { ConfirmationPolicy } from '../../../src/core/confirmation/confirmation-policy';

describe('Confirmation Concurrency & Races (R5.41)', () => {
  let tempDir: string;
  let service: ConfirmationService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-conf-concurrency-'));
    const store = new FileConfirmationStore(tempDir);
    const policy = new ConfirmationPolicy();
    service = new ConfirmationService(store, policy);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('safely handles concurrent double approval (R5.41)', async () => {
    const req = await service.createRequest({
      taskId: 'task-conc-1',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/index.ts'],
    });

    const [res1, res2] = await Promise.all([
      service.approve(req.id, { actor: 'cli-user-1' }),
      service.approve(req.id, { actor: 'cli-user-2' }),
    ]);

    expect(res1.status).toBe('APPROVED');
    expect(res2.status).toBe('APPROVED');
  });

  it('safely handles approve and reject race deterministically (R5.41)', async () => {
    const req = await service.createRequest({
      taskId: 'task-conc-2',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/index.ts'],
    });

    // Run approve and reject concurrently
    const results = await Promise.allSettled([
      service.approve(req.id, { actor: 'cli-user' }),
      service.reject(req.id, { actor: 'repl-user' }),
    ]);

    const finalReq = await service.getRequest(req.id);
    expect(['APPROVED', 'REJECTED']).toContain(finalReq?.status);

    // If one succeeded and resolved first, the other either succeeded or threw a state transition conflict
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
  });

  it('invalidates approval when scope changes before execution (R5.13, R5.16)', async () => {
    const req = await service.createRequest({
      taskId: 'task-stale',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      reason: 'Repair single file',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['app/page.tsx'],
    });

    await service.approve(req.id, { actor: 'cli-user' });

    // Expansion or scope change occurs: now proposed files are [app/page.tsx, package.json]
    const validation = await service.validateDecision(req.id, {
      taskId: 'task-stale',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['app/page.tsx', 'package.json'], // expanded!
    });

    expect(validation.valid).toBe(false);
    expect(validation.stale).toBe(true);
    expect(validation.reason).toContain('fingerprint mismatch');
  });
});
