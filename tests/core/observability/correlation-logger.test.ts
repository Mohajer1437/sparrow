import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';
import { CorrelationContext } from '../../../src/domain/correlation';
import { PIPELINE_EVENT_SCHEMA_VERSION } from '../../../src/domain/pipeline-event';

describe('R6 Core Observability — Correlation Logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-corr-logger-test-'));
    ExecutionLogger.init(tmpDir, 'sess-test-init');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('logs events with explicit CorrelationContext (R6.4, R6.6, R6.46)', () => {
    const ctx: CorrelationContext = {
      taskId: 'task-001',
      runId: 'run-001',
      sessionId: 'sess-001',
      attemptId: 'attempt-1',
    };

    ExecutionLogger.setContext(ctx);
    ExecutionLogger.log('PLANNING', 'planner', 'test-model', 'Planning started', { foo: 'bar' });
    ExecutionLogger.log('EXECUTION', 'coder', 'test-model', 'Execution step 1');

    const logFile = ExecutionLogger.getLogFile();
    expect(logFile).toBeDefined();
    expect(fs.existsSync(logFile!)).toBe(true);

    const lines = fs.readFileSync(logFile!, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.schemaVersion).toBe(PIPELINE_EVENT_SCHEMA_VERSION);
    expect(event1.taskId).toBe('task-001');
    expect(event1.runId).toBe('run-001');
    expect(event1.sessionId).toBe('sess-001');
    expect(event1.attemptId).toBe('attempt-1');
    expect(event1.seq).toBe(1);
    expect(event1.eventId).toMatch(/^evt-run-001-1-/);
    expect(event1.phase).toBe('PLANNING');
    expect(event1.message).toBe('Planning started');
    expect(event1.foo).toBe('bar');

    const event2 = JSON.parse(lines[1]);
    expect(event2.seq).toBe(2);
    expect(event2.runId).toBe('run-001');
    expect(event2.eventId).toMatch(/^evt-run-001-2-/);
  });

  it('maintains per-run monotonic sequence numbers (R6.9)', () => {
    const runACtx: CorrelationContext = {
      taskId: 'task-A',
      runId: 'run-A',
      sessionId: 'sess-common',
    };
    const runBCtx: CorrelationContext = {
      taskId: 'task-B',
      runId: 'run-B',
      sessionId: 'sess-common',
    };

    ExecutionLogger.setContext(runACtx);
    ExecutionLogger.log('PLANNING', 'planner', 'm', 'Run A event 1');
    ExecutionLogger.log('EXECUTION', 'coder', 'm', 'Run A event 2');

    ExecutionLogger.setContext(runBCtx);
    ExecutionLogger.log('PLANNING', 'planner', 'm', 'Run B event 1');

    ExecutionLogger.setContext(runACtx);
    ExecutionLogger.log('VERIFICATION', 'verifier', 'm', 'Run A event 3');

    const logFile = ExecutionLogger.getLogFile();
    const lines = fs.readFileSync(logFile!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    const runAEvents = lines.filter((e) => e.runId === 'run-A');
    const runBEvents = lines.filter((e) => e.runId === 'run-B');

    expect(runAEvents.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(runBEvents.map((e) => e.seq)).toEqual([1]);
  });

  it('eliminates mid-run session re-stamping bugs (R6.5)', () => {
    const ctx: CorrelationContext = {
      taskId: 'task-repl-1',
      runId: 'run-repl-1',
      sessionId: 'repl-sess-fixed',
    };

    ExecutionLogger.setContext(ctx);
    // Legacy caller calls setSession mid-run
    ExecutionLogger.setSession('another-session-attempted');

    // Context retains original first-class identifiers
    expect(ExecutionLogger.getRunId()).toBe('run-repl-1');
    expect(ExecutionLogger.getTaskId()).toBe('task-repl-1');
    expect(ExecutionLogger.getSessionId()).toBe('repl-sess-fixed');

    ExecutionLogger.log('EXECUTION', 'coder', 'm', 'Step after setSession');
    const logFile = ExecutionLogger.getLogFile();
    const lines = fs.readFileSync(logFile!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const lastEvent = lines[lines.length - 1];

    expect(lastEvent.runId).toBe('run-repl-1');
    expect(lastEvent.taskId).toBe('task-repl-1');
    expect(lastEvent.sessionId).toBe('repl-sess-fixed');
  });

  it('updates attemptId dynamically during repair without changing runId (R6.12, R6.17)', () => {
    const ctx: CorrelationContext = {
      taskId: 'task-repair-1',
      runId: 'run-repair-1',
      sessionId: 'sess-repair-1',
      attemptId: 'attempt-1',
    };

    ExecutionLogger.setContext(ctx);
    ExecutionLogger.log('EXECUTION', 'coder', 'm', 'Primary execution');

    // Repair attempt 2
    ExecutionLogger.setAttemptId('attempt-2');
    ExecutionLogger.log('REPAIR', 'repair', 'm', 'Repair attempt 2 execution');

    // Repair attempt 3
    ExecutionLogger.setAttemptId('attempt-3');
    ExecutionLogger.log('REPAIR', 'repair', 'm', 'Repair attempt 3 execution');

    const logFile = ExecutionLogger.getLogFile();
    const lines = fs.readFileSync(logFile!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    expect(lines[0].attemptId).toBe('attempt-1');
    expect(lines[0].runId).toBe('run-repair-1');

    expect(lines[1].attemptId).toBe('attempt-2');
    expect(lines[1].runId).toBe('run-repair-1');

    expect(lines[2].attemptId).toBe('attempt-3');
    expect(lines[2].runId).toBe('run-repair-1');
  });
});
