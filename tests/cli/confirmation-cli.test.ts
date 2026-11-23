import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseCommand } from '../../src/cli/repl/command-parser';
import { confirmCommand } from '../../src/cli/commands/confirm';
import { AppFactory } from '../../src/core/app-factory';

describe('Confirmation CLI & REPL Commands (R5.20, R5.21, R5.38)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-cli-conf-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    process.env.AGENT_WORKSPACE_ROOT = tempDir;
  });

  afterEach(async () => {
    delete process.env.AGENT_WORKSPACE_ROOT;
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses /confirm, /approve, /reject, /provide-credential in REPL command parser', () => {
    expect(parseCommand('/confirm')).toEqual({ type: 'confirm', args: undefined });
    expect(parseCommand('/confirm list')).toEqual({ type: 'confirm', args: 'list' });
    expect(parseCommand('/approve conf-123')).toEqual({ type: 'approve', args: 'conf-123' });
    expect(parseCommand('/approve conf-123 approved repair')).toEqual({ type: 'approve', args: 'conf-123 approved repair' });
    expect(parseCommand('/reject conf-123 user declined')).toEqual({ type: 'reject', args: 'conf-123 user declined' });
    expect(parseCommand('/provide-credential conf-123 secret-token')).toEqual({
      type: 'provide-credential',
      args: 'conf-123 secret-token',
    });
  });

  it('runs confirm CLI commands end-to-end', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const factory = new AppFactory(tempDir, logger);
    const service = factory.createConfirmationService();

    // Create a request
    const req = await service.createRequest({
      taskId: 'cli-task-1',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      reason: 'CLI confirmation test',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['app/page.tsx'],
    });

    // 1. List
    const listSuccess = await confirmCommand(['list']);
    expect(listSuccess).toBe(true);

    // 2. Get detail
    const getSuccess = await confirmCommand(['get', req.id]);
    expect(getSuccess).toBe(true);

    // 3. Approve
    const approveSuccess = await confirmCommand(['approve', req.id, 'CLI approved']);
    expect(approveSuccess).toBe(true);

    const updated = await service.getRequest(req.id);
    expect(updated?.status).toBe('APPROVED');
    expect(updated?.decision?.actor).toBe('cli-user');
    expect(updated?.decision?.reason).toBe('CLI approved');
  });

  it('runs confirm reject and cancel via CLI', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const factory = new AppFactory(tempDir, logger);
    const service = factory.createConfirmationService();

    const req1 = await service.createRequest({
      taskId: 'cli-task-2',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'Risk test',
      requestedAction: 'EXECUTE_PLAN',
    });

    const rejectSuccess = await confirmCommand(['reject', req1.id, 'No thanks']);
    expect(rejectSuccess).toBe(true);
    expect((await service.getRequest(req1.id))?.status).toBe('REJECTED');

    const req2 = await service.createRequest({
      taskId: 'cli-task-3',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'Risk test 2',
      requestedAction: 'EXECUTE_PLAN',
    });

    const cancelSuccess = await confirmCommand(['cancel', req2.id]);
    expect(cancelSuccess).toBe(true);
    expect((await service.getRequest(req2.id))?.status).toBe('CANCELLED');
  });
});
