import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { ConfirmationService } from '../../src/app/confirmation-service';
import { FileConfirmationStore } from '../../src/core/confirmation/file-confirmation-store';
import { ConfirmationPolicy } from '../../src/core/confirmation/confirmation-policy';
import { ReliabilityService } from '../../src/app/reliability-service';
import { FileReliabilityStore } from '../../src/app/file-reliability-store';
import { ApplicationCommandService } from '../../src/app/application-command-service';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';
import { makeWorkflowResult } from '../app/fixtures/run-fixtures';
import { RuntimeSecretHolder } from '../../src/core/backend/runtime-secrets';

describe('UI-2 Operator Commands & Application Layer (UI-2.1, UI-2.2, UI-2.3, UI-2.39)', () => {
  let root: string;
  let server: StartedWebServer;
  let base: string;
  let commandService: ApplicationCommandService;
  let taskStore: FileTaskRunStore;
  let confService: ConfirmationService;

  async function get(pathname: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${pathname}`);
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
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
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-op-cmd-'));
    taskStore = new FileTaskRunStore(root);
    const eventReader = new PipelineEventReader(root);
    const queryService = new TaskQueryService(taskStore, eventReader, root);

    const execService = new TaskExecutionService(
      {
        execute: async (req: any) => {
          return {
            roleId: req.roleId ?? 'coder',
            success: true,
            workflowResult: makeWorkflowResult({
              sessionId: req.sessionId,
            }),
          } as any;
        },
      },
      taskStore,
      root,
      { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    );

    const confStore = new FileConfirmationStore(root);
    confService = new ConfirmationService(confStore, new ConfirmationPolicy());
    const relStore = new FileReliabilityStore(root);
    const relService = new ReliabilityService(taskStore, relStore, root);

    commandService = new ApplicationCommandService(
      execService,
      queryService,
      confService,
      relService,
      root,
      new RuntimeSecretHolder(),
    );

    const web = createWebServer(commandService, { port: 0, host: '127.0.0.1', pollIntervalMs: 50 });
    server = await web.listen();
    base = server.url;
  });

  afterAll(async () => {
    if (server) await server.close();
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('executes a task via POST /api/v1/tasks/execute returning started task view (UI-2.2)', async () => {
    const res = await post('/api/v1/tasks/execute', {
      task: 'Inspect app/page.tsx',
      executionMode: 'STANDARD',
    });

    expect(res.status).toBe(200);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.runId).toBeDefined();
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.attemptId).toBe('attempt-1');
    expect(res.body.status).toBe('PLANNING');
    expect(res.body.executionMode).toBe('STANDARD');
    expect(res.body.startedAt).toBeDefined();
  });

  it('executes in READ_ONLY mode explicitly via POST /api/v1/tasks/execute (UI-2.3)', async () => {
    const res = await post('/api/v1/tasks/execute', {
      task: 'Inspect component hierarchy without modifying',
      executionMode: 'READ_ONLY',
    });

    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBe('READ_ONLY');
  });

  it('rejects execution with empty task prompt', async () => {
    const res = await post('/api/v1/tasks/execute', {
      task: '   ',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('supports synchronous execution when waitForCompletion is true', async () => {
    const res = await post('/api/v1/tasks/execute', {
      task: 'Quick sync inspection',
      executionMode: 'STANDARD',
      waitForCompletion: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.runId).toBeDefined();
    expect(res.body.snapshot).toBeDefined();
    expect(res.body.result).toBeDefined();
  });

  it('cancels active task run via POST /api/v1/tasks/:taskId/cancel (UI-2.39)', async () => {
    const started = await post('/api/v1/tasks/execute', {
      task: 'Long running task to cancel',
      executionMode: 'STANDARD',
    });

    const cancelRes = await post(`/api/v1/tasks/${started.body.taskId}/cancel`, {
      reason: 'User cancelled from operator UI',
    });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.taskId).toBe(started.body.taskId);
    expect(['CANCELLED', 'BLOCKED']).toContain(cancelRes.body.status);
  });

  it('returns backend verification view via GET /api/v1/tasks/:taskId/backend (UI-2.22)', async () => {
    const executed = await post('/api/v1/tasks/execute', {
      task: 'Check backend endpoints',
      executionMode: 'STANDARD',
      waitForCompletion: true,
    });

    const backendRes = await get(`/api/v1/tasks/${executed.body.taskId}/backend`);
    expect(backendRes.status).toBe(200);
    expect(backendRes.body.taskId).toBe(executed.body.taskId);
    expect(Array.isArray(backendRes.body.checks)).toBe(true);
  });

  it('returns database verification view via GET /api/v1/tasks/:taskId/database (UI-2.23)', async () => {
    const executed = await post('/api/v1/tasks/execute', {
      task: 'Check database status',
      executionMode: 'READ_ONLY',
      waitForCompletion: true,
    });

    const dbRes = await get(`/api/v1/tasks/${executed.body.taskId}/database`);
    expect(dbRes.status).toBe(200);
    expect(dbRes.body.taskId).toBe(executed.body.taskId);
    expect(dbRes.body.readOnly).toBe(true);
  });
});
