import { RecoveryService, RecoveryCandidate } from '../../contracts/recovery-service';
import { CheckpointRepository } from '../../contracts/checkpoint-repository';
import { ResumeEngine } from '../checkpoint/resume-engine';
import { ExecutionCheckpoint } from '../../domain/execution-checkpoint';
import { ExecutionContext } from '../../domain/execution-context';
import { ExecutionLogger } from '../observability/execution-logger';

/**
 * DefaultRecoveryService provides controlled recovery from checkpoints.
 *
 * Flow:
 *   findResumable(executionId)
 *     → ResumeEngine.canResume()
 *     → validate checkpoint
 *     → return RecoveryCandidate
 *
 *   prepareResumeContext(candidate)
 *     → create ExecutionContext with resumedFromCheckpoint = true
 *
 * Safety:
 *   - Does NOT recover completed executions
 *   - Does NOT recover abandoned executions
 *   - Does NOT restart from step zero
 *   - Preserves executionId, sessionId, telemetry continuity
 */
export class DefaultRecoveryService implements RecoveryService {
  constructor(
    private readonly checkpointRepository: CheckpointRepository,
    private readonly resumeEngine: ResumeEngine,
  ) {}

  async findResumable(executionId: string): Promise<RecoveryCandidate | null> {
    const result = await this.resumeEngine.canResume(executionId);
    ExecutionLogger.log('RECOVERY', '-', '-', `Finding resumable execution: ${executionId}`);

    if (!result.canResume || !result.checkpoint) {
      return null;
    }

    if (!this.validateCheckpoint(result.checkpoint)) {
      return null;
    }

    return Object.freeze({
      executionId,
      checkpoint: result.checkpoint,
      resumeFromStepIndex: result.resumeFromStepIndex,
      remainingSteps: result.remainingSteps,
    });
    ExecutionLogger.log('RECOVERY', '-', '-', `Recovery candidate found`, {
      resumeFromStep: result.resumeFromStepIndex,
      remainingSteps: result.remainingSteps.length,
    });
  }

  prepareResumeContext(candidate: RecoveryCandidate): ExecutionContext {
    return Object.freeze({
      sessionId: candidate.checkpoint.sessionId,
      plan: null,
      currentStepIndex: candidate.resumeFromStepIndex,
      totalSteps: candidate.checkpoint.totalSteps,
      startedAt: new Date().toISOString(),
      executionId: candidate.executionId,
      checkpointId: candidate.checkpoint.checkpointId,
      resumedFromCheckpoint: true,
    });
  }

  validateCheckpoint(checkpoint: ExecutionCheckpoint): boolean {
    if (!checkpoint.checkpointId) return false;
    if (!checkpoint.executionId) return false;
    if (!checkpoint.sessionId) return false;
    if (checkpoint.currentStepIndex < 0) return false;
    if (checkpoint.currentStepIndex > checkpoint.totalSteps) return false;
    if (checkpoint.status !== 'active') return false;
    return true;
  }
}
