import { RoleMemoryEntry } from '../domain/role-memory';

export interface RoleMemoryRepository {
  load(roleId: string): Promise<ReadonlyArray<RoleMemoryEntry>>;
  save(roleId: string, entries: ReadonlyArray<RoleMemoryEntry>): Promise<void>;
  exists(roleId: string): Promise<boolean>;
}
