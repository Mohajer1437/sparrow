import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function commitsCommand(countArg?: string): Promise<void> {
  try {
    const workspacePath = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspacePath, logger);
    const git = factory.createGitManager(workspacePath);

    const isRepo = await git.isRepository();
    if (!isRepo) {
      console.log('Not a git repository.');
      return;
    }

    const count = parseInt(countArg || '10', 10);
    if (isNaN(count) || count < 1) {
      console.error('Count must be a positive number');
      process.exit(1);
    }

    const commits = await git.listRecentCommits(Math.min(count, 100));

    console.log('═'.repeat(70));
    console.log(`RECENT COMMITS (${commits.length})`);
    console.log('═'.repeat(70));
    console.log('');

    if (commits.length === 0) {
      console.log('No commits found.');
      return;
    }

    for (const commit of commits) {
      const date = new Date(commit.timestamp).toLocaleString();
      console.log(`${commit.shortHash} ${commit.message}`);
      console.log(`  ${commit.author} — ${date}`);
      console.log('');
    }

    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to list commits: ${error.message}`);
    process.exit(1);
  }
}
