import { DocumentationState } from '../domain/architecture-documentation';

/**
 * DocumentationRepository abstracts documentation storage.
 * No direct filesystem dependency.
 */
export interface DocumentationRepository {
  load(): Promise<DocumentationState | null>;
  save(state: DocumentationState): Promise<void>;
  exists(): Promise<boolean>;
}
