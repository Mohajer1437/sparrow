import { MigrationStep } from '../../domain/configuration-migration';

/**
 * Table-driven migration registry.
 * Each step transforms config from one schema version to the next.
 * Chain: v0 → v1 → v2 → ... → CURRENT_SCHEMA_VERSION
 *
 * Currently contains only the legacy identity migration (v0 → v1)
 * so the full pipeline (backup, transform, validate, write, restore)
 * can be tested without introducing a real schema v2.
 */
export const MIGRATIONS: ReadonlyArray<MigrationStep> = Object.freeze([
  Object.freeze({
    fromVersion: 0,
    toVersion: 1,
    description: 'Legacy migration: adds schemaVersion field to configuration',
    transform: (config: Readonly<Record<string, unknown>>): Record<string, unknown> => {
      return { ...config, schemaVersion: 1 };
    },
  }),
]);
