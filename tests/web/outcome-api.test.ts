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
import { DEFAULT_WORKSPACE_SNAPSHOT_BUDGET } from '../../src/domain/execution/workspace-evidence';

describe('Web API Outcome Summary Endpoints (UX-OUTCOME.14, UX-OUTCOME.15)', () => {
  let root: string;
  let server: StartedWebServer;
  let base: string;
  let commandService: ApplicationCommandService;
  let taskStore: FileTaskRunStore;

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
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-outcome-test-'));
    taskStore = new FileTaskRunStore(root);
    const eventReader = new PipelineEventReader(root);
    const queryService = new TaskQueryService(taskStore, eventReader, root);

    const execService = new TaskExecutionService(
      {
        execute: async (req: any) => {
          if (req.task.includes('FAIL_VERIFICATION')) {
            return {
              roleId: req.roleId ?? 'coder',
              success: false,
              workflowResult: makeWorkflowResult({
                sessionId: req.sessionId,
                success: false,
                verificationReport: {
                  status: 'FAILED',
                  overallVerdict: 'FAILED',
                  passed: false,
                  summary: 'deterministic-build failed',
                  failures: ['deterministic-build'],
                  verdicts: [],
                  checks: [
                    {
                      id: 'check-1',
                      name: 'deterministic-build',
                      category: 'BUILD',
                      passed: false,
                      required: true,
                      source: 'test-runner',
                    },
                  ],
                } as any,
              }),
            };
          }
          return {
            roleId: req.roleId ?? 'coder',
            success: true,
            workflowResult: makeWorkflowResult({
              sessionId: req.sessionId,
              workspaceComparison: {
                state: 'PROVEN',
                basis: 'HASH_COMPARISON',
                intendedFiles: ['app/page.tsx'],
                intendedChangedFiles: ['app/page.tsx'],
                actualChangedFiles: ['app/page.tsx'],
                unintendedChangedFiles: [],
                missingExpectedChanges: [],
                preExistingDirtyFiles: [],
                createdFiles: [],
                deletedFiles: [],
                wrongFileModification: 'NOT_PROVEN',
                changes: [],
                budget: DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
              },
            }),
          };
        },
      } as any,
      taskStore,
      root,
    );

    const confStore = new FileConfirmationStore(root);
    const confPolicy = new ConfirmationPolicy();
    const confService = new ConfirmationService(confStore, confPolicy);
    const relStore = new FileReliabilityStore(root);
    const relService = new ReliabilityService(taskStore, relStore, root);
    const secretHolder = new RuntimeSecretHolder();

    commandService = new ApplicationCommandService(
      execService,
      queryService,
      confService,
      relService,
      root,
      secretHolder,
    );

    const web = createWebServer(commandService, { port: 0, host: '127.0.0.1', pollIntervalMs: 50 });
    server = await web.listen();
    base = server.url;
  });

  afterAll(async () => {
    if (server) await server.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('serves task outcome summary at GET /api/v1/tasks/:taskId/outcome', async () => {
    const startRes = await post('/api/v1/tasks/execute', {
      task: 'Successful task mutation',
      executionMode: 'STANDARD',
      waitForCompletion: true,
    });
    expect(startRes.status).toBe(200);
    const taskId = startRes.body.taskId;
    const runId = startRes.body.runId;

    const outcomeRes = await get(`/api/v1/tasks/${taskId}/outcome`);
    expect(outcomeRes.status).toBe(200);
    expect(outcomeRes.body.status).toBe('SUCCESS');
    expect(outcomeRes.body.reasonCode).toBe('TASK_COMPLETED');
    expect(outcomeRes.body.changedFiles).toEqual(['app/page.tsx']);
    expect(outcomeRes.body.taskId).toBe(taskId);
    expect(outcomeRes.body.runId).toBe(runId);
  });

  it('serves run outcome summary at GET /api/v1/runs/:runId/outcome', async () => {
    const startRes = await post('/api/v1/tasks/execute', {
      task: 'Task with verification failure: FAIL_VERIFICATION',
      executionMode: 'STANDARD',
      waitForCompletion: true,
    });
    expect(startRes.status).toBe(200);
    const runId = startRes.body.runId;

    const outcomeRes = await get(`/api/v1/runs/${runId}/outcome`);
    expect(outcomeRes.status).toBe(200);
    expect(outcomeRes.body.status).toBe('FAILED');
    expect(outcomeRes.body.reasonCode).toBe('VERIFICATION_FAILED');
    expect(outcomeRes.body.failurePrimaryCheck).toBe('deterministic-build');
    expect(outcomeRes.body.runId).toBe(runId);
  });

  it('serves task-run outcome summary at GET /api/v1/tasks/:taskId/runs/:runId/outcome', async () => {
    const startRes = await post('/api/v1/tasks/execute', {
      task: 'Successful task mutation 2',
      executionMode: 'STANDARD',
      waitForCompletion: true,
    });
    const { taskId, runId } = startRes.body;

    const outcomeRes = await get(`/api/v1/tasks/${taskId}/runs/${runId}/outcome`);
    expect(outcomeRes.status).toBe(200);
    expect(outcomeRes.body.status).toBe('SUCCESS');
    expect(outcomeRes.body.taskId).toBe(taskId);
    expect(outcomeRes.body.runId).toBe(runId);
  });
});
