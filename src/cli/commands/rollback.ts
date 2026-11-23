import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function rollbackCommand(commitHash: string): Promise<void> {
  if (!commitHash || commitHash.trim().length === 0) {
    console.error('Usage: agent rollback <commit-hash>');
    process.exit(1);
  }

  try {
    const workspacePath = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspacePath, logger);
    const git = factory.createGitManager(workspacePath);

    console.log('═'.repeat(70));
    console.log('GIT ROLLBACK');
    console.log('═'.repeat(70));
    console.log('');
    console.log(`Rolling back commit: ${commitHash}`);
    console.log('(Using safe revert, not reset --hard)');
    console.log('');

    const result = await git.rollback(commitHash);

    if (result.success) {
      console.log(`✓ Rollback successful`);
      console.log(`  New revert commit: ${result.restoredCommit?.substring(0, 7)}`);
    } else {
      console.log(`✗ Rollback failed`);
      console.log(`  Error: ${result.error}`);
      process.exit(1);
    }

    console.log('');
    console.log('═'.repeat(70));
  } catch (error: any) {
    console.error(`Failed to rollback: ${error.message}`);
    process.exit(1);
  }
}
