import { MigrationResult } from '../domain/configuration-migration';

export interface ConfigurationMigrator {
  /**
   * Migrate configuration to the current schema version.
   * Reads config, detects version, backs up, transforms, validates, writes.
   * Restores backup on failure.
   */
  migrate(): Promise<MigrationResult>;
}
