import { DocumentationRepository } from '../../contracts/documentation-repository';
import { DocumentationState } from '../../domain/architecture-documentation';
import { RuntimeRepository } from '../../contracts/runtime-repository';

const DOC_DIR = 'documentation';
const DOC_PATH = 'documentation/state.json';

export class FileDocumentationRepository implements DocumentationRepository {
  constructor(private readonly runtime: RuntimeRepository) {}

  async load(): Promise<DocumentationState | null> {
    try {
      const exists = await this.runtime.exists(DOC_PATH);
      if (!exists) return null;
      const raw = await this.runtime.readFile(DOC_PATH);
      const parsed = JSON.parse(raw);
      return Object.freeze({
        components: Object.freeze(parsed.components ?? []),
        decisions: Object.freeze(parsed.decisions ?? []),
        mappings: Object.freeze(parsed.mappings ?? []),
        generatedAt: String(parsed.generatedAt ?? new Date().toISOString()),
        version: String(parsed.version ?? '1.0.0'),
      });
    } catch {
      return null;
    }
  }

  async save(state: DocumentationState): Promise<void> {
    await this.runtime.mkdir(DOC_DIR);
    await this.runtime.writeFile(DOC_PATH, JSON.stringify(state, null, 2));
  }

  async exists(): Promise<boolean> {
    return this.runtime.exists(DOC_PATH);
  }
}
