import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { FileReliabilityStore } from '../../src/app/file-reliability-store';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { ReliabilityService } from '../../src/app/reliability-service';
import { buildReliabilityRecord } from '../../src/core/reliability/reliability-record-builder';
import { RELIABILITY_SCHEMA_VERSION } from '../../src/domain/reliability';
import { TaskRunSnapshot } from '../../src/domain/task-run';
import {
  makeBlockedSnapshot,
  makeRepairedSnapshot,
  makeSnapshot,
} from '../core/reliability/fixtures/reliability-fixtures';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-reliability-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function createService(): ReliabilityService {
  return new ReliabilityService(
    new FileTaskRunStore(workspace),
    new FileReliabilityStore(workspace),
    workspace,
  );
}

async function seed(...snapshots: ReadonlyArray<TaskRunSnapshot>): Promise<void> {
  const store = new FileTaskRunStore(workspace);
  for (const snapshot of snapshots) await store.save(snapshot);
}

const recordPath = (taskId: string) =>
  path.join(workspace, '.ai', 'reliability', `${taskId}.reliability.json`);

describe('Reliability persistence (G.27, G.28, G.33)', () => {
  it('derives records from task-run snapshots and persists them', async () => {
    await seed(makeSnapshot());
    const records = await createService().listRecords();

    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe('SUCCESS');
    const stored = JSON.parse(await fs.readFile(recordPath('task-1'), 'utf8'));
    expect(stored.schemaVersion).toBe(RELIABILITY_SCHEMA_VERSION);
    expect(stored.taskId).toBe('task-1');
  });

  it('reads persisted records after a simulated process restart', async () => {
    await seed(makeSnapshot());
    await createService().listRecords();

    // A brand new service instance holds no in-memory state.
    const afterRestart = await createService().listRecords();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0].taskId).toBe('task-1');
    expect(afterRestart[0].outcome).toBe('SUCCESS');
  });

  it('retains a record whose task-run snapshot was pruned', async () => {
    await seed(makeSnapshot());
    await createService().listRecords();

    await fs.rm(path.join(workspace, '.ai', 'runs'), { recursive: true, force: true });

    const records = await createService().listRecords();
    expect(records.map(record => record.taskId)).toEqual(['task-1']);
  });

  it('rebuilds a record when the snapshot progressed after it was written', async () => {
    await seed(makeSnapshot({ status: 'FAILED', completedAt: undefined }));
    const first = await createService().listRecords();
    expect(first[0].outcome).toBe('FAILED');

    // The run was repaired and re-recorded as completed.
    await seed(makeRepairedSnapshot({ taskId: 'task-1' }));
    const second = await createService().listRecords();
    expect(second[0].outcome).toBe('SUCCESS_AFTER_REPAIR');
  });

  it('ignores a record written by an incompatible schema version', async () => {
    await seed(makeSnapshot());
    const store = new FileReliabilityStore(workspace);
    await store.save({
      ...buildReliabilityRecord(makeSnapshot()),
      schemaVersion: RELIABILITY_SCHEMA_VERSION + 1,
      outcome: 'FAILED',
    });

    expect(await store.get('task-1')).toBeNull();
    // The service falls back to the snapshot, which is the source of truth.
    const records = await createService().listRecords();
    expect(records[0].outcome).toBe('SUCCESS');
  });

  it('ignores a truncated record file instead of trusting part of it', async () => {
    await seed(makeSnapshot());
    await createService().listRecords();
    await fs.writeFile(recordPath('task-1'), '{"schemaVersion":1,"taskId":"task-1"', 'utf8');

    const store = new FileReliabilityStore(workspace);
    expect(await store.get('task-1')).toBeNull();
    expect(await store.list()).toEqual([]);

    const records = await createService().listRecords();
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe('SUCCESS');
  });

  it('ignores a structurally incomplete record', async () => {
    await fs.mkdir(path.dirname(recordPath('partial')), { recursive: true });
    await fs.writeFile(recordPath('partial'), JSON.stringify({
      schemaVersion: RELIABILITY_SCHEMA_VERSION,
      taskId: 'partial',
      startedAt: '2026-08-28T10:00:00.000Z',
      outcome: 'SUCCESS',
      populations: ['ALL_RUNS'],
    }), 'utf8');

    expect(await new FileReliabilityStore(workspace).list()).toEqual([]);
  });

  it('keeps measuring when the reliability store cannot be written', async () => {
    await seed(makeSnapshot());
    const failing = {
      save: async () => { throw new Error('read-only filesystem'); },
      get: async () => { throw new Error('read-only filesystem'); },
      list: async () => { throw new Error('read-only filesystem'); },
    };
    const service = new ReliabilityService(
      new FileTaskRunStore(workspace),
      failing,
      workspace,
    );
    const records = await service.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe('SUCCESS');
  });

  it('rejects a task id that would escape the reliability directory', async () => {
    const store = new FileReliabilityStore(workspace);
    await expect(store.save({
      ...buildReliabilityRecord(makeSnapshot()),
      taskId: '../escape',
    })).rejects.toThrow('Invalid task id');
  });
});

