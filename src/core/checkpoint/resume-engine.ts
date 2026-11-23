import { CheckpointRepository } from '../../contracts/checkpoint-repository';
import { ExecutionCheckpoint } from '../../domain/execution-checkpoint';
import { ExecutionPlan } from '../../domain/execution-plan';
import { ExecutionLogger } from '../observability/execution-logger';

export interface ResumeResult {
  readonly canResume: boolean;
  readonly checkpoint: ExecutionCheckpoint | null;
  readonly resumeFromStepIndex: number;
  readonly remainingSteps: ReadonlyArray<string>;
  readonly reason?: string;
}

/**
 * ResumeEngine is responsible for:
 *   - Loading checkpoints
 *   - Validating checkpoint state
 *   - Determining resume point
 *   - Creating new checkpoints
 *
 * Deterministic. No LLM. No automatic retry policy changes.
 */
export class ResumeEngine {
  constructor(private readonly checkpointRepository: CheckpointRepository) {}

  async canResume(executionId: string): Promise<ResumeResult> {
    const checkpoint = await this.checkpointRepository.loadLatest(executionId);
    ExecutionLogger.log('CHECKPOINT', '-', '-', `Checking resumability: ${executionId}`);

    if (!checkpoint) {
      return Object.freeze({
        canResume: false,
        checkpoint: null,
        resumeFromStepIndex: 0,
        remainingSteps: Object.freeze([]),
        reason: 'No checkpoint found',
      });
    }

    if (checkpoint.status === 'completed') {
      return Object.freeze({
        canResume: false,
        checkpoint,
        resumeFromStepIndex: checkpoint.totalSteps,
        remainingSteps: Object.freeze([]),
        reason: 'Execution already completed',
      });
    }

    if (checkpoint.status === 'abandoned') {
      return Object.freeze({
        canResume: false,
        checkpoint,
        resumeFromStepIndex: 0,
        remainingSteps: Object.freeze([]),
        reason: 'Checkpoint was abandoned',
      });
    }

    ExecutionLogger.log('CHECKPOINT', '-', '-', `Can resume from step ${checkpoint!.currentStepIndex}/${checkpoint!.totalSteps}`);

    return Object.freeze({
      canResume: true,
      checkpoint,
      resumeFromStepIndex: checkpoint.currentStepIndex,
      remainingSteps: Object.freeze([...checkpoint.pendingStepIds]),
    });
  }

  createCheckpoint(
    executionId: string,
    sessionId: string,
    plan: ExecutionPlan,
    currentStepIndex: number,
    completedStepIds: string[],
  ): ExecutionCheckpoint {
    const pendingStepIds = plan.steps.slice(currentStepIndex).map(s => s.id);

    return Object.freeze({
      checkpointId: `cp-${executionId}-${currentStepIndex}-${Date.now()}`,
      executionId,
      sessionId,
      planId: plan.id,
      currentStepIndex,
      totalSteps: plan.steps.length,
      completedStepIds: Object.freeze([...completedStepIds]),
      pendingStepIds: Object.freeze(pendingStepIds),
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async saveCheckpoint(checkpoint: ExecutionCheckpoint): Promise<void> {
    await this.checkpointRepository.save(checkpoint);
  }

  async markCompleted(executionId: string): Promise<void> {
    const checkpoint = await this.checkpointRepository.loadLatest(executionId);
    if (checkpoint) {
      await this.checkpointRepository.save(Object.freeze({
        ...checkpoint,
        status: 'completed' as const,
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  async markAbandoned(executionId: string): Promise<void> {
    const checkpoint = await this.checkpointRepository.loadLatest(executionId);
    if (checkpoint) {
      await this.checkpointRepository.save(Object.freeze({
        ...checkpoint,
        status: 'abandoned' as const,
        updatedAt: new Date().toISOString(),
      }));
    }
  }
}
