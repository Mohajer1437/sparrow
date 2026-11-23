import { ProjectSnapshot } from '../../domain/snapshot';
import { ManifestLoader } from './manifest-loader';
import { RuleLoader } from './rule-loader';
import { KnowledgeLoader } from './knowledge-loader';
import { MemoryLoader } from './memory-loader';

export class ProjectDiscoveryService {
  constructor(
    private readonly manifestLoader: ManifestLoader,
    private readonly ruleLoader: RuleLoader,
    private readonly knowledgeLoader: KnowledgeLoader,
    private readonly memoryLoader: MemoryLoader
  ) {}

  async discover(): Promise<ProjectSnapshot> {
    const manifest = await this.manifestLoader.load();
    const rules = await this.ruleLoader.load();
    const knowledge = await this.knowledgeLoader.load();
    const memory = await this.memoryLoader.load();

    const snapshot: ProjectSnapshot = {
      manifest,
      rules: Object.freeze([...rules]),
      knowledge: Object.freeze([...knowledge]),
      memory: Object.freeze([...memory]),
      statistics: Object.freeze({
        ruleCount: rules.length,
        knowledgeCount: knowledge.length,
        memoryCount: memory.length,
      })
    };

    return Object.freeze(snapshot);
  }
}
