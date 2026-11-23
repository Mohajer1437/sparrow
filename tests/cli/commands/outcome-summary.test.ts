import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../../src/app/task-query-service';
import { TaskExecutionService } from '../../../src/app/task-execution-service';
import { buildTaskOutcomeSummary } from '../../../src/app/outcome-summary-builder';
import { formatOutcomeSummaryText } from '../../../src/domain/task-outcome-summary';
import { makeWorkflowResult } from '../../app/fixtures/run-fixtures';
import { DEFAULT_WORKSPACE_SNAPSHOT_BUDGET } from '../../../src/domain/execution/workspace-evidence';

describe('CLI & REPL Outcome Summary Parity (UX-OUTCOME.12, UX-OUTCOME.13, UX-OUTCOME.15)', () => {
  let root: string;
  let taskStore: FileTaskRunStore;
  let queryService: TaskQueryService;
  let execService: TaskExecutionService;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-cli-outcome-'));
    taskStore = new FileTaskRunStore(root);
    const eventReader = new PipelineEventReader(root);
    queryService = new TaskQueryService(taskStore, eventReader, root);

    execService = new TaskExecutionService(
      {
        execute: async (req: any) => {
          return {
            roleId: req.roleId ?? 'coder',
            success: true,
            workflowResult: makeWorkflowResult({
              sessionId: req.sessionId,
              workspaceComparison: {
                state: 'PROVEN',
                basis: 'HASH_COMPARISON',
                intendedFiles: ['src/index.ts'],
                intendedChangedFiles: ['src/index.ts'],
                actualChangedFiles: ['src/index.ts'],
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
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('produces identical outcome summary across Application, Query, CLI, and REPL views', async () => {
    const outcome = await execService.execute({
      task: 'Update index.ts',
      executionMode: 'STANDARD',
    });

    // 1. Direct from execution outcome
    const directSummary = outcome.outcomeSummary!;
    expect(directSummary).toBeDefined();
    expect(directSummary.status).toBe('SUCCESS');
    expect(directSummary.changedFiles).toEqual(['src/index.ts']);

    // 2. From TaskQueryService
    const querySummary = await queryService.getOutcomeSummary(outcome.taskId, outcome.runId);
    expect(querySummary).toEqual(directSummary);

    // 3. From TaskSummaryView in list
    const list = await queryService.listTasks(10);
    const taskItem = list.find((t) => t.taskId === outcome.taskId);
    expect(taskItem?.outcomeSummary).toEqual(directSummary);

    // 4. Formatted text block
    const formatted = formatOutcomeSummaryText(querySummary);
    expect(formatted).toContain('TASK RESULT');
    expect(formatted).toContain('✓ Task completed successfully.');
    expect(formatted).toContain('src/index.ts');
    expect(formatted).toContain(`Run: ${outcome.runId}`);
  });
});
