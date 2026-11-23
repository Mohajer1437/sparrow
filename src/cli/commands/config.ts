import { AppFactory } from '../../core/app-factory';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { parseQualityProfile } from '../../domain/quality-profile';

const logger = {
  debug: () => {},
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

export async function configCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub) {
    console.error('Usage: agent config [migrate|show|set qualityProfile <MVP|STANDARD|PRODUCTION>]');
    process.exit(2);
    return;
  }

  if (sub === 'migrate') {
    await migrateConfig();
    return;
  }

  if (sub === 'show') {
    await showConfig();
    return;
  }

  if (sub === 'set') {
    await setConfig(args.slice(1));
    return;
  }

  console.error('Unknown config subcommand: ' + sub);
  console.error('Usage: agent config [migrate|show|set qualityProfile <MVP|STANDARD|PRODUCTION>]');
  process.exit(2);
}

async function migrateConfig(): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const migrator = factory.createConfigurationMigrator();
    const result = await migrator.migrate();

    if (result.success) {
      if (result.stepsApplied.length === 0) {
        console.log('Configuration is already up to date.');
        console.log('  Schema version: ' + result.toVersion);
      } else {
        console.log('Configuration migrated successfully.');
        console.log('  From:   v' + result.fromVersion);
        console.log('  To:     v' + result.toVersion);
        console.log('  Steps:  ' + result.stepsApplied.join(' -> '));
        if (result.backupPath) {
          console.log('  Backup: .ai/' + result.backupPath);
        }
      }
    } else {
      console.error(result.error);
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Migration failed: ' + error.message);
    process.exit(1);
  }
}

async function showConfig(): Promise<void> {
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const loader = factory.createConfigurationLoader();
    const cfg = await loader.load();
    console.log('qualityProfile: ' + (cfg.qualityProfile ?? 'STANDARD'));
    console.log('defaultProvider: ' + cfg.defaultProvider);
    console.log('defaultModel: ' + cfg.defaultModel);
    console.log('ollamaBaseUrl: ' + cfg.ollamaBaseUrl);
  } catch (error: any) {
    console.error('Failed to show config: ' + error.message);
    process.exit(1);
  }
}

async function setConfig(args: string[]): Promise<void> {
  const key = args[0];
  const value = args[1];
  if (key !== 'qualityProfile' || !value) {
    console.error('Usage: agent config set qualityProfile <MVP|STANDARD|PRODUCTION>');
    process.exit(2);
    return;
  }
  const profile = parseQualityProfile(value);
  if (profile !== value) {
    console.error('Invalid qualityProfile. Use MVP, STANDARD, or PRODUCTION.');
    process.exit(2);
    return;
  }
  try {
    const workspaceRoot = await resolveWorkspaceRoot();
    const factory = new AppFactory(workspaceRoot, logger);
    const runtime = factory.createRuntimeRepository();
    let raw: Record<string, unknown> = {};
    if (await runtime.exists('config.json')) {
      raw = JSON.parse(await runtime.readFile('config.json'));
    }
    raw.qualityProfile = profile;
    await runtime.writeFile('config.json', JSON.stringify(raw, null, 2));
    console.log('qualityProfile set to ' + profile);
  } catch (error: any) {
    console.error('Failed to set config: ' + error.message);
    process.exit(1);
  }
}
