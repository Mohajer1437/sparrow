import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';
import { makeWorkflowResult } from '../app/fixtures/run-fixtures';

describe('R6 Web API & SSE Stream Correlation', () => {
  let root: string;
  let server: StartedWebServer;
  let base: string;
  let task1Id: string;
  let run1Id: string;
  let task2Id: string;
  let run2Id: string;

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

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-web-corr-'));
    const store = new FileTaskRunStore(root);

    const execService = new TaskExecutionService(
      { execute: async () => ({ roleId: 'coder', success: true, workflowResult: makeWorkflowResult() } as any) },
      store,
      root,
      { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    );

    const out1 = await execService.execute({ task: 'Task 1 inspect' });
    task1Id = out1.taskId;
    run1Id = out1.runId;

    const out2 = await execService.execute({ task: 'Task 2 inspect' });
    task2Id = out2.taskId;
    run2Id = out2.runId;

    const reader = new PipelineEventReader(root);
    const queries = new TaskQueryService(store, reader, root);
    server = await createWebServer(queries, {
      port: 0,
      host: '127.0.0.1',
      pollIntervalMs: 50,
    }).listen();
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

  it('lists runs via GET /api/v1/runs with first-class runId (R6.30)', async () => {
    const res = await get('/api/v1/runs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs.length).toBeGreaterThanOrEqual(2);
    expect(res.body.runs.some((r: any) => r.runId === run1Id)).toBe(true);
    expect(res.body.runs.some((r: any) => r.runId === run2Id)).toBe(true);
  });

  it('fetches run details via GET /api/v1/runs/:runId', async () => {
    const res = await get(`/api/v1/runs/${run1Id}`);
    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(run1Id);
    expect(res.body.taskId).toBe(task1Id);
    expect(res.body.fingerprint).toBeDefined();
  });

  it('lists task runs via GET /api/v1/tasks/:taskId/runs', async () => {
    const res = await get(`/api/v1/tasks/${task1Id}/runs`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs.length).toBe(1);
    expect(res.body.runs[0].runId).toBe(run1Id);
  });

  it('retrieves specific task run via GET /api/v1/tasks/:taskId/runs/:runId', async () => {
    const res = await get(`/api/v1/tasks/${task1Id}/runs/${run1Id}`);
    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(run1Id);
    expect(res.body.taskId).toBe(task1Id);
  });

  it('rejects cross-task query via GET /api/v1/tasks/:taskId/runs/:runId when run does not belong to task (R6.40)', async () => {
    // run2 belongs to task2, querying under task1 must fail
    const res = await get(`/api/v1/tasks/${task1Id}/runs/${run2Id}`);
    expect(res.status).toBe(404);
  });

  it('supports SSE connection for specific runId (R6.18)', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/v1/stream?runId=${run1Id}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    if (reader) {
      let accumulated = '';
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !accumulated.includes('event: run')) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += new TextDecoder().decode(value);
      }
      expect(accumulated).toContain('event: run');
      expect(accumulated).toContain(run1Id);
      reader.cancel();
    }
    controller.abort();
  });
});
