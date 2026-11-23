import { WorkspaceKnowledge } from '../domain/workspace-knowledge';

export interface MemoryContextBuilder {
  build(knowledge: WorkspaceKnowledge): string;
}
