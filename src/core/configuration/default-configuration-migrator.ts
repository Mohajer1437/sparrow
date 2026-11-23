import { ConfigurationMigrator } from '../../contracts/configuration-migrator';
import { MigrationResult, MigrationStep } from '../../domain/configuration-migration';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { CURRENT_SCHEMA_VERSION } from '../../domain/effective-configuration';
import { MIGRATIONS } from './migrations';

export class DefaultConfigurationMigrator implements ConfigurationMigrator {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly migrations: ReadonlyArray<MigrationStep> = MIGRATIONS
  ) {}

  async migrate(): Promise<MigrationResult> {
    // Step 1: Read config
    const exists = await this.runtime.exists('config.json');
    if (!exists) {
      return Object.freeze({
        success: false,
        fromVersion: 0,
        toVersion: CURRENT_SCHEMA_VERSION,
        stepsApplied: Object.freeze([]),
        error: 'No configuration file found. Run "agent init" first.',
      });
    }

    const raw = await this.runtime.readFile('config.json');
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(raw);
    } catch (err: any) {
      return Object.freeze({
        success: false,
        fromVersion: 0,
        toVersion: CURRENT_SCHEMA_VERSION,
        stepsApplied: Object.freeze([]),
        error: `Invalid JSON in config.json: ${err.message}`,
      });
    }

    // Step 2: Detect schema version
    const fromVersion: number =
      typeof config.schemaVersion === 'number' ? config.schemaVersion : 1;

    // Step 3: Already current
    if (fromVersion === CURRENT_SCHEMA_VERSION) {
      return Object.freeze({
        success: true,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        stepsApplied: Object.freeze([]),
      });
    }

    // Step 4: Newer than current
    if (fromVersion > CURRENT_SCHEMA_VERSION) {
      return Object.freeze({
        success: false,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        stepsApplied: Object.freeze([]),
        error:
          `Config created by newer Sparrow version (schema ${fromVersion}). ` +
          `Current: ${CURRENT_SCHEMA_VERSION}. Please upgrade Sparrow.`,
      });
    }

    // Step 5: Backup original
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupPath = `backups/config-v${fromVersion}-v${CURRENT_SCHEMA_VERSION}-${timestamp}.json`;
    await this.runtime.mkdir('backups');
    await this.runtime.writeFile(backupPath, raw);

    // Step 6: Transform chain
    let current: Record<string, unknown> = { ...config };
    let currentVersion = fromVersion;
    const stepsApplied: number[] = [];

    try {
      while (currentVersion < CURRENT_SCHEMA_VERSION) {
        const step = this.migrations.find(m => m.fromVersion === currentVersion);
        if (!step) {
          throw new Error(
            `No migration found for version ${currentVersion} → ${currentVersion + 1}`
          );
        }
        current = step.transform(current);
        currentVersion = step.toVersion;
        stepsApplied.push(step.toVersion);
      }

      // Step 7: Validate transformed config
      if (current.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        throw new Error(
          `Migration validation failed: expected schemaVersion ${CURRENT_SCHEMA_VERSION}, ` +
          `got ${current.schemaVersion}`
        );
      }

      // Step 8: Atomic write
      await this.runtime.writeFile('config.json', JSON.stringify(current, null, 2));

      return Object.freeze({
        success: true,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        backupPath,
        stepsApplied: Object.freeze(stepsApplied),
      });
    } catch (err: any) {
      // Step 9: Restore backup on failure
      try {
        await this.runtime.writeFile('config.json', raw);
      } catch {
        // If restore also fails, backup file still exists for manual recovery
      }

      return Object.freeze({
        success: false,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        backupPath,
        stepsApplied: Object.freeze(stepsApplied),
        error: `Migration failed: ${err.message}. Backup restored from ${backupPath}.`,
      });
    }
  }
}
