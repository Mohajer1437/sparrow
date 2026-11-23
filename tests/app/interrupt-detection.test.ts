import { InterruptDetectionService } from '../../src/core/recovery/interrupt-detection-service';
import { createInitialFinalTruth, heartbeatFinalTruth } from '../../src/domain/final-truth';
import { TaskRunSnapshot } from '../../src/domain/task-run';

describe('InterruptDetectionService', () => {
  it('marks stale non-terminal runs as INTERRUPTED', async () => {
    const staleTruth = heartbeatFinalTruth(
      createInitialFinalTruth({
        runId: 'run-1',
        taskId: 'task-1',
        now: '2020-01-01T00:00:00.000Z',
        processPid: undefined,
      }),
      { now: '2020-01-01T00:00:00.000Z' },
    );
    const run: TaskRunSnapshot = {
      taskId: 'task-1',
      runId: 'run-1',
      task: 'do stuff',
      roleId: 'coder',
      workspaceRoot: '/tmp',
      status: 'PLANNING',
      startedAt: '2020-01-01T00:00:00.000Z',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      finalTruth: { ...staleTruth, processPid: undefined },
    };
    const saved: TaskRunSnapshot[] = [];
    const store = {
      list: async () => [run],
      save: async (s: TaskRunSnapshot) => { saved.push(s); },
    } as any;

    const service = new InterruptDetectionService(store, 1000, () => new Date('2020-01-01T01:00:00.000Z'));
    const marked = await service.detectAndMarkInterrupted();
    expect(marked).toHaveLength(1);
    expect(marked[0].status).toBe('INTERRUPTED');
    expect(marked[0].finalTruth?.status).toBe('INTERRUPTED');
    expect(saved[0].finalTruth?.recoveryStatus).toBe('DETECTED');
  });

  it('marks non-terminal runs whose processPid is dead as INTERRUPTED', async () => {
    const truth = createInitialFinalTruth({
      runId: 'run-dead',
      taskId: 'task-dead',
      now: new Date().toISOString(),
      processPid: 2147483646,
    });
    const run: TaskRunSnapshot = {
      taskId: 'task-dead',
      runId: 'run-dead',
      task: 'do stuff',
      roleId: 'coder',
      workspaceRoot: '/tmp',
      status: 'EXECUTION',
      startedAt: new Date().toISOString(),
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      finalTruth: { ...truth, status: 'EXECUTION', processPid: 2147483646 },
    };
    const saved: TaskRunSnapshot[] = [];
    const store = {
      list: async () => [run],
      save: async (s: TaskRunSnapshot) => { saved.push(s); },
    } as any;

    const service = new InterruptDetectionService(store, 60 * 60 * 1000, () => new Date());
    const marked = await service.detectAndMarkInterrupted();
    expect(marked).toHaveLength(1);
    expect(marked[0].finalTruth?.status).toBe('INTERRUPTED');
    expect(marked[0].finalTruth?.reason).toMatch(/not alive/i);
  });
});