describe('Reliability service reads (G.29-G.32)', () => {
  it('counts each run once even when a persisted record and a snapshot both exist', async () => {
    await seed(makeSnapshot());
    await createService().listRecords();
    const records = await createService().listRecords();
    expect(records.filter(record => record.taskId === 'task-1')).toHaveLength(1);
  });

  it('produces a report whose totals match the stored runs', async () => {
    await seed(
      makeSnapshot({ taskId: 'run-a' }),
      makeRepairedSnapshot({ taskId: 'run-b' }),
      makeBlockedSnapshot({ taskId: 'run-c' }),
    );
    const report = await createService().getReport({ minSampleSize: 1 });

    expect(report.totals.allRuns).toBe(3);
    expect(report.outcomes.SUCCESS).toBe(1);
    expect(report.outcomes.SUCCESS_AFTER_REPAIR).toBe(1);
    expect(report.outcomes.BLOCKED).toBe(1);
    const firstPass = report.rates.find(rate => rate.name === 'firstPassSuccessRate')!;
    expect(firstPass).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('traces a metric back to the contributing runs', async () => {
    await seed(makeSnapshot({ taskId: 'run-a' }), makeRepairedSnapshot({ taskId: 'run-b' }));
    const view = await createService().getContribution('firstPassSuccessRate', { minSampleSize: 1 });

    expect(view.rate.numerator).toBe(1);
    expect(view.numeratorRuns.map(run => run.taskId)).toEqual(['run-a']);
    expect(view.denominatorRuns.map(run => run.taskId).sort()).toEqual(['run-a', 'run-b']);
    expect(view.denominatorRuns[0].outcomeReason).toBeTruthy();
  });

  it('rejects an unknown metric name', async () => {
    await seed(makeSnapshot());
    await expect(createService().getContribution('madeUpRate')).rejects.toThrow(
      'Unknown reliability metric',
    );
  });

  it('explains why a success is not trusted', async () => {
    await seed(makeSnapshot({ taskId: 'run-x', verification: undefined }));
    const detail = await createService().getSuspicionDetail('run-x');

    expect(detail.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
    expect(detail.verificationStatus).toBe('NOT_RUN');
    expect(detail.requiredChecks).toBe(1);
    expect(detail.executedChecks).toBe(0);
    expect(detail.missingChecks).toBe(1);
    expect(detail.findings.map(finding => finding.code)).toContain('VERIFICATION_NOT_RUN');
    expect(detail.conclusion).toContain('cannot be fully trusted');
  });

  it('reports no suspicion for a clean run', async () => {
    await seed(makeSnapshot({ taskId: 'run-clean' }));
    const detail = await createService().getSuspicionDetail('run-clean');
    expect(detail.findings).toEqual([]);
    expect(detail.conclusion).toContain('No suspicion findings');
  });

  it('rejects an invalid task id and reports a missing run', async () => {
    const service = createService();
    await expect(service.getRecord('../etc/passwd')).rejects.toThrow('Invalid task id');
    await expect(service.getRecord('missing-task')).rejects.toThrow('Task not found');
  });

  it('reports an empty dataset without inventing metrics', async () => {
    const report = await createService().getReport();
    expect(report.totals.allRuns).toBe(0);
    expect(report.rates.every(rate => rate.ratio === null)).toBe(true);
  });
});
