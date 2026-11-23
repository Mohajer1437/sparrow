import { RoleMemoryRepository } from '../../contracts/role-memory-repository';
import { RoleMemoryEntry } from '../../domain/role-memory';
import { FileMemoryStorage } from './file-memory-storage';

export class DefaultRoleMemoryRepository implements RoleMemoryRepository {
  constructor(private readonly storage: FileMemoryStorage) {}

  private roleDir(roleId: string): string {
    return `memory/roles/${roleId}`;
  }

  private rolePath(roleId: string): string {
    return `memory/roles/${roleId}/memory.json`;
  }

  async load(roleId: string): Promise<ReadonlyArray<RoleMemoryEntry>> {
    const raw = await this.storage.read(this.rolePath(roleId));
    if (!raw) return Object.freeze([]);
    try {
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      return Object.freeze(entries.map((e: any) => Object.freeze({
        id: String(e.id ?? ''),
        roleId: String(e.roleId ?? roleId),
        content: String(e.content ?? ''),
        category: String(e.category ?? 'general'),
        createdAt: String(e.createdAt ?? new Date().toISOString()),
        updatedAt: e.updatedAt ? String(e.updatedAt) : undefined,
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  async save(roleId: string, entries: ReadonlyArray<RoleMemoryEntry>): Promise<void> {
    await this.storage.mkdir(this.roleDir(roleId));
    const data = JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2);
    await this.storage.write(this.rolePath(roleId), data);
  }

  async exists(roleId: string): Promise<boolean> {
    return this.storage.exists(this.rolePath(roleId));
  }
}
