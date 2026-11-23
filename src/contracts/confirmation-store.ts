import { ConfirmationRequest, ConfirmationStatus } from '../domain/confirmation';

export interface ConfirmationListFilter {
  readonly status?: ConfirmationStatus;
  readonly taskId?: string;
  readonly limit?: number;
}

/**
 * Persistence contract for confirmation requests and decisions.
 * Persists pending and resolved confirmation states to disk atomically.
 */
export interface ConfirmationStore {
  save(request: ConfirmationRequest): Promise<void>;
  get(id: string): Promise<ConfirmationRequest | null>;
  list(filter?: ConfirmationListFilter): Promise<ReadonlyArray<ConfirmationRequest>>;
  lastModified(): Promise<number>;
}
