import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { LEGACY_UNKNOWN_RUN_ID } from '../../src/domain/correlation';

describe('R6 App — Pipeline Event Reader Correlation', () => {
  let tmpDir: string;
  let logDir: string;
  let reader: PipelineEventReader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-event-reader-test-'));
    logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    fs.mkdirSync(logDir, { recursive: true });
    reader = new PipelineEventReader(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('queries events authoritatively by runId (R6.27)', async () => {
    const file1 = path.join(logDir, 'pipeline-sess-1.log');
    const lines = [
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-A-1',
        seq: 1,
        ts: '2026-08-29T10:00:00.000Z',
        taskId: 'task-A',
        runId: 'run-A',
        sessionId: 'sess-1',
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'Plan A',
      }),
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-B-1',
        seq: 1,
        ts: '2026-08-29T10:01:00.000Z',
        taskId: 'task-B',
        runId: 'run-B',
        sessionId: 'sess-1',
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'Plan B',
      }),
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-A-2',
        seq: 2,
        ts: '2026-08-29T10:02:00.000Z',
        taskId: 'task-A',
        runId: 'run-A',
        sessionId: 'sess-1',
        phase: 'EXECUTION',
        role: 'coder',
        model: 'm',
        message: 'Exec A',
      }),
    ];
    fs.writeFileSync(file1, lines.join('\n'));

    const runAEvents = await reader.read({ runId: 'run-A' });
    expect(runAEvents.length).toBe(2);
    expect(runAEvents.map((e) => e.eventId)).toEqual(['evt-run-A-1', 'evt-run-A-2']);
    expect(runAEvents.every((e) => e.runId === 'run-A')).toBe(true);

    const runBEvents = await reader.read({ runId: 'run-B' });
    expect(runBEvents.length).toBe(1);
    expect(runBEvents[0].eventId).toBe('evt-run-B-1');
  });

  it('deduplicates identical events idempotently by eventId (R6.10)', async () => {
    const file1 = path.join(logDir, 'pipeline-part1.log');
    const file2 = path.join(logDir, 'pipeline-part2.log');

    const duplicateEvent = {
      schemaVersion: '1.0',
      eventId: 'evt-run-1-1-fixed',
      seq: 1,
      ts: '2026-08-29T10:00:00.000Z',
      taskId: 'task-1',
      runId: 'run-1',
      sessionId: 'sess-1',
      phase: 'PLANNING',
      role: 'planner',
      model: 'm',
      message: 'Plan 1',
    };

    fs.writeFileSync(file1, JSON.stringify(duplicateEvent));
    fs.writeFileSync(file2, JSON.stringify(duplicateEvent));

    const events = await reader.read({ runId: 'run-1' });
    expect(events.length).toBe(1);
    expect(events[0].eventId).toBe('evt-run-1-1-fixed');
  });

  it('orders out-of-order events deterministically by sequence number (R6.8, R6.9, R6.21)', async () => {
    const file1 = path.join(logDir, 'pipeline-out-of-order.log');
    const lines = [
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-1-3',
        seq: 3,
        ts: '2026-08-29T10:05:00.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        sessionId: 'sess-1',
        phase: 'VERIFICATION',
        role: 'verifier',
        model: 'm',
        message: 'Verification',
      }),
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-1-1',
        seq: 1,
        ts: '2026-08-29T10:01:00.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        sessionId: 'sess-1',
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'Planning',
      }),
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-run-1-2',
        seq: 2,
        ts: '2026-08-29T10:03:00.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        sessionId: 'sess-1',
        phase: 'EXECUTION',
        role: 'coder',
        model: 'm',
        message: 'Execution',
      }),
    ];
    fs.writeFileSync(file1, lines.join('\n'));

    const events = await reader.read({ runId: 'run-1' });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.phase)).toEqual(['PLANNING', 'EXECUTION', 'VERIFICATION']);
  });

  it('parses legacy logs and marks missing runId explicitly as LEGACY_UNKNOWN without fabricating IDs (R6.13, R6.14, R6.15)', async () => {
    const file1 = path.join(logDir, 'pipeline-legacy.log');
    const lines = [
      JSON.stringify({
        ts: '2026-08-01T10:00:00.000Z',
        seq: 1,
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'Legacy plan without runId or taskId',
      }),
      JSON.stringify({
        ts: '2026-08-01T10:01:00.000Z',
        seq: 2,
        taskId: 'task-explicit-in-payload',
        phase: 'EXECUTION',
        role: 'coder',
        model: 'm',
        message: 'Legacy step with taskId only',
      }),
    ];
    fs.writeFileSync(file1, lines.join('\n'));

    const allEvents = await reader.read();
    expect(allEvents.length).toBe(2);

    expect(allEvents[0].isLegacy).toBe(true);
    expect(allEvents[0].runId).toBe(LEGACY_UNKNOWN_RUN_ID);
    expect(allEvents[0].taskId).toBe('UNKNOWN');
    expect(allEvents[0].sessionId).toBeDefined();
    expect(allEvents[0].eventId).toBeDefined();

    expect(allEvents[1].isLegacy).toBe(true);
    expect(allEvents[1].runId).toBe(LEGACY_UNKNOWN_RUN_ID);
    expect(allEvents[1].taskId).toBe('task-explicit-in-payload');
  });

  it('isolates multiple runs within the same session (R6.11)', async () => {
    const file = path.join(logDir, 'pipeline-session-multi.log');
    const lines = [
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-r1-1',
        seq: 1,
        ts: '2026-08-29T10:00:00.000Z',
        taskId: 't-1',
        runId: 'r-1',
        sessionId: 'repl-shared-session',
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'R1 step',
      }),
      JSON.stringify({
        schemaVersion: '1.0',
        eventId: 'evt-r2-1',
        seq: 1,
        ts: '2026-08-29T10:05:00.000Z',
        taskId: 't-2',
        runId: 'r-2',
        sessionId: 'repl-shared-session',
        phase: 'PLANNING',
        role: 'planner',
        model: 'm',
        message: 'R2 step',
      }),
    ];
    fs.writeFileSync(file, lines.join('\n'));

    const r1 = await reader.read({ runId: 'r-1' });
    const r2 = await reader.read({ runId: 'r-2' });

    expect(r1.length).toBe(1);
    expect(r1[0].runId).toBe('r-1');
    expect(r1[0].taskId).toBe('t-1');

    expect(r2.length).toBe(1);
    expect(r2[0].runId).toBe('r-2');
    expect(r2[0].taskId).toBe('t-2');
  });
});
