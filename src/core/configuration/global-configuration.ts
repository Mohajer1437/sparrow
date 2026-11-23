import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface GlobalConfigData {
  currentWorkspace: string | null;
  knownWorkspaces: string[];
}

/**
 * GlobalConfiguration manages the agent's global runtime state.
 * This state persists across CLI executions and is independent of any specific workspace.
 */
export class GlobalConfiguration {
  private readonly globalDir: string;
  private readonly configPath: string;

  constructor() {
    this.globalDir = path.join(os.homedir(), '.sparrow');
    this.configPath = path.join(this.globalDir, 'config.json');
  }

  private async load(): Promise<GlobalConfigData> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const data = JSON.parse(content);
      return {
        currentWorkspace: typeof data.currentWorkspace === 'string' ? data.currentWorkspace : null,
        knownWorkspaces: Array.isArray(data.knownWorkspaces) ? data.knownWorkspaces : []
      };
    } catch {
      return { currentWorkspace: null, knownWorkspaces: [] };
    }
  }

  private async save(data: GlobalConfigData): Promise<void> {
    await fs.mkdir(this.globalDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getCurrentWorkspace(): Promise<string | null> {
    const data = await this.load();
    return data.currentWorkspace;
  }

  async setCurrentWorkspace(workspacePath: string): Promise<void> {
    const data = await this.load();
    data.currentWorkspace = workspacePath;
    if (!data.knownWorkspaces.includes(workspacePath)) {
      data.knownWorkspaces.push(workspacePath);
    }
    await this.save(data);
  }

  async getKnownWorkspaces(): Promise<string[]> {
    const data = await this.load();
    return data.knownWorkspaces;
  }
}
