import { TaskRunStore } from '../../contracts/task-run-store';
import {
  FinalTruth,
  heartbeatFinalTruth,
  isHeartbeatExpired,
  isNonTerminalFinalTruth,
  isProcessAlive,
  transitionFinalTruth,
  DEFAULT_HEARTBEAT_EXPIRY_MS,
} from '../../domain/final-truth';
import { TaskRunSnapshot } from '../../domain/task-run';

export class InterruptDetectionService {
  constructor(
    private readonly store: TaskRunStore,
    private readonly expiryMs: number = DEFAULT_HEARTBEAT_EXPIRY_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async detectAndMarkInterrupted(limit: number = 100): Promise<ReadonlyArray<TaskRunSnapshot>> {
    const runs = await this.store.list(limit);
    const marked: TaskRunSnapshot[] = [];
    const nowMs = this.now().getTime();
    for (const run of runs) {
      const truth = run.finalTruth;
      if (!truth) continue;
      if (!isNonTerminalFinalTruth(truth.status)) continue;
      const expired = isHeartbeatExpired(truth, nowMs, this.expiryMs);
      const deadOwner = truth.processPid !== undefined && !isProcessAlive(truth.processPid);
      if (!expired && !deadOwner) continue;
      const reason = deadOwner
        ? `Owning process pid=${truth.processPid} is not alive; treating run as interrupted`
        : 'Heartbeat expired; process likely terminated without clean shutdown';
      const interrupted = transitionFinalTruth(truth, 'INTERRUPTED', {
        reason,
        now: this.now().toISOString(),
        recoveryStatus: 'DETECTED',
      });
      const next: TaskRunSnapshot = {
        ...run,
        status: 'INTERRUPTED',
        finalTruth: interrupted,
        completedAt: interrupted.timestamp,
        outcomeSummary: undefined,
      };
      await this.store.save(next);
      marked.push(next);
    }
    return Object.freeze(marked);
  }

  async heartbeat(run: TaskRunSnapshot, step?: string, operation?: string): Promise<TaskRunSnapshot> {
    if (!run.finalTruth) return run;
    const nextTruth = heartbeatFinalTruth(run.finalTruth, {
      now: this.now().toISOString(),
      currentStep: step,
      currentOperation: operation,
    });
    const next = { ...run, finalTruth: nextTruth };
    await this.store.save(next);
    return next;
  }
}

export function listInterruptedFromSnapshots(
  runs: ReadonlyArray<TaskRunSnapshot>,
): ReadonlyArray<{ run: TaskRunSnapshot; truth: FinalTruth }> {
  return runs
    .filter((r) => r.finalTruth && (r.finalTruth.status === 'INTERRUPTED' || isNonTerminalFinalTruth(r.finalTruth.status)))
    .map((r) => ({ run: r, truth: r.finalTruth! }));
}