import {
  GitCommitRequest,
  GitCommitResult,
  GitStatus,
  GitRollbackResult,
  GitCommitInfo,
} from '../domain/git';

export interface GitManager {
  status(): Promise<GitStatus>;
  commit(request: GitCommitRequest): Promise<GitCommitResult>;
  rollback(commitHash: string): Promise<GitRollbackResult>;
  getCurrentBranch(): Promise<string | null>;
  listRecentCommits(count?: number): Promise<ReadonlyArray<GitCommitInfo>>;
  isRepository(): Promise<boolean>;
}
