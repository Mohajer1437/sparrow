import { BackupMetadata } from '../domain/patch';

/**
 * R2.6: BackupManager Contract
 *
 * Creates and restores backups of files before mutation.
 * Storage is implementation-specific (file-based in .ai/backups/).
 *
 * Rules:
 *   - Never crash on missing files
 *   - Backups are retained until session completes
 *   - Restore is idempotent (safe to call multiple times)
 */
export interface BackupManager {
  /**
   * Create a backup of the given files for the session.
   * Files that do not exist are recorded as "missing" in metadata
   * (needed to rollback create operations).
   */
  createBackup(
    sessionId: string,
    files: ReadonlyArray<string>
  ): Promise<BackupMetadata>;

  /**
   * Restore all files from the backup for the given session.
   * Returns true if restore succeeded, false if backup missing.
   */
  restoreBackup(sessionId: string): Promise<boolean>;

  /**
   * Check if a backup exists for the given session.
   */
  hasBackup(sessionId: string): Promise<boolean>;
}
