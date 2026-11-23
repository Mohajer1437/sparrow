import { SharedMemoryEntry } from '../domain/role-memory';

export interface WorkspaceMemoryRepository {
  load(): Promise<ReadonlyArray<SharedMemoryEntry>>;
  save(entries: ReadonlyArray<SharedMemoryEntry>): Promise<void>;
  exists(): Promise<boolean>;
}
