import * as fs from 'fs/promises';
import * as path from 'path';
import { FileSessionStore } from '../../contracts/file-session-store';
import { ExecutionSession } from '../../domain/session';

export class FileSessionStoreImpl implements FileSessionStore {
  private readonly sessionDir: string;

  constructor(workspaceRoot: string) {
    this.sessionDir = path.join(workspaceRoot, '.ai', 'sessions');
  }

  private getSessionPath(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionDir, `${safeId}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  private validateSession(data: any): data is ExecutionSession {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.id !== 'string') return false;
    if (typeof data.workspace !== 'string') return false;
    if (typeof data.task !== 'string') return false;
    if (typeof data.status !== 'string') return false;
    if (typeof data.createdAt !== 'string') return false;
    if (typeof data.updatedAt !== 'string') return false;
    if (!Array.isArray(data.steps)) return false;
    if (!Array.isArray(data.decisions)) return false;
    return true;
  }

  async save(session: ExecutionSession): Promise<boolean> {
    try {
      await this.ensureDirectory();
      const filePath = this.getSessionPath(session.id);
      
      try {
        await fs.access(filePath);
        console.warn(`[FileSessionStore] Session ${session.id} already exists`);
        return false;
      } catch {
        // File doesn't exist, proceed
      }

      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8');
      await fs.rename(tempPath, filePath);
      
      return true;
    } catch (error: any) {
      console.warn(`[FileSessionStore] Failed to save session ${session.id}: ${error.message}`);
      return false;
    }
  }

  async load(id: string): Promise<ExecutionSession | null> {
    try {
      const filePath = this.getSessionPath(id);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!this.validateSession(data)) {
        console.warn(`[FileSessionStore] Invalid session data for ${id}`);
        return null;
      }
      
      return data;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`[FileSessionStore] Failed to load session ${id}: ${error.message}`);
      }
      return null;
    }
  }

  async update(session: ExecutionSession): Promise<boolean> {
    try {
      const filePath = this.getSessionPath(session.id);
      
      try {
        await fs.access(filePath);
      } catch {
        console.warn(`[FileSessionStore] Session ${session.id} not found for update`);
        return false;
      }

      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8');
      await fs.rename(tempPath, filePath);
      
      return true;
    } catch (error: any) {
      console.warn(`[FileSessionStore] Failed to update session ${session.id}: ${error.message}`);
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const filePath = this.getSessionPath(id);
      await fs.unlink(filePath);
      return true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`[FileSessionStore] Failed to delete session ${id}: ${error.message}`);
      }
      return false;
    }
  }

  async list(workspace: string): Promise<ReadonlyArray<ExecutionSession>> {
    try {
      await this.ensureDirectory();
      const files = await fs.readdir(this.sessionDir);
      const sessions: ExecutionSession[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const id = file.slice(0, -5);
        const session = await this.load(id);
        
        if (session && session.workspace === workspace) {
          sessions.push(session);
        }
      }

      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      
      return sessions;
    } catch (error: any) {
      console.warn(`[FileSessionStore] Failed to list sessions: ${error.message}`);
      return [];
    }
  }
}
