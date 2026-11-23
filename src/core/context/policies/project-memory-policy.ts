import { MemoryPolicy } from '../../../contracts/policies/memory-policy';
import { ProjectMemoryEntry } from '../../../domain/memory';

export class ProjectMemoryPolicy implements MemoryPolicy {
  filter(memories: readonly ProjectMemoryEntry[]): ProjectMemoryEntry[] {
    return memories.filter(m => m.scope === 'project');
  }
}
