import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';
import {
  makeFailureContract,
  makeRepairHistory,
  makeVerificationReport,
  makeWorkflowResult,
} from '../app/fixtures/run-fixtures';

let root: string;
let server: StartedWebServer;
let base: string;
let completedTaskId: string;
let failedTaskId: string;

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-web-'));
  const store = new FileTaskRunStore(root);

  const completed = new TaskExecutionService(
    { execute: async () => ({ roleId: 'coder', success: true, workflowResult: makeWorkflowResult() } as any) },
    store,
    root,
    { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
  );
  completedTaskId = (await completed.execute({ task: 'Inspect app/page.tsx' })).taskId;

  const failed = new TaskExecutionService(
    {
      execute: async () => ({
        roleId: 'coder',
        success: false,
        error: 'REPAIR_LIMIT_REACHED',
        workflowResult: makeWorkflowResult({
          success: false,
          verificationReport: makeVerificationReport(false),
          failureContract: makeFailureContract(),
          repairAttemptHistory: makeRepairHistory(),
          repairOutcome: 'REPAIR_LIMIT_REACHED',
          abortedAt: 'verification',
          abortReason: 'REPAIR_LIMIT_REACHED',
          stepResults: [
            { stepId: 'step-1', success: true, completedAt: '2026-08-28T10:01:00.000Z' },
            { stepId: 'step-2', success: false, error: 'tsc failed', completedAt: '2026-08-28T10:02:00.000Z' },
          ],
        }),
      } as any),
    },
    store,
    root,
    { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
  );
  failedTaskId = (await failed.execute({ task: 'Add a JSX comment' })).taskId;

  const queries = new TaskQueryService(store, new PipelineEventReader(root), root);
  server = await createWebServer(queries, { port: 0, pollIntervalMs: 50 }).listen();
  base = server.url;
});

afterAll(async () => {
  await server?.close();
});

describe('web api: application boundary', () => {
  it('exposes health and the canonical workspace root as read-only', async () => {
    expect(await get('/api/health')).toEqual({
      status: 200,
      body: { status: 'ok', readOnly: true, apiVersion: 'v1' },
    });
    const workspace = await get('/api/workspace');
    expect(workspace.body).toEqual({ workspaceRoot: root, readOnly: true });
  });

  it('rejects every mutating method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/api/tasks`, { method });
      expect(res.status).toBe(405);
    }
  });

  it('serves the UI document at the root', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Sparrow');
  });

  it('returns 404 for unknown paths and api routes', async () => {
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/api/nope')).status).toBe(404);
    expect((await get(`/api/tasks/${completedTaskId}/nope`)).status).toBe(404);
  });
});

