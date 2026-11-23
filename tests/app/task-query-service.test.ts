import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryError, TaskQueryService } from '../../src/app/task-query-service';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { ExecutionLogger } from '../../src/core/observability/execution-logger';
import { makeWorkflowResult } from './fixtures/run-fixtures';

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-query-'));
}

async function writeLog(root: string, fileName: string, entries: ReadonlyArray<object>) {
  const dir = path.join(root, '.ai', 'logs', 'pipeline');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, fileName),
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

function services(root: string) {
  const store = new FileTaskRunStore(root);
  return { store, queries: new TaskQueryService(store, new PipelineEventReader(root), root) };
}

const RUN_BASE = {
  task: 'Add a comment',
  roleId: 'coder',
  skills: [],
  context: [],
  execution: [],
  touchedFiles: [],
  startedAt: '2026-08-28T10:00:00.000Z',
};

describe('task query service', () => {
  it('links a run to its events through the logger session id', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    ExecutionLogger.init(root, 'log-session-42');

    const service = new TaskExecutionService(
      { execute: async () => ({ roleId: 'coder', success: true, workflowResult: makeWorkflowResult() } as any) },
      store,
      root,
    );
    const outcome = await service.execute({ task: 'Inspect app/page.tsx' });
    expect(outcome.snapshot.logSessionId).toBe('log-session-42');
    expect(outcome.snapshot.sessionId).toBe('log-session-42');

    await writeLog(root, 'pipeline-global-1.log', [
      { ts: outcome.snapshot.startedAt, runId: outcome.runId, sessionId: 'log-session-42', phase: 'TODO_PLAN', role: 'planner', model: 'm', message: 'plan' },
      { ts: outcome.snapshot.startedAt, runId: 'other-run', sessionId: 'other-session', phase: 'STEP', role: 'coder', model: 'm', message: 'not mine' },
    ]);

    const events = await queries.getEvents(outcome.taskId);
    expect(events.logSessionId).toBe('log-session-42');
    expect(events.events.map(event => event.message)).toEqual(['plan']);
  });

  it('keeps reading a run log after the workflow re-stamps the session id', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    await store.save({
      ...RUN_BASE,
      taskId: 'task-split',
      workspaceRoot: root,
      status: 'COMPLETED',
      logSessionId: 'repl-session',
      sessionId: 'workflow-session',
    });
    await writeLog(root, 'pipeline-repl-session-x.log', [
      { ts: '2026-08-28T10:00:00.000Z', sessionId: 'repl-session', phase: 'REPL', role: 'coder', model: 'm', message: 'start' },
      { ts: '2026-08-28T10:00:01.000Z', sessionId: 'workflow-session', phase: 'TODO_PLAN', role: 'planner', model: 'm', message: 'plan' },
      { ts: '2026-08-28T10:00:02.000Z', sessionId: 'workflow-session', phase: 'STEP', role: 'coder', model: 'm', message: 'step' },
    ]);

    const events = await queries.getEvents('task-split');
    expect(events.events.map(event => event.message)).toEqual(['start', 'plan', 'step']);
  });

  it('claims only events recorded from its own start time onwards', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    await store.save({
      ...RUN_BASE,
      taskId: 'task-second',
      workspaceRoot: root,
      status: 'PLANNING',
      logSessionId: 'repl-1',
      startedAt: '2026-08-28T11:00:00.000Z',
    });
    await writeLog(root, 'pipeline-repl-1-x.log', [
      { ts: '2026-08-28T10:00:00.000Z', sessionId: 'repl-1', phase: 'VERIFICATION', role: 'coder', model: 'm', message: 'earlier task' },
      { ts: '2026-08-28T11:00:01.000Z', sessionId: 'repl-1', phase: 'CONTEXT_GATHERING', role: 'planner', model: 'm', message: 'this task' },
    ]);

    const events = await queries.getEvents('task-second');
    expect(events.events.map(event => event.message)).toEqual(['this task']);
    expect((await queries.getTask('task-second')).liveStatus).toBe('CONTEXT');
  });

  it('shows the live phase of a run that is still in progress', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    await store.save({
      ...RUN_BASE,
      taskId: 'task-live',
      workspaceRoot: root,
      status: 'PLANNING',
      logSessionId: 'log-1',
    });
    await writeLog(root, 'pipeline-log-1-x.log', [
      { ts: '2026-08-28T10:00:01.000Z', sessionId: 'log-1', phase: 'CONTEXT_GATHERING', role: 'planner', model: 'm', message: 'gathering' },
      { ts: '2026-08-28T10:00:02.000Z', sessionId: 'log-1', phase: 'STEP', role: 'coder', model: 'm', message: 'step 1' },
    ]);

    const detail = await queries.getTask('task-live');
    expect(detail.status).toBe('PLANNING');
    expect(detail.liveStatus).toBe('EXECUTION');
    expect((await queries.listTasks())[0].status).toBe('EXECUTION');
  });

  it('never lets an intermediate event reopen a terminal run', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    await store.save({
      ...RUN_BASE,
      taskId: 'task-done',
      workspaceRoot: root,
      status: 'FAILED',
      logSessionId: 'log-2',
      repair: { outcome: 'REPAIR_LIMIT_REACHED', attempts: [] },
    });
    await writeLog(root, 'pipeline-log-2-x.log', [
      { ts: '2026-08-28T10:00:05.000Z', sessionId: 'log-2', phase: 'STEP', role: 'coder', model: 'm', message: 'late step' },
    ]);

    const detail = await queries.getTask('task-done');
    expect(detail.status).toBe('FAILED');
    expect(detail.liveStatus).toBe('FAILED');
    expect(detail.repair?.outcome).toBe('REPAIR_LIMIT_REACHED');
  });

  it('reports invalid and unknown task ids distinctly', async () => {
    const root = await workspace();
    const { queries } = services(root);
    await expect(queries.getTask('../escape')).rejects.toMatchObject({ code: 'INVALID_TASK_ID' });
    await expect(queries.getTask('task-nope')).rejects.toBeInstanceOf(TaskQueryError);
    await expect(queries.getTask('task-nope')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('reports the canonical workspace as read-only', async () => {
    const root = await workspace();
    expect(services(root).queries.workspace()).toEqual({ workspaceRoot: root, readOnly: true });
  });

  it('produces a change token that moves when runs or logs change', async () => {
    const root = await workspace();
    const { store, queries } = services(root);
    expect(await queries.changeToken()).toBe(0);
    await store.save({ ...RUN_BASE, taskId: 'task-t', workspaceRoot: root, status: 'COMPLETED' });
    expect(await queries.changeToken()).toBeGreaterThan(0);
  });
});
