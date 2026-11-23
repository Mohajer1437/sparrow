import { ExecutionSession } from '../domain/session';

export interface FileSessionStore {
  save(session: ExecutionSession): Promise<boolean>;
  load(id: string): Promise<ExecutionSession | null>;
  update(session: ExecutionSession): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  list(workspace: string): Promise<ReadonlyArray<ExecutionSession>>;
}
