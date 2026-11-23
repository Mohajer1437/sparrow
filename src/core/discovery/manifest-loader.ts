import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Configuration } from '../../contracts/configuration';
import { ProjectManifest } from '../../domain/manifest';
import { Logger } from '../../contracts/logger';

export class ManifestLoader {
  constructor(
    private readonly runtime: RuntimeRepository,
    private readonly config: Configuration,
    private readonly logger: Logger
  ) {}

  async load(): Promise<ProjectManifest> {
    const paths = this.config.get('paths');
    if (!paths) throw new Error('Configuration paths not defined');
    
    const manifestFile = `${paths.manifestDir}/manifest.json`;
    
    if (!(await this.runtime.exists(manifestFile))) {
      throw new Error(`Missing required file: ${manifestFile}`);
    }

    try {
      const content = await this.runtime.readFile(manifestFile);
      return JSON.parse(content) as ProjectManifest;
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        this.logger.error(`Invalid JSON in ${manifestFile}`);
        throw new Error(`Invalid JSON in ${manifestFile}`);
      }
      throw err;
    }
  }
}
