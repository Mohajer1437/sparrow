import { WorkspaceSession } from '../domain/workspace-session';

export interface SessionStore {
  create(session: WorkspaceSession): Promise<void>;
  get(id: string): Promise<WorkspaceSession | null>;
  update(id: string, patch: Partial<WorkspaceSession>): Promise<WorkspaceSession | null>;
  list(workspacePath: string): Promise<ReadonlyArray<WorkspaceSession>>;
  delete(id: string): Promise<boolean>;
}
