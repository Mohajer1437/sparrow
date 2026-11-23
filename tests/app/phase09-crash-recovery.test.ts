import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { InterruptDetectionService } from '../../src/core/recovery/interrupt-detection-service';
import {
  createInitialFinalTruth,
  heartbeatFinalTruth,
  transitionFinalTruth,
} from '../../src/domain/final-truth';
import { TaskRunSnapshot } from '../../src/domain/task-run';
import { FileCheckpointRepository } from '../../src/core/checkpoint/file-checkpoint-repository';
import { LocalRuntimeRepository } from '../../src/core/runtime/local-runtime-repository';
import { ExecutionCheckpoint } from '../../src/domain/execution-checkpoint';

/**
 * PHASE-09 integration: crash -> detect INTERRUPTED -> resume continues same runId.
 */
describe('PHASE-09 crash/recovery FinalTruth path', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase09-crash-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects interruption and resumes with same runId / plan metadata', async () => {
    const store = new FileTaskRunStore(root);
    const runId = 'run-phase09-1';
    const taskId = 'task-phase09-1';
    const planId = 'plan-phase09-1';

    let truth = createInitialFinalTruth({
      runId,
      taskId,
      planId,
      now: '2020-01-01T00:00:00.000Z',
    });
    truth = transitionFinalTruth(truth, 'EXECUTION', {
      now: '2020-01-01T00:00:01.000Z',
      currentStep: 'step-index-3',
      currentOperation: 'apply_patch',
      planId,
    });
    truth = heartbeatFinalTruth(truth, {
      now: '2020-01-01T00:00:01.000Z',
      currentStep: 'step-index-3',
      currentOperation: 'apply_patch',
    });

    const snapshot: TaskRunSnapshot = {
      taskId,
      runId,
      task: 'implement feature X',
      roleId: 'coder',
      workspaceRoot: root,
      status: 'EXECUTION',
      startedAt: '2020-01-01T00:00:00.000Z',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      finalTruth: truth,
    };
    await store.save(snapshot);

    const detector = new InterruptDetectionService(
      store,
      1000,
      () => new Date('2020-01-01T01:00:00.000Z'),
    );
    const marked = await detector.detectAndMarkInterrupted();
    expect(marked).toHaveLength(1);
    expect(marked[0].runId).toBe(runId);
    expect(marked[0].finalTruth?.status).toBe('INTERRUPTED');
    expect(marked[0].finalTruth?.planId).toBe(planId);
    expect(marked[0].finalTruth?.currentStep).toBe('step-index-3');

    const interrupted = await store.getRun(runId);
    expect(interrupted?.finalTruth?.status).toBe('INTERRUPTED');

    const resumed = transitionFinalTruth(interrupted!.finalTruth!, 'EXECUTION', {
      reason: 'Resume after crash',
      recoveryStatus: 'RESUMED',
      resumedFromRunId: runId,
      resumedFromCheckpointId: 'cp-phase09-1',
      currentStep: 'step-index-3',
      currentOperation: 'resume',
    });
    await store.save({
      ...interrupted!,
      status: 'EXECUTION',
      finalTruth: resumed,
      completedAt: undefined,
    });

    const afterResume = await store.getRun(runId);
    expect(afterResume?.runId).toBe(runId);
    expect(afterResume?.finalTruth?.planId).toBe(planId);
    expect(afterResume?.finalTruth?.status).toBe('EXECUTION');
    expect(afterResume?.finalTruth?.resumedFromRunId).toBe(runId);
    expect(afterResume?.finalTruth?.resumedFromCheckpointId).toBe('cp-phase09-1');
    expect(afterResume?.finalTruth?.currentStep).toBe('step-index-3');
  });

  it('checkpoint survives restart (SM-11 path)', async () => {
    const runtime = new LocalRuntimeRepository(root);
    const repo = new FileCheckpointRepository(runtime);
    const checkpoint: ExecutionCheckpoint = Object.freeze({
      checkpointId: 'cp-vis-1',
      executionId: 'exec-vis-1',
      sessionId: 'sess-1',
      planId: 'plan-1',
      completedStepIds: Object.freeze(['s1', 's2']),
      pendingStepIds: Object.freeze(['s3']),
      currentStepIndex: 2,
      totalSteps: 3,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repo.save(checkpoint);

    const listed = await repo.listAll();
    expect(listed.some((c) => c.checkpointId === 'cp-vis-1')).toBe(true);

    const repo2 = new FileCheckpointRepository(new LocalRuntimeRepository(root));
    const loaded = await repo2.load('cp-vis-1');
    expect(loaded?.checkpointId).toBe('cp-vis-1');
    expect(loaded?.executionId).toBe('exec-vis-1');
  });
});