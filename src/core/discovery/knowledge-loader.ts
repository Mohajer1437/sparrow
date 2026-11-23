import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Configuration } from '../../contracts/configuration';
import { KnowledgeItem } from '../../domain/knowledge';

export class KnowledgeLoader {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly config: Configuration
  ) {}

  async load(): Promise<KnowledgeItem[]> {
    const paths = this.config.get('paths');
    if (!paths) throw new Error('Configuration paths not defined');

    const knowledgeDir = paths.knowledgeDir;
    if (!(await this.runtime.exists(knowledgeDir))) {
      return [];
    }

    const files = await this.runtime.listFiles(knowledgeDir);
    const items: KnowledgeItem[] = [];
    
    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await this.runtime.readFile(file);
        const fileName = file.split('/').pop() || file.split('\\').pop() || '';
        items.push({
          id: fileName.replace('.md', ''),
          content,
          filePath: file
        });
      }
    }
    return items;
  }
}