describe('web api: tasks', () => {
  it('lists recorded runs newest first with status and skills', async () => {
    const { body } = await get('/api/tasks');
    expect(body.tasks).toHaveLength(2);
    const [newest] = body.tasks;
    expect(newest.taskId).toBe(failedTaskId);
    expect(newest.status).toBe('FAILED');
    expect(newest.repairOutcome).toBe('REPAIR_LIMIT_REACHED');
    expect(newest.skillIds).toContain('frontend.core');
    expect(newest.domain).toBe('frontend');
    expect(newest.startedAt).toBeTruthy();
  });

  it('returns task detail including workspace root and directive', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}`);
    expect(body.taskId).toBe(completedTaskId);
    expect(body.status).toBe('COMPLETED');
    expect(body.liveStatus).toBe('COMPLETED');
    expect(body.workspaceRoot).toBe(root);
    expect(body.project.projectType).toBe('frontend');
    expect(body.executionDirective.requestedDomains).toEqual(['frontend']);
  });

  it('rejects invalid task ids and reports missing ones', async () => {
    const invalid = await get('/api/tasks/..%2F..%2Fetc');
    expect(invalid.status).toBe(400);
    // The shared interface vocabulary names the class of error; the original
    // application code is preserved as detailCode (H.19).
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.detailCode).toBe('INVALID_TASK_ID');

    const missing = await get('/api/tasks/task-does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(missing.body.error.detailCode).toBe('TASK_NOT_FOUND');
  });

  it('reports missing tasks for every sub-resource', async () => {
    for (const view of ['context', 'skills', 'todos', 'execution', 'verification', 'failure', 'repair', 'events']) {
      const res = await get(`/api/tasks/task-missing/${view}`);
      expect(res.status).toBe(404);
      expect(res.body.error.detailCode).toBe('TASK_NOT_FOUND');
    }
  });

  it('falls back to a default limit for malformed query input', async () => {
    const res = await get('/api/tasks?limit=not-a-number');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect((await get('/api/tasks?limit=-4')).body.tasks).toHaveLength(2);
    expect((await get('/api/tasks?limit=1')).body.tasks).toHaveLength(1);
  });
});

describe('web api: context', () => {
  it('exposes strategy, provenance, truncation and missing state without file bodies', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/context`);
    expect(body.strategy.selectedSources.length).toBeGreaterThan(0);
    expect(body.totals.records).toBe(3);
    expect(body.plannerContextSummary).toContain('repairMode=false');

    const collected = body.items.find((item: any) => item.reference === 'app/page.tsx');
    expect(collected.status).toBe('COLLECTED');
    expect(collected.priority).toBe(1);
    expect(collected.reason).toBe('explicitly referenced by task');
    expect(collected.truncated).toBe(true);
    expect(collected.hasContent).toBe(true);

    const failedItem = body.items.find((item: any) => item.reference === 'app/missing.tsx');
    expect(failedItem.status).toBe('FAILED');
    expect(failedItem.error).toContain('ENOENT');

    expect(JSON.stringify(body)).not.toContain('export default function Home');
  });

  it('does not present excluded context as selected', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/context`);
    const excluded = body.items.find((item: any) => item.reference === '.ai/knowledge/codebase-map.md');
    expect(excluded.status).toBe('EXCLUDED');
    expect(excluded.hasContent).toBe(false);
    expect(body.strategy.selectedSources).not.toContain('CODEBASE_MAP');
  });

  it('serves a single context item body only on request, redacted', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/context/0`);
    expect(body.item.reference).toBe('app/page.tsx');
    expect(body.contentAvailable).toBe(true);
    expect(body.content).toContain('export default function Home');
    expect(body.content).not.toContain('sk-abcdefghijklmnop');
  });

  it('validates the context index', async () => {
    expect((await get(`/api/tasks/${completedTaskId}/context/abc`)).status).toBe(400);
    const missing = await get(`/api/tasks/${completedTaskId}/context/99`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.detailCode).toBe('CONTEXT_ITEM_NOT_FOUND');
  });

  it('reports items that were never collected as having no content', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/context/2`);
    expect(body.item.status).toBe('EXCLUDED');
    expect(body.contentAvailable).toBe(false);
    expect(body.content).toBeUndefined();
  });
});

describe('web api: skills', () => {
  it('exposes resolved skills with their resolution provenance', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/skills`);
    expect(body.resolutionMode).toBe('rules');
    const skill = body.skills.find((item: any) => item.id === 'frontend.core');
    expect(skill).toBeDefined();
    expect(skill.domain).toBe('frontend');
    expect(skill.resolutionSource).toBe('system-rule');
    expect(skill.resolutionDetail).toContain('frontend');
    expect(Array.isArray(skill.requiredChecks)).toBe(true);
  });
});

