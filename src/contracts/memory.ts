import { MemoryScope } from '../domain/memory';

export interface MemoryEntry {
  readonly key: string;
  readonly value: unknown;
  readonly scope: MemoryScope;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Memory {
  store(scope: MemoryScope, key: string, value: unknown): Promise<void>;
  retrieve(scope: MemoryScope, key: string): Promise<unknown | undefined>;
  list(scope: MemoryScope): Promise<readonly MemoryEntry[]>;
  clear(scope: MemoryScope): Promise<void>;
}
