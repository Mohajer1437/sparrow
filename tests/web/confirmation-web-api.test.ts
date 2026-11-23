import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { ConfirmationService } from '../../src/app/confirmation-service';
import { FileConfirmationStore } from '../../src/core/confirmation/file-confirmation-store';
import { ConfirmationPolicy } from '../../src/core/confirmation/confirmation-policy';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';

let root: string;
let server: StartedWebServer;
let base: string;
let confService: ConfirmationService;

async function get(pathname: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${pathname}`);
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function post(pathname: string, data?: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-web-conf-'));
  const taskStore = new FileTaskRunStore(root);
  const events = new PipelineEventReader(root);
  const queries = new TaskQueryService(taskStore, events, root);

  const confStore = new FileConfirmationStore(root);
  const confPolicy = new ConfirmationPolicy();
  confService = new ConfirmationService(confStore, confPolicy);

  const web = createWebServer(queries, { port: 0, host: '127.0.0.1' }, undefined, confService);
  server = await web.listen();
  base = server.url;
});

afterAll(async () => {
  await server?.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('Confirmation Web API (R5.22, R5.23, R5.24, R5.39, R5.46)', () => {
  it('lists confirmation requests via GET /api/v1/confirmations', async () => {
    const req = await confService.createRequest({
      taskId: 'web-task-1',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'Change to critical file',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/core/critical.ts'],
    });

    const res = await get('/api/v1/confirmations');
    expect(res.status).toBe(200);
    expect(res.body.confirmations).toBeDefined();
    expect(res.body.confirmations.some((c: any) => c.id === req.id)).toBe(true);
  });

  it('gets confirmation detail via GET /api/v1/confirmations/:id', async () => {
    const req = await confService.createRequest({
      taskId: 'web-task-2',
      type: 'DESTRUCTIVE_REPAIR',
      risk: 'HIGH',
      reason: 'Repair target validation needed',
      requestedAction: 'APPLY_REPAIR',
      affectedFiles: ['app/page.tsx'],
    });

    const res = await get(`/api/v1/confirmations/${req.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(req.id);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.reason).toBe('Repair target validation needed');
  });

  it('returns 404 for non-existent confirmation id', async () => {
    const res = await get('/api/v1/confirmations/conf-nonexistent-999');
    expect(res.status).toBe(404);
  });

  it('approves a confirmation via POST /api/v1/confirmations/:id/approve', async () => {
    const req = await confService.createRequest({
      taskId: 'web-task-3',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'High risk edit',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['package.json'],
    });

    const res = await post(`/api/v1/confirmations/${req.id}/approve`, {
      actor: 'web-operator',
      reason: 'Approved from web console',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.decision.actor).toBe('web-operator');
    expect(res.body.decision.reason).toBe('Approved from web console');
  });

  it('rejects a confirmation via POST /api/v1/confirmations/:id/reject', async () => {
    const req = await confService.createRequest({
      taskId: 'web-task-4',
      type: 'UNKNOWN_INTENT',
      risk: 'HIGH',
      reason: 'Ambiguous destructive intent',
      requestedAction: 'EXECUTE_PLAN',
      affectedFiles: ['src/app.ts'],
    });

    const res = await post(`/api/v1/confirmations/${req.id}/reject`, {
      actor: 'web-operator',
      reason: 'User cancelled intent',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.decision.decision).toBe('REJECT');
  });

  it('provides credential via POST and NEVER leaks the secret token in response (R5.18, R5.46)', async () => {
    const req = await confService.createRequest({
      taskId: 'web-task-cred',
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
      reason: 'Admin test token required',
      requestedAction: 'BACKEND_VERIFICATION',
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'admin endpoint',
      },
    });

    const res = await post(`/api/v1/confirmations/${req.id}/provide-credential`, {
      actor: 'web-user',
      token: 'secret-web-token-xyz-987',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.decision.decision).toBe('PROVIDE');

    // Crucial: token must NOT appear in response body or JSON
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('secret-web-token-xyz-987');
  });

  it('returns 405 for disallowed mutation methods on non-confirmation endpoints', async () => {
    const res = await post('/api/v1/tasks', { foo: 'bar' });
    expect(res.status).toBe(405);
  });
});
