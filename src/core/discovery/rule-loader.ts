import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Configuration } from '../../contracts/configuration';
import { ProjectRule } from '../../domain/rule';

export class RuleLoader {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly config: Configuration
  ) {}

  async load(): Promise<ProjectRule[]> {
    const paths = this.config.get('paths');
    if (!paths) throw new Error('Configuration paths not defined');

    const rulesDir = paths.rulesDir;
    if (!(await this.runtime.exists(rulesDir))) {
      return [];
    }

    const files = await this.runtime.listFiles(rulesDir);
    const rules: ProjectRule[] = [];
    
    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await this.runtime.readFile(file);
        const fileName = file.split('/').pop() || file.split('\\').pop() || '';
        rules.push({
          id: fileName.replace('.md', ''),
          content,
          filePath: file
        });
      }
    }
    return rules;
  }
}
