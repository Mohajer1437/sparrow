import { RecoveryCandidate } from './recovery-service';

export interface RecoveryOption {
  readonly executionId: string;
  readonly sessionId: string;
  readonly lastCompletedStep: string;
  readonly remainingStepsCount: number;
  readonly checkpointTimestamp: string;
}

/**
 * RecoveryTrigger provides user-facing recovery control.
 *
 * NEVER automatically resumes without explicit confirmation.
 * Deterministic. No LLM. No intelligent decisions.
 */
export interface RecoveryTrigger {
  listRecoverable(): Promise<ReadonlyArray<RecoveryOption>>;
  resume(executionId: string): Promise<{ success: boolean; message: string }>;
}
