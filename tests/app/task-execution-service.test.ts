import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { TaskExecutionService } from '../../src/app/task-execution-service';
import { AgentOrchestrator } from '../../src/contracts/agent-orchestrator';
import { makeFailureContract, makeRepairHistory, makeWorkflowResult } from './fixtures/run-fixtures';

async function tempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-run-'));
}

function orchestrator(result: unknown, calls: unknown[] = []): AgentOrchestrator {
  return {
    execute: async (request) => {
      calls.push(request);
      return result as any;
    },
  };
}

describe('task execution service', () => {
  it('records a run that observers can read back', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    const calls: unknown[] = [];
    const service = new TaskExecutionService(
      orchestrator({ roleId: 'coder', success: true, workflowResult: makeWorkflowResult() }, calls),
      store,
      root,
      { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    );

    const outcome = await service.execute({ task: 'Inspect app/page.tsx' });

    expect(calls[0]).toMatchObject({
      roleId: 'coder', task: 'Inspect app/page.tsx', targetFiles: undefined, executionMode: 'STANDARD',
    });
    expect(outcome.snapshot.status).toBe('COMPLETED');
    expect(outcome.runId).toBeDefined();

    const stored = await store.get(outcome.taskId);
    expect(stored?.taskId).toBe(outcome.taskId);
    expect(stored?.runId).toBe(outcome.runId);
    expect(stored?.todoPlan?.todos.map(todo => todo.id)).toEqual(['todo-1', 'todo-2']);

    const context = await store.getContextContent(outcome.taskId);
    expect(context?.items.some(item => item.reference === 'app/page.tsx')).toBe(true);
  });

  it('records the core reported repair outcome without reinterpreting it', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    const service = new TaskExecutionService(
      orchestrator({
        roleId: 'coder',
        success: false,
        error: 'REPAIR_LIMIT_REACHED',
        workflowResult: makeWorkflowResult({
          success: false,
          repairOutcome: 'REPAIR_LIMIT_REACHED',
          abortReason: 'REPAIR_LIMIT_REACHED',
          failureContract: makeFailureContract(),
          repairAttemptHistory: makeRepairHistory(),
        }),
      }),
      store,
      root,
    );

    const outcome = await service.execute({ task: 'Add a JSX comment' });
    expect(outcome.snapshot.status).toBe('FAILED');
    expect(outcome.snapshot.repair?.outcome).toBe('REPAIR_LIMIT_REACHED');
    expect(outcome.snapshot.repair?.attempts).toHaveLength(2);
  });

  it('records a snapshot before the pipeline finishes', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    let observedDuringRun: string | undefined;
    const service = new TaskExecutionService(
      {
        execute: async () => {
          const runs = await store.list();
          observedDuringRun = runs[0]?.status;
          return { roleId: 'coder', success: true, workflowResult: makeWorkflowResult() } as any;
        },
      },
      store,
      root,
    );

    await service.execute({ task: 'Inspect app/page.tsx' });
    expect(observedDuringRun).toBe('PLANNING');
  });

  it('still surfaces the orchestrator error when a run throws', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    const service = new TaskExecutionService(
      { execute: async () => { throw new Error('provider offline'); } },
      store,
      root,
    );

    await expect(service.execute({ task: 'boom' })).rejects.toThrow('provider offline');
    const runs = await store.list();
    expect(runs[0].status).toBe('FAILED');
    expect(runs[0].error).toBe('provider offline');
  });

  it('does not fail a run when recording fails', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    jest.spyOn(store, 'save').mockRejectedValue(new Error('disk full'));
    const service = new TaskExecutionService(
      orchestrator({ roleId: 'coder', success: true, workflowResult: makeWorkflowResult() }),
      store,
      root,
    );

    const outcome = await service.execute({ task: 'Inspect app/page.tsx' });
    expect(outcome.result.success).toBe(true);
  });
});

describe('file task run store', () => {
  it('rejects task ids that could escape the runs directory', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    expect(await store.get('../../etc/passwd')).toBeNull();
    expect(await store.get('task/../../x')).toBeNull();
    expect(await store.getContextContent('..')).toBeNull();
  });

  it('returns empty results for a workspace with no recorded runs', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    expect(await store.list()).toEqual([]);
    expect(await store.lastModified()).toBe(0);
  });

  it('ignores unreadable or malformed run files', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    await fs.mkdir(path.join(root, '.ai', 'runs'), { recursive: true });
    await fs.writeFile(path.join(root, '.ai', 'runs', 'broken.run.json'), '{not json', 'utf8');
    expect(await store.list()).toEqual([]);
  });

  it('lists newest runs first', async () => {
    const root = await tempWorkspace();
    const store = new FileTaskRunStore(root);
    const base = {
      task: 't', roleId: 'coder', workspaceRoot: root, status: 'COMPLETED' as const,
      skills: [], context: [], execution: [], touchedFiles: [],
    };
    await store.save({ ...base, taskId: 'task-a', startedAt: '2026-08-28T10:00:00.000Z' });
    await store.save({ ...base, taskId: 'task-b', startedAt: '2026-08-28T11:00:00.000Z' });
    expect((await store.list()).map(run => run.taskId)).toEqual(['task-b', 'task-a']);
  });
});
