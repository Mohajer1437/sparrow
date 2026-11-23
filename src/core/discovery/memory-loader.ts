import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Configuration } from '../../contracts/configuration';
import { ProjectMemoryEntry } from '../../domain/memory';

export class MemoryLoader {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly config: Configuration
  ) {}

  async load(): Promise<ProjectMemoryEntry[]> {
    const paths = this.config.get('paths');
    if (!paths) throw new Error('Configuration paths not defined');

    const memoryDir = paths.memoryDir;
    if (!(await this.runtime.exists(memoryDir))) {
      return [];
    }

    const files = await this.runtime.listFiles(memoryDir);
    const items: ProjectMemoryEntry[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await this.runtime.readFile(file);
          const data = JSON.parse(content);
          const fileName = file.split('/').pop() || file.split('\\').pop() || '';
          items.push({
            key: data.key || fileName.replace('.json', ''),
            value: data.value,
            scope: 'project',
            filePath: file
          });
        } catch (err: any) {
          if (err instanceof SyntaxError) {
            throw new Error(`Invalid JSON in memory file: ${file}`);
          }
          throw err;
        }
      }
    }
    return items;
  }
}
