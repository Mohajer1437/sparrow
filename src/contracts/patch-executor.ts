import { PatchRequest, PatchResult } from '../domain/patch';

/**
 * R2.6: PatchExecutor Contract
 *
 * Orchestrates safe file mutations:
 *   1. Create backup
 *   2. Apply operations atomically
 *   3. Run validation
 *   4. Run tests
 *   5. On success: complete
 *   6. On failure: rollback automatically
 *
 * Every execution is recorded in the session audit trail.
 */
export interface PatchExecutor {
  execute(request: PatchRequest): Promise<PatchResult>;
  rollback(sessionId: string): Promise<boolean>;
}