describe('web api: todos', () => {
  it('serializes the TodoPlan with stable ids, order and dependencies', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/todos`);
    expect(body.todoPlan.goal).toContain('app/page.tsx');
    expect(body.todoPlan.todos.map((todo: any) => todo.id)).toEqual(['todo-1', 'todo-2']);
    expect(body.todoPlan.todos[1].dependencies).toEqual(['todo-1']);
    expect(body.todoPlan.todos[0].skillIds).toEqual(['frontend.core']);
    expect(body.todoPlan.todos[0].verificationRequirements).toEqual(['typecheck']);
    expect(body.todoPlan.todos[0].risk).toBe('LOW');
    expect(body.todoPlan.affectedFiles).toEqual(['app/page.tsx']);
  });

  it('maps todos to execution steps and keeps unknown verdicts unknown', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/todos`);
    expect(body.todoStatuses).toEqual([
      {
        todoId: 'todo-1',
        executionStatus: 'SUCCEEDED',
        stepIds: ['step-1'],
        verificationVerdict: 'UNKNOWN',
        verificationScope: 'WHOLE_RUN',
        verificationReason: 'verification evidence is whole-run',
      },
      {
        todoId: 'todo-2',
        executionStatus: 'SUCCEEDED',
        stepIds: ['step-2'],
        verificationVerdict: 'UNKNOWN',
        verificationScope: 'WHOLE_RUN',
        verificationReason: 'verification evidence is whole-run',
      },
    ]);
  });
});

