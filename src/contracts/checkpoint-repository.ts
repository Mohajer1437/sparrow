import { ExecutionCheckpoint } from '../domain/execution-checkpoint';

/**
 * CheckpointRepository abstracts checkpoint storage.
 * No direct filesystem dependency.
 * Uses RuntimeRepository internally for atomic writes.
 */
export interface CheckpointRepository {
  save(checkpoint: ExecutionCheckpoint): Promise<void>;
  load(checkpointId: string): Promise<ExecutionCheckpoint | null>;
  loadLatest(executionId: string): Promise<ExecutionCheckpoint | null>;
  delete(checkpointId: string): Promise<boolean>;
  list(executionId: string): Promise<ReadonlyArray<ExecutionCheckpoint>>;
  listAll(): Promise<ReadonlyArray<ExecutionCheckpoint>>;
}
