import { SemanticReferenceProvider, SemanticReference } from '../../contracts/semantic-reference-provider';
import { ProjectSnapshot } from '../../domain/snapshot';

/**
 * Null implementation of SemanticReferenceProvider.
 *
 * This is the DEFAULT provider. It always returns [] and reports isAvailable() = false.
 *
 * Used when:
 * - No experimental feature (LSP) is enabled
 * - No LSP server is configured
 * - As a fallback when the real provider fails
 *
 * Behavior: Preserves the original ContextSelector behavior (files: []).
 */
export class NullSemanticReferenceProvider implements SemanticReferenceProvider {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async findRelevantFiles(
    _task: string,
    _snapshot: ProjectSnapshot,
  ): Promise<ReadonlyArray<SemanticReference>> {
    return Object.freeze([]);
  }
}
