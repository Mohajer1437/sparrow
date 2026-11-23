export type CheckpointStatus = 'active' | 'completed' | 'abandoned';

export interface ExecutionCheckpoint {
  readonly checkpointId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly currentStepIndex: number;
  readonly totalSteps: number;
  readonly completedStepIds: ReadonlyArray<string>;
  readonly pendingStepIds: ReadonlyArray<string>;
  readonly status: CheckpointStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, string>>;
}
