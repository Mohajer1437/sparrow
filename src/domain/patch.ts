/**
 * R2.6: Patch Execution Domain Types
 *
 * Immutable domain objects describing safe file operations.
 * Each PatchRequest contains multiple PatchOperations that are
 * applied atomically — all succeed or all rollback.
 */

/** Type of file operation in a patch */
export type PatchOperationType = 'create' | 'modify' | 'delete';

/** A single file operation within a patch */
export interface PatchOperation {
  readonly path: string;
  readonly operation: PatchOperationType;
  /** Original content (required for modify/delete, absent for create) */
  readonly originalContent?: string;
  /** New content (required for create/modify, absent for delete) */
  readonly newContent?: string;
}

/** A batch of operations to apply atomically */
export interface PatchRequest {
  readonly sessionId: string;
  readonly operations: ReadonlyArray<PatchOperation>;
  /** Optional reason for audit trail */
  readonly reason?: string;
  /** Auto-commit after successful patch (default: false) */
  readonly autoCommit?: boolean;
  /** E.3: Optional scope restriction — files allowed to be modified in this patch */
  readonly expectedFiles?: ReadonlyArray<string>;
}

/** Outcome of patch execution */
export interface PatchResult {
  readonly success: boolean;
  readonly changedFiles: ReadonlyArray<string>;
  readonly failedFiles: ReadonlyArray<string>;
  readonly rollbackPerformed: boolean;
  readonly validationPassed: boolean;
  readonly testsPassed: boolean;
  readonly commitHash?: string | null;
  readonly error?: string;
}

/** Metadata stored alongside backups for restore */
export interface BackupMetadata {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly operations: ReadonlyArray<{
    readonly path: string;
    readonly operation: PatchOperationType;
    readonly existed: boolean;
  }>;
}

/** Result of running validation or tests */
export interface CommandResult {
  readonly passed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly command: string;
}
