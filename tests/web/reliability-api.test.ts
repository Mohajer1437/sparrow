import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { FileReliabilityStore } from '../../src/app/file-reliability-store';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { ReliabilityService } from '../../src/app/reliability-service';
import { TaskQueryService } from '../../src/app/task-query-service';
import { StartedWebServer, createWebServer } from '../../src/web/web-server';
import { aggregateReliability } from '../../src/core/reliability/reliability-aggregator';
import {
  makeBlockedSnapshot,
  makeRepairedSnapshot,
  makeSnapshot,
} from '../core/reliability/fixtures/reliability-fixtures';

let root: string;
let server: StartedWebServer;
let base: string;

async function get(pathname: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${pathname}`);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-reliability-web-'));
  const runs = new FileTaskRunStore(root);
  await runs.save(makeSnapshot({ taskId: 'run-a' }));
  await runs.save(makeRepairedSnapshot({ taskId: 'run-b' }));
  await runs.save(makeBlockedSnapshot({ taskId: 'run-c' }));
  await runs.save(makeSnapshot({ taskId: 'run-d', verification: undefined }));

  const queries = new TaskQueryService(runs, new PipelineEventReader(root), root);
  const reliability = new ReliabilityService(runs, new FileReliabilityStore(root), root);

  const { listen } = createWebServer(queries, { port: 0 }, reliability);
  server = await listen();
  base = server.url;
});

afterAll(async () => {
  await server?.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('Reliability Web API (G.30)', () => {
  it('serves the aggregate report', async () => {
    const { status, body } = await get('/api/reliability?minSample=1');
    expect(status).toBe(200);
    expect(body.totals.allRuns).toBe(4);
    expect(body.outcomes.SUCCESS).toBe(1);
    expect(body.outcomes.SUCCESS_AFTER_REPAIR).toBe(1);
    expect(body.outcomes.BLOCKED).toBe(1);
    expect(body.outcomes.SUCCESS_WITH_INSUFFICIENT_EVIDENCE).toBe(1);
  });

  it('returns the same numbers the application service computes', async () => {
    const reliability = new ReliabilityService(
      new FileTaskRunStore(root),
      new FileReliabilityStore(root),
      root,
    );
    const records = await reliability.listRecords();
    const expected = aggregateReliability(records, { minSampleSize: 5, population: 'ALL_RUNS' });
    const { body } = await get('/api/reliability');

    expect(body.totals).toEqual(expected.totals);
    expect(body.outcomes).toEqual(expected.outcomes);
    expect(body.rates.map((rate: any) => [rate.name, rate.numerator, rate.denominator]))
      .toEqual(expected.rates.map(rate => [rate.name, rate.numerator, rate.denominator]));
  });

  it('exposes every rate with its numerator, denominator and formula', async () => {
    const { body } = await get('/api/reliability?minSample=1');
    for (const rate of body.rates) {
      expect(typeof rate.numerator).toBe('number');
      expect(typeof rate.denominator).toBe('number');
      expect(typeof rate.formula).toBe('string');
      expect(rate.formula.length).toBeGreaterThan(0);
      expect(rate.percent).toBeDefined();
    }
  });

  it('applies population and window filters', async () => {
    const planning = await get('/api/reliability?population=PLANNING_ONLY');
    expect(planning.body.totals.allRuns).toBe(0);

    const day = await get('/api/reliability?window=24h');
    expect(day.body.period.window).toBe('24h');
    expect(day.body.period.from).toBeDefined();
  });

  it('falls back to safe defaults for unrecognized query parameters', async () => {
    const { status, body } = await get('/api/reliability?window=fortnight&population=EVERYTHING');
    expect(status).toBe(200);
    expect(body.period.window).toBe('all');
    expect(body.filters.population).toBe('ALL_RUNS');
  });

  it('serves a single reliability record', async () => {
    const { status, body } = await get('/api/reliability/runs/run-a');
    expect(status).toBe(200);
    expect(body.taskId).toBe('run-a');
    expect(body.outcome).toBe('SUCCESS');
    expect(body.evidenceCompleteness.verification).toBe('COMPLETE');
  });

  it('serves the drill-down for a metric', async () => {
    const { status, body } = await get('/api/reliability/metrics/firstPassSuccessRate?minSample=1');
    expect(status).toBe(200);
    expect(body.metric).toBe('firstPassSuccessRate');
    expect(body.numeratorRuns.map((run: any) => run.taskId)).toEqual(['run-a']);
    expect(body.denominatorRuns.length).toBe(body.rate.denominator);
  });

  it('explains a suspicious success', async () => {
    const { status, body } = await get('/api/reliability/suspicion/run-d');
    expect(status).toBe(200);
    expect(body.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
    expect(body.missingChecks).toBe(1);
    expect(body.conclusion).toContain('cannot be fully trusted');
  });

  it('returns 404 for an unknown run and 400 for an invalid id', async () => {
    expect((await get('/api/reliability/runs/does-not-exist')).status).toBe(404);
    expect((await get('/api/reliability/runs/..%2Fescape')).status).toBe(400);
  });

  it('stays read-only', async () => {
    const res = await fetch(`${base}/api/reliability`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
