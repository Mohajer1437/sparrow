import { ContextRequest, ContextFile } from '../../domain/context';
import { ProjectRule } from '../../domain/rule';
import { KnowledgeItem } from '../../domain/knowledge';
import { ProjectMemoryEntry } from '../../domain/memory';
import { SemanticReferenceProvider } from '../../contracts/semantic-reference-provider';

export interface SelectedContext {
  readonly rules: readonly ProjectRule[];
  readonly knowledge: readonly KnowledgeItem[];
  readonly memories: readonly ProjectMemoryEntry[];
  readonly files: readonly ContextFile[];
}

export class ContextSelector {
  constructor(
    private readonly semanticProvider?: SemanticReferenceProvider,
  ) {}

  async select(request: ContextRequest): Promise<SelectedContext> {
    let files: ContextFile[] = [];

    if (this.semanticProvider) {
      try {
        const available = await this.semanticProvider.isAvailable();
        if (available) {
          const refs = await this.semanticProvider.findRelevantFiles(
            request.task,
            request.snapshot,
          );
          files = refs.map(ref => ({
            path: ref.path,
            content: '', // Phase 3b will add a ContextFileLoader to populate content
            relevanceScore: ref.relevanceScore,
          }));
        }
      } catch (err: any) {
        // Graceful degradation: if provider fails, fall back to empty files
        // NEVER break execution on provider failure
        console.warn(
          `[ContextSelector] Semantic provider failed (non-fatal, falling back): ${err?.message ?? err}`,
        );
        files = [];
      }
    }

    return {
      rules: request.snapshot.rules,
      knowledge: request.snapshot.knowledge,
      memories: request.snapshot.memory,
      files: Object.freeze(files),
    };
  }
}
