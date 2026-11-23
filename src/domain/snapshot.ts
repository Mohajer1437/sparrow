import { ProjectManifest } from './manifest';
import { ProjectRule } from './rule';
import { KnowledgeItem } from './knowledge';
import { ProjectMemoryEntry } from './memory';

export interface ProjectStatistics {
  readonly ruleCount: number;
  readonly knowledgeCount: number;
  readonly memoryCount: number;
}

export interface ProjectSnapshot {
  readonly manifest: ProjectManifest;
  readonly rules: readonly ProjectRule[];
  readonly knowledge: readonly KnowledgeItem[];
  readonly memory: readonly ProjectMemoryEntry[];
  readonly statistics: ProjectStatistics;
}
