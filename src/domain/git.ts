/**
 * R2.5: Git Domain Types
 */

export interface GitCommitRequest {
  readonly sessionId: string;
  readonly message: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly author?: {
    readonly name: string;
    readonly email: string;
  };
}

export interface GitCommitResult {
  readonly success: boolean;
  readonly commitHash: string | null;
  readonly message: string;
  readonly timestamp: string;
  readonly error?: string;
}

export interface GitStatus {
  readonly branch: string | null;
  readonly hasChanges: boolean;
  readonly changedFiles: ReadonlyArray<string>;
  readonly isRepo: boolean;
}

export interface GitRollbackResult {
  readonly success: boolean;
  readonly restoredCommit: string | null;
  readonly error?: string;
}

export interface GitCommitInfo {
  readonly hash: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string;
  readonly timestamp: string;
}
