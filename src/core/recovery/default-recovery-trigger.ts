import { RecoveryTrigger, RecoveryOption } from '../../contracts/recovery-trigger';
import { RecoveryService } from '../../contracts/recovery-service';
import { CheckpointRepository } from '../../contracts/checkpoint-repository';
import { AuditService } from '../../contracts/audit-service';

export class DefaultRecoveryTrigger implements RecoveryTrigger {
  constructor(
    private readonly recoveryService: RecoveryService,
    private readonly checkpointRepository: CheckpointRepository,
    private readonly auditService?: AuditService,
  ) {}

  async listRecoverable(): Promise<ReadonlyArray<RecoveryOption>> {
    const allCheckpoints = await this.checkpointRepository.listAll();
    const active = allCheckpoints.filter(cp => cp.status === 'active');

    return Object.freeze(active.map(cp => Object.freeze({
      executionId: cp.executionId,
      sessionId: cp.sessionId,
      lastCompletedStep: cp.completedStepIds.length > 0
        ? cp.completedStepIds[cp.completedStepIds.length - 1]
        : 'none',
      remainingStepsCount: cp.pendingStepIds.length,
      checkpointTimestamp: cp.updatedAt,
    })));
  }

  async resume(executionId: string): Promise<{ success: boolean; message: string }> {
    const candidate = await this.recoveryService.findResumable(executionId);

    if (!candidate) {
      return Object.freeze({
        success: false,
        message: `No resumable execution found for: ${executionId}`,
      });
    }

    // Audit: recovery_triggered (R4.23)
    if (this.auditService) {
      try {
        await this.auditService.record({
          executionId,
          sessionId: candidate.checkpoint.sessionId,
          eventType: 'recovery_triggered',
          status: 'triggered',
          metadata: { resumeFromStep: String(candidate.resumeFromStepIndex) },
        });
      } catch (e: any) { console.warn(`[RecoveryTrigger] Audit failed (non-fatal): ${e.message}`); }
    }

    const context = this.recoveryService.prepareResumeContext(candidate);

    return Object.freeze({
      success: true,
      message: `Resume prepared for execution ${executionId} from step ${context.currentStepIndex} (${candidate.remainingSteps.length} steps remaining)`,
    });
  }
}
