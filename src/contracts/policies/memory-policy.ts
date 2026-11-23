import { ProjectMemoryEntry } from '../../domain/memory';

export interface MemoryPolicy {
  filter(memories: readonly ProjectMemoryEntry[]): ProjectMemoryEntry[];
}
