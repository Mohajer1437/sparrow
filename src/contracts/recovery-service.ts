import { ExecutionContext } from '../domain/execution-context';
import { ExecutionCheckpoint } from '../domain/execution-checkpoint';

export interface RecoveryCandidate {
  readonly executionId: string;
  readonly checkpoint: ExecutionCheckpoint;
  readonly resumeFromStepIndex: number;
  readonly remainingSteps: ReadonlyArray<string>;
}

/**
 * RecoveryService detects interrupted executions and prepares resume context.
 *
 * Deterministic. No LLM. No intelligent recovery decisions.
 * Does NOT recover completed or abandoned executions.
 */
export interface RecoveryService {
  findResumable(executionId: string): Promise<RecoveryCandidate | null>;
  prepareResumeContext(candidate: RecoveryCandidate): ExecutionContext;
  validateCheckpoint(checkpoint: ExecutionCheckpoint): boolean;
}
