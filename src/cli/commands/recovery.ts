import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { InterruptDetectionService } from '../../core/recovery/interrupt-detection-service';
import { transitionFinalTruth } from '../../domain/final-truth';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function recoveryCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'list') {
    await listRecoverable();
    return;
  }

  if (sub === 'resume') {
    const executionId = args[1];
    if (!executionId) {
      console.error('Usage: agent recovery resume <runId|executionId>');
      process.exit(2);
      return;
    }
    await resumeExecution(executionId);
    return;
  }

  console.error(`Unknown recovery subcommand: ${sub}`);
  console.error('Usage: agent recovery [list | resume <runId|executionId>]');
  process.exit(2);
}

async function listRecoverable(): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const store = factory.createTaskRunStore();
    const detector = new InterruptDetectionService(store);
    await detector.detectAndMarkInterrupted();

    const runs = await store.list(50);
    const interrupted = runs.filter(
      (r) => r.status === 'INTERRUPTED' || r.finalTruth?.status === 'INTERRUPTED'
        || (r.finalTruth && !['COMPLETED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(r.finalTruth.status)
          && r.finalTruth.recoveryStatus === 'DETECTED'),
    );

    const trigger = factory.createRecoveryTrigger();
    const checkpoints = await trigger.listRecoverable();

    if (interrupted.length === 0 && checkpoints.length === 0) {
      console.log('No interrupted executions found.');
      return;
    }

    console.log('═'.repeat(60));
    console.log('RECOVERABLE EXECUTIONS');
    console.log('═'.repeat(60));
    console.log('');

    for (const run of interrupted) {
      const truth = run.finalTruth;
      console.log(`  Run:        ${run.runId}`);
      console.log(`  Task:       ${run.taskId}`);
      console.log(`  State:      ${truth?.status ?? run.status}`);
      console.log(`  Last step:  ${truth?.currentStep ?? 'unknown'}`);
      console.log(`  Operation:  ${truth?.currentOperation ?? 'unknown'}`);
      console.log(`  Heartbeat:  ${truth?.lastHeartbeat ?? run.startedAt}`);
      console.log(`  Plan:       ${truth?.planId ?? 'unknown'}`);
      console.log('');
    }

    for (const opt of checkpoints) {
      console.log(`  Checkpoint execution:  ${opt.executionId}`);
      console.log(`  Session:    ${opt.sessionId}`);
      console.log(`  Last Step:  ${opt.lastCompletedStep}`);
      console.log(`  Remaining:  ${opt.remainingStepsCount} step(s)`);
      console.log(`  Checkpoint: ${opt.checkpointTimestamp}`);
      console.log('');
    }

    console.log('To resume: agent recovery resume <runId|executionId>');
    console.log('═'.repeat(60));
  } catch (error: any) {
    console.error(`Failed to list recoverable executions: ${error.message}`);
    process.exit(1);
  }
}

async function resumeExecution(executionId: string): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const store = factory.createTaskRunStore();
    await new InterruptDetectionService(store).detectAndMarkInterrupted();

    let run = await store.getRun(executionId);
    if (!run) {
      // Try as task id
      run = await store.get(executionId);
    }

    const trigger = factory.createRecoveryTrigger();
    const checkpointCandidate = await factory.createRecoveryService().findResumable(executionId);

    if (!run && !checkpointCandidate) {
      console.error(`✗ No resumable execution found for: ${executionId}`);
      process.exit(1);
      return;
    }

    const resumeStep = checkpointCandidate?.resumeFromStepIndex ?? 0;
    const checkpointId = checkpointCandidate?.checkpoint.checkpointId;
    const originalTask = run?.task;
    if (!originalTask) {
      console.error('✗ Cannot resume: original task text not found on run snapshot.');
      process.exit(1);
      return;
    }

    const runId = run?.runId ?? executionId;
    const taskId = run?.taskId ?? runId;

    if (run?.finalTruth) {
      const resumedTruth = transitionFinalTruth(
        run.finalTruth.status === 'INTERRUPTED'
          ? run.finalTruth
          : transitionFinalTruth(run.finalTruth, 'INTERRUPTED', { reason: 'Preparing resume' }),
        'EXECUTION',
        {
          reason: 'Resume requested via /recovery',
          recoveryStatus: 'RESUMED',
          resumedFromRunId: runId,
          resumedFromCheckpointId: checkpointId,
          currentStep: `step-index-${resumeStep}`,
          currentOperation: 'resume',
        },
      );
      await store.save({
        ...run,
        status: 'EXECUTION',
        finalTruth: resumedTruth,
        completedAt: undefined,
      });
    }

    // Prepare checkpoint context (existing path) then re-enter execution with same ids.
    if (checkpointCandidate) {
      await trigger.resume(executionId);
    }

    console.log(`Resuming run ${runId} from step index ${resumeStep}…`);
    const outcome = await factory.createTaskExecutionService().execute({
      task: originalTask,
      roleId: run?.roleId ?? 'coder',
      taskId,
      runId,
      sessionId: run?.sessionId,
      executionMode: run?.executionMode,
      resumedFromRunId: runId,
      resumedFromCheckpointId: checkpointId,
      resumeFromStepIndex: resumeStep,
    });

    const truth = outcome.snapshot.finalTruth;
    console.log(`✓ Resume finished. FinalTruth=${truth?.status ?? outcome.snapshot.status}`);
    console.log(`  runId=${outcome.runId} taskId=${outcome.taskId}`);
    if (outcome.outcomeSummary) {
      console.log(`  outcome=${outcome.outcomeSummary.outcome}`);
    }
  } catch (error: any) {
    console.error(`Failed to resume execution: ${error.message}`);
    process.exit(1);
  }
}
