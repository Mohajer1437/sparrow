import { GitManager } from '../../contracts/git-manager';
import { CommandExecutor } from '../../contracts/command-executor';
import { ExecutionLogger } from '../observability/execution-logger';
import {
  GitCommitRequest,
  GitCommitResult,
  GitStatus,
  GitRollbackResult,
  GitCommitInfo,
} from '../../domain/git';

const FORBIDDEN_ARGS_PATTERNS = [
  /reset\s+--hard/i,
  /push\s+--force/i,
  /push\s+-f\b/i,
  /clean\s+-fd/i,
  /clean\s+-f\s+-d/i,
];

export class DefaultGitManager implements GitManager {
  constructor(
    private readonly commandExecutor: CommandExecutor,
    private readonly cwd?: string
  ) {}

  async status(): Promise<GitStatus> {
    try {
      const isRepo = await this.isRepository();
      if (!isRepo) {
        return {
          branch: null,
          hasChanges: false,
          changedFiles: [],
          isRepo: false,
        };
      }

      const branch = await this.getCurrentBranch();

      const result = await this.commandExecutor.execute(
        'git',
        ['status', '--porcelain'],
        { cwd: this.cwd }
      );

      if (result.exitCode !== 0) {
        console.warn(`[GitManager] status failed: ${result.stderr}`);
        return {
          branch,
          hasChanges: false,
          changedFiles: [],
          isRepo: true,
        };
      }

      const lines = result.stdout
        .split('\n')
        .map(line => line.trimEnd())  // FIX: only trim trailing whitespace
        .filter(line => line.length > 0);

      const changedFiles = lines.map(line => {
        const match = line.match(/^[ MADRCU?!]{2}\s+(.+)$/);
        if (match) {
          let filename = match[1];
          if (filename.startsWith('"') && filename.endsWith('"')) {
            filename = filename.slice(1, -1);
          }
          if (filename.includes(' -> ')) {
            filename = filename.split(' -> ')[1];
          }
          return filename;
        }
        return null;
      }).filter((f): f is string => f !== null);

      return {
        branch,
        hasChanges: changedFiles.length > 0,
        changedFiles: Object.freeze(changedFiles),
        isRepo: true,
      };
    } catch (error: any) {
      console.warn(`[GitManager] status error: ${error.message}`);
      return {
        branch: null,
        hasChanges: false,
        changedFiles: [],
        isRepo: false,
      };
    }
  }

