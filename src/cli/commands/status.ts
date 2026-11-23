import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';

export async function statusCommand() {
  const logger: Logger = { debug: () => {}, info: console.log, warn: console.warn, error: console.error };
  const factory = new AppFactory(await resolveWorkspaceRoot(), logger);
  const config = factory.createConfiguration();
  
  if (!(await config.exists())) {
    console.error('Error: Workspace not initialized. Run "agent init".');
    process.exit(1);
  }

  try {
    // Load config first to populate internal state
    await config.load();
    
    const workspace = factory.createWorkspace();
    // Pass the loaded config instance to DiscoveryService
    const discovery = factory.createDiscoveryService(config);

    const snapshot = await discovery.discover();

    console.log('Project Status:');
    console.log(`  Name: ${snapshot.manifest.name}`);
    console.log(`  Version: ${snapshot.manifest.version}`);
    console.log(`  Rules: ${snapshot.statistics.ruleCount}`);
    console.log(`  Knowledge: ${snapshot.statistics.knowledgeCount}`);
    console.log(`  Memory: ${snapshot.statistics.memoryCount}`);
    
    console.log(`  Config Version: ${config.get('version')}`);
    console.log('  Workspace: OK');
  } catch (err: any) {
    console.error(`Discovery Failed: ${err.message}`);
    process.exit(1);
  }
}
