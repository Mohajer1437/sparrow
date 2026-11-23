import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';

export async function doctorCommand() {
  console.log('Running system health check...');
  
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major < 18) {
    console.error('FAIL: Node.js 18+ is required.');
    process.exit(1);
  }
  console.log('OK: Node.js version is 18+');

  const logger: Logger = { debug: () => {}, info: console.log, warn: console.warn, error: console.error };
  const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
  const config = factory.createConfiguration();

  if (!(await config.exists())) {
    console.warn('WARN: .ai/config.json not found. Run "agent init" first.');
  } else {
    try {
      await config.load();
      console.log('OK: Configuration is valid.');
    } catch (err: any) {
      console.error(`FAIL: Configuration is invalid: ${err.message}`);
      process.exit(1);
    }
  }

  const workspace = factory.createWorkspace();
  try {
    await workspace.listFiles('.');
    console.log('OK: Workspace is readable.');
  } catch (err: any) {
    console.warn(`WARN: Workspace check failed: ${err.message}`);
  }

  console.log('System health check passed.');
}
