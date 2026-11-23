import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';
import { ExecutionLogger } from '../../src/core/observability/execution-logger';
import { makeWorkflowResult } from '../app/fixtures/run-fixtures';

describe('UI-2 Mandatory Log File Correlation Evidence (UI-2.11, UI-2.12)', () => {
  let root: string;
  let server: StartedWebServer;
  let base: string;
  let taskStore: FileTaskRunStore;
  let eventReader: PipelineEventReader;
  let queryService: TaskQueryService;
  let execService: TaskExecutionService;
  let executedTaskId: string;
  let executedRunId: string;

  async function get(pathname: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${pathname}`);
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-log-evidence-'));
    taskStore = new FileTaskRunStore(root);
    eventReader = new PipelineEventReader(root);
    queryService = new TaskQueryService(taskStore, eventReader, root);

    execService = new TaskExecutionService(
      {
        execute: async (req: any) => {
          // Log structured pipeline events during execution
          ExecutionLogger.log('PLANNING', 'coder', '-', 'Planning task', { step: 1 });
          ExecutionLogger.log('EXECUTION', 'coder', '-', 'Executing step 1', { file: 'app/page.tsx' });
          ExecutionLogger.log('VERIFICATION', 'coder', '-', 'V&V check passed', { check: 'typecheck' });
          return {
            roleId: 'coder',
            success: true,
            workflowResult: makeWorkflowResult({ sessionId: req.sessionId }),
          } as any;
        },
      },
      taskStore,
      root,
      { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    );

    const outcome = await execService.execute({
      task: 'Inspect app/page.tsx log evidence',
      executionMode: 'STANDARD',
    });
    executedTaskId = outcome.taskId;
    executedRunId = outcome.runId;

    const web = createWebServer(queryService, { port: 0, host: '127.0.0.1', pollIntervalMs: 50 }, undefined, undefined, execService);
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

  it('exposes exact pipeline log filename for executed run (UI-2.11)', async () => {
    const res = await get(`/api/v1/tasks/${executedTaskId}/logs`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FOUND');
    expect(res.body.fileName).toMatch(/^pipeline-.*\.log$/);
    expect(res.body.directory).toBe('.ai/logs/pipeline');
    expect(res.body.taskId).toBe(executedTaskId);
    expect(res.body.runId).toBe(executedRunId);
    expect(res.body.eventCount).toBeGreaterThan(0);

    // Verify file actually exists on disk
    const logDiskPath = path.join(root, '.ai', 'logs', 'pipeline', res.body.fileName);
    const diskStat = await fs.stat(logDiskPath);
    expect(diskStat.isFile()).toBe(true);
    expect(diskStat.size).toBeGreaterThan(0);
  });

  it('exposes exact log file for specific runId via /runs/:runId/logs', async () => {
    const res = await get(`/api/v1/runs/${executedRunId}/logs`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FOUND');
    expect(res.body.runId).toBe(executedRunId);
    expect(res.body.fileName).toMatch(/^pipeline-.*\.log$/);
  });

  it('serves redacted raw log lines via /tasks/:taskId/runs/:runId/logs/raw (UI-2.12)', async () => {
    const res = await get(`/api/v1/tasks/${executedTaskId}/runs/${executedRunId}/logs/raw`);
    expect(res.status).toBe(200);
    expect(res.body.taskId).toBe(executedTaskId);
    expect(res.body.runId).toBe(executedRunId);
    expect(Array.isArray(res.body.lines)).toBe(true);
    expect(res.body.lineCount).toBeGreaterThan(0);

    // Each line should be valid JSON containing run correlation identifiers
    const firstLine = JSON.parse(res.body.lines[0]);
    expect(firstLine.taskId).toBe(executedTaskId);
    expect(firstLine.runId).toBe(executedRunId);
  });

  it('returns NOT_CREATED with structured reason when run has no log file', async () => {
    // Manually save a snapshot with no events logged
    const noLogTaskId = 'task-2026-08-30T00-00-00-000Z-nolog0';
    const noLogRunId = 'run-2026-08-30T00-00-00-000Z-nolog0';
    await taskStore.save({
      taskId: noLogTaskId,
      runId: noLogRunId,
      task: 'Task without logger initialization',
      roleId: 'coder',
      workspaceRoot: root,
      status: 'PLANNING',
      startedAt: '2026-08-30T00:00:00.000Z',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
    });

    const res = await get(`/api/v1/tasks/${noLogTaskId}/logs`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NOT_CREATED');
    expect(res.body.fileName).toBeNull();
    expect(res.body.reason).toBeDefined();
  });
});
