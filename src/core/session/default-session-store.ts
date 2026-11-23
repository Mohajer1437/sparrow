import { SessionStore } from '../../contracts/session-store';
import { WorkspaceSession } from '../../domain/workspace-session';
import { RuntimeRepository } from '../../contracts/runtime-repository';

const SESSIONS_DIR = 'sessions';

export class DefaultSessionStore implements SessionStore {
  constructor(
    private readonly runtime: RuntimeRepository
  ) {}

  async create(session: WorkspaceSession): Promise<void> {
    const filePath = this.sessionPath(session.id);
    const exists = await this.runtime.exists(filePath);
    if (exists) {
      throw new Error(`Session already exists: ${session.id}`);
    }
    await this.writeSession(filePath, session);
  }

  async get(id: string): Promise<WorkspaceSession | null> {
    const filePath = this.sessionPath(id);
    return this.readSessionSafely(filePath);
  }

  async update(id: string, patch: Partial<WorkspaceSession>): Promise<WorkspaceSession | null> {
    const filePath = this.sessionPath(id);
    const existing = await this.readSessionSafely(filePath);
    if (!existing) {
      return null;
    }

    const updated: WorkspaceSession = Object.freeze({
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
      events: patch.events
        ? Object.freeze([...existing.events, ...patch.events])
        : existing.events,
    });

    await this.writeSession(filePath, updated);
    return updated;
  }

  async list(workspacePath: string): Promise<ReadonlyArray<WorkspaceSession>> {
    try {
      const dirExists = await this.runtime.exists(SESSIONS_DIR);
      if (!dirExists) {
        return Object.freeze([]);
      }

      const files = await this.runtime.listFiles(SESSIONS_DIR);
      const sessions: WorkspaceSession[] = [];

      for (const filePath of files) {
        if (!filePath.endsWith('.json')) continue;
        const session = await this.readSessionSafely(filePath);
        if (session && session.workspacePath === workspacePath) {
          sessions.push(session);
        }
      }

      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return Object.freeze(sessions);
    } catch (error: any) {
      console.warn(`[SessionStore] list failed: ${error.message}`);
      return Object.freeze([]);
    }
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.sessionPath(id);
    const exists = await this.runtime.exists(filePath);
    if (!exists) return false;

    await this.runtime.writeFile(filePath, JSON.stringify({ _deleted: true }));
    return true;
  }

  private sessionPath(id: string): string {
    const sanitized = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    return `${SESSIONS_DIR}/${sanitized}.json`;
  }

  private async writeSession(filePath: string, session: WorkspaceSession): Promise<void> {
    const content = JSON.stringify(session, null, 2);
    await this.runtime.writeFile(filePath, content);
  }

  private async readSessionSafely(filePath: string): Promise<WorkspaceSession | null> {
    try {
      const exists = await this.runtime.exists(filePath);
      if (!exists) return null;

      const raw = await this.runtime.readFile(filePath);
      if (!raw || raw.trim().length === 0) return null;

      const parsed = JSON.parse(raw);

      if (parsed && parsed._deleted === true) {
        return null;
      }

      if (!this.isValidSession(parsed)) {
        console.warn(`[SessionStore] Invalid session file: ${filePath}`);
        return null;
      }

      return Object.freeze(parsed);
    } catch (error: any) {
      console.warn(`[SessionStore] Failed to read ${filePath}: ${error.message}`);
      return null;
    }
  }

  private isValidSession(obj: any): obj is WorkspaceSession {
    return (
      obj &&
      typeof obj.id === 'string' &&
      typeof obj.workspacePath === 'string' &&
      typeof obj.task === 'string' &&
      typeof obj.status === 'string' &&
      Array.isArray(obj.events) &&
      typeof obj.createdAt === 'string' &&
      typeof obj.updatedAt === 'string'
    );
  }
}
