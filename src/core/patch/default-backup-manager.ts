import { BackupManager } from '../../contracts/backup-manager';
import { BackupMetadata } from '../../domain/patch';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Workspace } from '../../contracts/workspace';

const BACKUPS_DIR = 'backups';
const METADATA_FILE = 'metadata.json';

/**
 * R2.6: DefaultBackupManager
 *
 * File-based backup storage in .ai/backups/{session-id}/
 *
 * Storage layout:
 *   .ai/backups/{session-id}/
 *     ├── metadata.json
 *     └── files/
 *         └── {relative-path}/...  (original file contents)
 *
 * Uses two abstractions:
 *   - RuntimeRepository for backup storage (inside .ai/)
 *   - Workspace for reading project files (outside .ai/)
 */
export class DefaultBackupManager implements BackupManager {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly workspace: Workspace
  ) {}

  async createBackup(
    sessionId: string,
    files: ReadonlyArray<string>
  ): Promise<BackupMetadata> {
    const sanitizedId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const baseDir = `${BACKUPS_DIR}/${sanitizedId}`;
    const filesDir = `${baseDir}/files`;

    await this.runtime.mkdir(filesDir);

    const operations: Array<{
      path: string;
      operation: 'create' | 'modify' | 'delete';
      existed: boolean;
    }> = [];

    for (const filePath of files) {
      try {
        const existed = await this.workspace.exists(filePath);
        if (existed) {
          const content = await this.workspace.readFile(filePath);
          const backupPath = `${filesDir}/${filePath}`;
          await this.runtime.writeFile(backupPath, content);
          // Default to "modify" — caller's PatchOperation determines final type
          operations.push({ path: filePath, operation: 'modify', existed: true });
        } else {
          // File doesn't exist — record as "was missing" so rollback can delete
          operations.push({ path: filePath, operation: 'create', existed: false });
        }
      } catch (error: any) {
        console.warn(`[BackupManager] Failed to backup ${filePath}: ${error.message}`);
        // Record as "was missing" so we can safely rollback
        operations.push({ path: filePath, operation: 'create', existed: false });
      }
    }

    const metadata: BackupMetadata = Object.freeze({
      sessionId,
      createdAt: new Date().toISOString(),
      operations: Object.freeze(operations),
    });

    await this.runtime.writeFile(
      `${baseDir}/${METADATA_FILE}`,
      JSON.stringify(metadata, null, 2)
    );

    return metadata;
  }

  async restoreBackup(sessionId: string): Promise<boolean> {
    const sanitizedId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const baseDir = `${BACKUPS_DIR}/${sanitizedId}`;
    const metadataPath = `${baseDir}/${METADATA_FILE}`;

    try {
      const exists = await this.runtime.exists(metadataPath);
      if (!exists) {
        console.warn(`[BackupManager] No backup found for session: ${sessionId}`);
        return false;
      }

      const raw = await this.runtime.readFile(metadataPath);
      const metadata: BackupMetadata = JSON.parse(raw);
      const filesDir = `${baseDir}/files`;

      for (const op of metadata.operations) {
        try {
          if (op.existed) {
            // File existed at backup time — restore original content
            const backupPath = `${filesDir}/${op.path}`;
            const originalContent = await this.runtime.readFile(backupPath);
            await this.workspace.writeFile(op.path, originalContent);
          } else {
            // File did not exist at backup time — delete if now present
            const currentExists = await this.workspace.exists(op.path);
            if (currentExists) {
              await this.workspace.deleteFile(op.path);
            }
          }
        } catch (error: any) {
          console.warn(`[BackupManager] Failed to restore ${op.path}: ${error.message}`);
        }
      }

      return true;
    } catch (error: any) {
      console.warn(`[BackupManager] Restore failed: ${error.message}`);
      return false;
    }
  }

  async hasBackup(sessionId: string): Promise<boolean> {
    const sanitizedId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const metadataPath = `${BACKUPS_DIR}/${sanitizedId}/${METADATA_FILE}`;
    try {
      return await this.runtime.exists(metadataPath);
    } catch {
      return false;
    }
  }
}
