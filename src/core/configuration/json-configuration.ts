import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Configuration, PlatformConfig } from '../../contracts/configuration';

/**
 * JsonConfiguration is strictly a configuration loader and storage mechanism.
 * It must NOT contain provider logic, workspace logic, or business logic.
 * Its sole responsibility is to load, save, get, set, and validate configuration data.
 */
export class JsonConfiguration implements Configuration {
  private config: PlatformConfig | null = null;

  constructor(private readonly runtime: RuntimeRepository) {}

  async load(): Promise<PlatformConfig> {
    try {
      const content = await this.runtime.readFile('config.json');
      this.config = JSON.parse(content) as PlatformConfig;
      if (!this.config.version) {
        throw new Error('Invalid configuration: missing version');
      }
      if (!this.config.paths) {
        throw new Error('Invalid configuration: missing paths');
      }
      return this.config;
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
        throw new Error('Configuration not found. Run "agent init" first.');
      }
      throw new Error(`Failed to load configuration: ${err.message}`);
    }
  }

  get<K extends keyof PlatformConfig>(key: K): PlatformConfig[K] | undefined {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config[key];
  }

  async set<K extends keyof PlatformConfig>(key: K, value: PlatformConfig[K]): Promise<void> {
    if (!this.config) {
      await this.load();
    }
    this.config![key] = value;
    await this.runtime.writeFile('config.json', JSON.stringify(this.config, null, 2));
  }
  
  async initialize(): Promise<void> {
     const defaultConfig: PlatformConfig = { 
       version: '0.1.0',
       paths: {
         manifestDir: 'manifest',
         rulesDir: 'rules',
         knowledgeDir: 'knowledge',
         memoryDir: 'memory'
       }
     };
     await this.runtime.writeFile('config.json', JSON.stringify(defaultConfig, null, 2));
     this.config = defaultConfig;
  }
  
  async exists(): Promise<boolean> {
     return this.runtime.exists('config.json');
  }
}
