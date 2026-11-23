import { DefaultGitManager } from '../../../src/core/git/default-git-manager';
import { CommandExecutor, CommandResult } from '../../../src/contracts/command-executor';

describe('DefaultGitManager', () => {
  let mockExecutor: jest.Mocked<CommandExecutor>;
  let git: DefaultGitManager;

  const successResult: CommandResult = {
    exitCode: 0, stdout: '', stderr: '', timedOut: false,
  };

  const failResult: CommandResult = {
    exitCode: 1, stdout: '', stderr: 'error', timedOut: false,
  };

  beforeEach(() => {
    mockExecutor = {
      execute: jest.fn(),
    };
    git = new DefaultGitManager(mockExecutor, '/workspace');
  });

  describe('isRepository', () => {
    it('returns true for git repository', async () => {
      mockExecutor.execute.mockResolvedValue({
        ...successResult, stdout: 'true\n',
      });
      expect(await git.isRepository()).toBe(true);
    });

    it('returns false for non-repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);
      expect(await git.isRepository()).toBe(false);
    });

    it('never throws on executor error', async () => {
      mockExecutor.execute.mockRejectedValue(new Error('Boom'));
      expect(await git.isRepository()).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns branch name', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'main\n' });

      expect(await git.getCurrentBranch()).toBe('main');
    });

    it('returns null for detached HEAD', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'HEAD\n' });

      expect(await git.getCurrentBranch()).toBeNull();
    });

    it('returns null for non-repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);
      expect(await git.getCurrentBranch()).toBeNull();
    });
  });

  describe('status', () => {
    it('returns full status with changes', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'main\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: ' M src/a.ts\nA  src/b.ts\n' });

      const status = await git.status();
      expect(status.isRepo).toBe(true);
      expect(status.branch).toBe('main');
      expect(status.hasChanges).toBe(true);
      expect(status.changedFiles).toContain('src/a.ts');
      expect(status.changedFiles).toContain('src/b.ts');
    });

    it('returns isRepo=false for non-repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);
      const status = await git.status();
      expect(status.isRepo).toBe(false);
      expect(status.hasChanges).toBe(false);
    });

    it('handles empty status gracefully', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'main\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: '' });

      const status = await git.status();
      expect(status.hasChanges).toBe(false);
      expect(status.changedFiles).toEqual([]);
    });
  });

  describe('commit', () => {
    it('creates a successful commit', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'main\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: ' M src/a.ts\n' })
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce({ ...successResult, stdout: 'abc123def456\n' });

      const result = await git.commit({
        sessionId: 'sess-1',
        message: 'feat: add feature',
        changedFiles: ['src/a.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc123def456');
    });

    it('fails when not a git repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);

      const result = await git.commit({
        sessionId: 'sess-1',
        message: 'feat: test',
        changedFiles: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a git repository');
    });

    it('fails on missing sessionId', async () => {
      const result = await git.commit({
        sessionId: '',
        message: 'test',
        changedFiles: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId');
    });

    it('fails on missing message', async () => {
      const result = await git.commit({
        sessionId: 's1',
        message: '',
        changedFiles: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('message');
    });

    it('never throws on unexpected errors', async () => {
      mockExecutor.execute.mockRejectedValue(new Error('Catastrophic'));

      await expect(git.commit({
        sessionId: 's1',
        message: 'test',
        changedFiles: [],
      })).resolves.toBeDefined();
    });

    it('stages only requested files in the configured repository cwd', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: 'main\n' })
        .mockResolvedValueOnce({ ...successResult, stdout: ' M app/page.tsx\n M data/saved_cards.json\n' })
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce({ ...successResult, stdout: 'abc123def456\n' });

      const result = await git.commit({
        sessionId: 'sess-1',
        message: 'feat: page comment',
        changedFiles: ['app/page.tsx'],
      });

      expect(result.success).toBe(true);
      const addCalls = mockExecutor.execute.mock.calls.filter(call => call[1]?.[0] === 'add');
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0][1]).toEqual(['add', '--', 'app/page.tsx']);
      expect(addCalls[0][2]).toEqual({ cwd: '/workspace' });
      expect(addCalls.some(call => String(call[1]).includes('saved_cards.json'))).toBe(false);
    });
  });

  describe('rollback', () => {
    it('rolls back to a commit successfully', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce({ ...successResult, stdout: 'new123\n' });

      const result = await git.rollback('abc123');

      expect(result.success).toBe(true);
      expect(result.restoredCommit).toBe('new123');
    });

    it('fails on missing commit hash', async () => {
      const result = await git.rollback('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing commit hash');
    });

    it('fails on non-repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);
      const result = await git.rollback('abc123');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a git repository');
    });

    it('rejects forbidden destructive commands', async () => {
      const result = await git.rollback('reset --hard HEAD');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Forbidden');
    });
  });

  describe('listRecentCommits', () => {
    it('parses commit log correctly', async () => {
      mockExecutor.execute
        .mockResolvedValueOnce({ ...successResult, stdout: 'true\n' })
        .mockResolvedValueOnce({
          ...successResult,
          stdout: 'hash1|h1|feat: add auth|John|2026-01-01T00:00:00Z\nhash2|h2|fix: bug|Jane|2026-01-02T00:00:00Z\n',
        });

      const commits = await git.listRecentCommits(2);
      expect(commits.length).toBe(2);
      expect(commits[0].shortHash).toBe('h1');
      expect(commits[0].message).toBe('feat: add auth');
      expect(commits[1].author).toBe('Jane');
    });

    it('returns empty array for non-repository', async () => {
      mockExecutor.execute.mockResolvedValue(failResult);
      const commits = await git.listRecentCommits();
      expect(commits).toEqual([]);
    });
  });
});
