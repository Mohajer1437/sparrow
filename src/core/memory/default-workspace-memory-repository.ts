import { WorkspaceMemoryRepository } from '../../contracts/workspace-memory-repository';
import { SharedMemoryEntry } from '../../domain/role-memory';
import { FileMemoryStorage } from './file-memory-storage';

const SHARED_DIR = 'memory/shared';
const SHARED_PATH = 'memory/shared/memory.json';

export class DefaultWorkspaceMemoryRepository implements WorkspaceMemoryRepository {
  constructor(private readonly storage: FileMemoryStorage) {}

  async load(): Promise<ReadonlyArray<SharedMemoryEntry>> {
    const raw = await this.storage.read(SHARED_PATH);
    if (!raw) return Object.freeze([]);
    try {
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      return Object.freeze(entries.map((e: any) => Object.freeze({
        id: String(e.id ?? ''),
        content: String(e.content ?? ''),
        category: String(e.category ?? 'general'),
        createdAt: String(e.createdAt ?? new Date().toISOString()),
        updatedAt: e.updatedAt ? String(e.updatedAt) : undefined,
      })));
    } catch {
      return Object.freeze([]);
    }
  }

  async save(entries: ReadonlyArray<SharedMemoryEntry>): Promise<void> {
    await this.storage.mkdir(SHARED_DIR);
    const data = JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2);
    await this.storage.write(SHARED_PATH, data);
  }

  async exists(): Promise<boolean> {
    return this.storage.exists(SHARED_PATH);
  }
}
