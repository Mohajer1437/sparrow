import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function gitStatusCommand(): Promise<void> {
  try {
    const workspacePath = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspacePath, logger);
    const git = factory.createGitManager(workspacePath);

    const isRepo = await git.isRepository();
    if (!isRepo) {
      console.log('Not a git repository.');
      console.log(`Workspace: ${workspacePath}`);
      console.log('');
      console.log('To initialize:');
      console.log('  git init');
      return;
    }

    const status = await git.status();

    console.log('═'.repeat(70));
    console.log('GIT STATUS');
    console.log('═'.repeat(70));
    console.log('');
    console.log(`Branch: ${status.branch || '(detached HEAD)'}`);
    console.log('');

    if (status.hasChanges) {
      console.log(`Changes (${status.changedFiles.length} file${status.changedFiles.length === 1 ? '' : 's'}):`);
      for (const file of status.changedFiles) {
        console.log(`  - ${file}`);
      }
    } else {
      console.log('No changes. Working directory clean.');
    }

    console.log('');
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to get git status: ${error.message}`);
    process.exit(1);
  }
}