  async commit(request: GitCommitRequest): Promise<GitCommitResult> {
    const timestamp = new Date().toISOString();

    try {
      if (!request.sessionId || request.sessionId.trim().length === 0) {
        return {
          success: false,
          commitHash: null,
          message: '',
          timestamp,
          error: 'Missing sessionId',
        };
      }

      if (!request.message || request.message.trim().length === 0) {
        return {
          success: false,
          commitHash: null,
          message: '',
          timestamp,
          error: 'Missing commit message',
        };
      }

      const isRepo = await this.isRepository();
      if (!isRepo) {
        return {
          success: false,
          commitHash: null,
          message: request.message,
          timestamp,
          error: 'Not a git repository',
        };
      }

      const status = await this.status();
      if (!status.hasChanges) {
        return {
          success: false,
          commitHash: null,
          message: request.message,
          timestamp,
          error: 'No changes to commit',
        };
      }

      console.log(`[GitManager] Committing: ${request.message}`);
      ExecutionLogger.log('GIT', '-', '-', `Committing: ${request.message}`, { changedFiles: request.changedFiles?.length ?? 0 });

      if (request.changedFiles && request.changedFiles.length > 0) {
        for (const file of request.changedFiles) {
          const addResult = await this.commandExecutor.execute(
            'git',
            ['add', '--', file],
            { cwd: this.cwd }
          );
          if (addResult.exitCode !== 0) {
            console.warn(`[GitManager] Failed to stage ${file}: ${addResult.stderr}`);
          }
        }
      } else {
        const addResult = await this.commandExecutor.execute(
          'git',
          ['add', '-A'],
          { cwd: this.cwd }
        );
        if (addResult.exitCode !== 0) {
          return {
            success: false,
            commitHash: null,
            message: request.message,
            timestamp,
            error: `Failed to stage changes: ${addResult.stderr}`,
          };
        }
      }

      const commitArgs = ['commit', '-m', request.message];

      if (request.author) {
        commitArgs.push(`--author=${request.author.name} <${request.author.email}>`);
      }

      const commitResult = await this.commandExecutor.execute(
        'git',
        commitArgs,
        { cwd: this.cwd }
      );

      if (commitResult.exitCode !== 0) {
        return {
          success: false,
          commitHash: null,
          message: request.message,
          timestamp,
          error: `Commit failed: ${commitResult.stderr}`,
        };
      }

      const hashResult = await this.commandExecutor.execute(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: this.cwd }
      );

      const commitHash = hashResult.exitCode === 0
        ? hashResult.stdout.trim()
        : 'unknown';

      console.log(`[GitManager] Commit successful: ${commitHash.substring(0, 7)}`);
      ExecutionLogger.log('GIT', '-', '-', `Commit successful: ${commitHash.substring(0, 7)}`);

      return {
        success: true,
        commitHash,
        message: request.message,
        timestamp,
      };
    } catch (error: any) {
      console.warn(`[GitManager] commit error: ${error.message}`);
      return {
        success: false,
        commitHash: null,
        message: request.message,
        timestamp,
        error: error.message,
      };
    }
  }

  async rollback(commitHash: string): Promise<GitRollbackResult> {
    try {
      if (!commitHash || commitHash.trim().length === 0) {
        return {
          success: false,
          restoredCommit: null,
          error: 'Missing commit hash',
        };
      }

      if (FORBIDDEN_ARGS_PATTERNS.some(pattern => pattern.test(commitHash))) {
        return {
          success: false,
          restoredCommit: null,
          error: 'Forbidden git operation (destructive command)',
        };
      }

      const isRepo = await this.isRepository();
      if (!isRepo) {
        return {
          success: false,
          restoredCommit: null,
          error: 'Not a git repository',
        };
      }

      console.log(`[GitManager] Rolling back to: ${commitHash}`);
      ExecutionLogger.log('GIT', '-', '-', `Rolling back to: ${commitHash}`);

      const revertResult = await this.commandExecutor.execute(
        'git',
        ['revert', '--no-edit', commitHash],
        { cwd: this.cwd }
      );

      if (revertResult.exitCode !== 0) {
        await this.commandExecutor.execute('git', ['revert', '--abort'], { cwd: this.cwd });
        return {
          success: false,
          restoredCommit: null,
          error: `Revert failed: ${revertResult.stderr}`,
        };
      }

      const hashResult = await this.commandExecutor.execute(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: this.cwd }
      );

      const restoredCommit = hashResult.exitCode === 0
        ? hashResult.stdout.trim()
        : commitHash;

      console.log(`[GitManager] Rollback successful: ${restoredCommit.substring(0, 7)}`);

      return {
        success: true,
        restoredCommit,
      };
    } catch (error: any) {
      console.warn(`[GitManager] rollback error: ${error.message}`);
      return {
        success: false,
        restoredCommit: null,
        error: error.message,
      };
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const isRepo = await this.isRepository();
      if (!isRepo) return null;

      const result = await this.commandExecutor.execute(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: this.cwd }
      );

      if (result.exitCode !== 0) return null;

      const branch = result.stdout.trim();
      return branch === 'HEAD' ? null : branch;
    } catch {
      return null;
    }
  }

  async listRecentCommits(count: number = 10): Promise<ReadonlyArray<GitCommitInfo>> {
    try {
      const isRepo = await this.isRepository();
      if (!isRepo) return Object.freeze([]);

      const result = await this.commandExecutor.execute(
        'git',
        ['log', `-${count}`, '--format=%H|%h|%s|%an|%aI'],
        { cwd: this.cwd }
      );

      if (result.exitCode !== 0) return Object.freeze([]);

      const commits: GitCommitInfo[] = [];
      const lines = result.stdout.split('\n').filter(line => line.trim().length > 0);

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 5) {
          commits.push({
            hash: parts[0],
            shortHash: parts[1],
            message: parts[2],
            author: parts[3],
            timestamp: parts[4],
          });
        }
      }

      return Object.freeze(commits);
    } catch {
      return Object.freeze([]);
    }
  }

  async isRepository(): Promise<boolean> {
    try {
      const result = await this.commandExecutor.execute(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        { cwd: this.cwd }
      );
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    } catch {
      return false;
    }
  }
}
