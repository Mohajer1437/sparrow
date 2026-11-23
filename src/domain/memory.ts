export type MemoryScope = 'project' | 'working' | 'experience';

export interface ProjectMemoryEntry {
  readonly key: string;
  readonly value: unknown;
  readonly scope: MemoryScope;
  readonly filePath: string;
}
