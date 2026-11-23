import { ProjectRule } from './rule';
import { KnowledgeItem } from './knowledge';
import { ProjectMemoryEntry } from './memory';
import { ProjectSnapshot } from './snapshot';
import { Message } from './message';

export interface ContextFile {
  readonly path: string;
  readonly content: string;
  readonly relevanceScore?: number;
}

export interface ContextObject {
  readonly taskIntent: string;
  readonly files: ReadonlyArray<Readonly<ContextFile>>;
  readonly rules: ReadonlyArray<Readonly<ProjectRule>>;
  readonly knowledge: ReadonlyArray<Readonly<KnowledgeItem>>;
  readonly memories: ReadonlyArray<Readonly<ProjectMemoryEntry>>;
  readonly roleMemory?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ContextRequest {
  readonly task: string;
  readonly snapshot: ProjectSnapshot;
  readonly history?: ReadonlyArray<Readonly<Message>>;
  readonly signal?: AbortSignal;
}
