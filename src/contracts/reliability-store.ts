import { ReliabilityRecord } from '../domain/reliability';

/**
 * Persistence for normalized reliability evidence.
 *
 * The task-run snapshot remains the source of truth; a stored record is a
 * derived projection kept so metrics survive process restarts and so history
 * outlives snapshot pruning. Implementations must treat writes as best effort:
 * a persistence failure may never break measurement or the pipeline.
 */
export interface ReliabilityStore {
  save(record: ReliabilityRecord): Promise<void>;
  get(taskId: string): Promise<ReliabilityRecord | null>;
  list(): Promise<ReadonlyArray<ReliabilityRecord>>;
}