describe('web api: execution', () => {
  it('preserves the todo to step identity and reports step errors', async () => {
    const { body } = await get(`/api/tasks/${failedTaskId}/execution`);
    expect(body.steps.map((step: any) => [step.stepId, step.sourceTodoId, step.status])).toEqual([
      ['step-1', 'todo-1', 'SUCCEEDED'],
      ['step-2', 'todo-2', 'FAILED'],
    ]);
    expect(body.steps[1].error).toBe('tsc failed');
    expect(body.abortedAt).toBe('verification');
    expect(body.abortReason).toBe('REPAIR_LIMIT_REACHED');
    expect(body.touchedFiles).toEqual(['app/page.tsx']);
  });

  it('leaks no secrets in any execution or verification payload', async () => {
    const payloads = await Promise.all([
      get(`/api/tasks/${failedTaskId}`),
      get(`/api/tasks/${failedTaskId}/execution`),
      get(`/api/tasks/${failedTaskId}/verification`),
      get(`/api/tasks/${failedTaskId}/failure`),
      get(`/api/tasks/${failedTaskId}/repair`),
    ]);
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain('Bearer abcdefghijklmnop');
    expect(serialized).not.toContain('sk-abcdefghijklmnop');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('web api: verification', () => {
  it('reports whole-run evidence without fabricating todo verdicts', async () => {
    const { body } = await get(`/api/tasks/${failedTaskId}/verification`);
    expect(body.available).toBe(true);
    expect(body.verification.passed).toBe(false);
    expect(body.verification.scope).toBe('WHOLE_RUN');
    expect(body.verification.checks[0].id).toBe('check-typecheck');
    expect(body.verification.todoVerdicts.every((v: any) => v.verdict === 'UNKNOWN')).toBe(true);
    expect(body.verification.todoVerdicts[0].reason).toBe('verification evidence is whole-run');
  });

  it('reports a passing whole-run report as passed but still not todo-specific', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/verification`);
    expect(body.verification.passed).toBe(true);
    expect(body.verification.scope).toBe('WHOLE_RUN');
    expect(body.verification.todoVerdicts.map((v: any) => v.verdict)).toEqual(['UNKNOWN', 'UNKNOWN']);
  });
});

describe('web api: failure and repair', () => {
  it('keeps primary, secondary and incidental failures separate', async () => {
    const { body } = await get(`/api/tasks/${failedTaskId}/failure`);
    expect(body.available).toBe(true);
    expect(body.failure.primary.checkId).toBe('check-typecheck');
    expect(body.failure.secondary.map((item: any) => item.checkId)).toEqual(['check-lint']);
    expect(body.failure.incidental.map((item: any) => item.checkId)).toEqual(['check-console']);
    expect(body.failure.failedTodoId).toBe('todo-2');
    expect(body.failure.failedStepId).toBe('step-2');
    expect(body.failure.attemptId).toBe('attempt-1');
    expect(body.failure.evidenceRefs).toEqual(['check-typecheck']);
  });

  it('reports every repair attempt, its outcome and the applied limits', async () => {
    const { body } = await get(`/api/tasks/${failedTaskId}/repair`);
    expect(body.available).toBe(true);
    expect(body.repair.outcome).toBe('REPAIR_LIMIT_REACHED');
    expect(body.repair.attempts.map((attempt: any) => attempt.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(body.repair.attempts[0].failedTodoId).toBe('todo-2');
    expect(body.repair.attempts[1].expansionLevel).toBe(1);
    expect(body.repair.attempts[1].outcome).toBe('LIMIT_REACHED');
    expect(body.repair.limits.maxRepairAttempts).toBe(2);
  });

  it('says so when a successful run has no failure or repair record', async () => {
    expect((await get(`/api/tasks/${completedTaskId}/failure`)).body).toMatchObject({ available: false });
    expect((await get(`/api/tasks/${completedTaskId}/repair`)).body).toMatchObject({ available: false });
  });
});

describe('web api: events and live updates', () => {
  it('returns an empty event list when no log exists for the session', async () => {
    const { body } = await get(`/api/tasks/${completedTaskId}/events`);
    expect(body.sessionId).toBeDefined();
    expect(body.events).toEqual([]);
  });

  it('reads structured events written by the pipeline logger', async () => {
    const dir = path.join(root, '.ai', 'logs', 'pipeline');
    await fs.mkdir(dir, { recursive: true });
    // A run only claims events at or after its own start time.
    const startedAt = (await get(`/api/tasks/${completedTaskId}`)).body.startedAt as string;
    expect(startedAt).toBeTruthy();
    await fs.writeFile(
      path.join(dir, 'pipeline-session-abc-1.log'),
      [
        JSON.stringify({ ts: startedAt, sessionId: 'session-abc', phase: 'TODO_PLAN', role: 'planner', model: 'qwen', message: 'plan validated' }),
        JSON.stringify({ ts: startedAt, sessionId: 'session-abc', phase: 'REPAIR_ATTEMPT', role: 'planner', model: 'qwen', message: 'Starting repair attempt 1' }),
      ].join('\n') + '\n',
      'utf8',
    );
    const { body } = await get(`/api/tasks/${completedTaskId}/events`);
    expect(body.events.map((item: any) => item.phase)).toEqual(['TODO_PLAN', 'REPAIR_ATTEMPT']);
    const incremental = await get(`/api/tasks/${completedTaskId}/events?sinceSeq=1`);
    expect(incremental.body.events.map((item: any) => item.phase)).toEqual(['REPAIR_ATTEMPT']);
  });

  it('never lets live events override a terminal status recorded by the core', async () => {
    const { body } = await get(`/api/tasks/${failedTaskId}`);
    expect(body.status).toBe('FAILED');
    expect(body.liveStatus).toBe('FAILED');
    expect(body.repair.outcome).toBe('REPAIR_LIMIT_REACHED');
  });

  it('streams changes over server-sent events and survives disconnects', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !received.includes('event: change')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    expect(received).toContain('event: change');
    const payload = JSON.parse(received.split('data: ')[1].split('\n')[0]);
    expect(payload.tasks.length).toBe(2);

    controller.abort();
    // The server must stay healthy after an observer disappears mid-stream.
    expect((await get('/api/health')).status).toBe(200);
  });

  it('supports repeated observers connecting and reloading', async () => {
    const results = await Promise.all([
      get('/api/tasks'),
      get('/api/tasks'),
      get(`/api/tasks/${completedTaskId}`),
      get(`/api/tasks/${failedTaskId}/repair`),
    ]);
    expect(results.every(result => result.status === 200)).toBe(true);
  });
});
