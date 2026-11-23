import { RuntimeRepository } from '../../contracts/runtime-repository';

export class FileMemoryStorage {
  constructor(private readonly runtime: RuntimeRepository) {}

  async read(filePath: string): Promise<string | null> {
    try {
      const exists = await this.runtime.exists(filePath);
      if (!exists) return null;
      return await this.runtime.readFile(filePath);
    } catch {
      return null;
    }
  }

  async write(filePath: string, content: string): Promise<void> {
    await this.runtime.writeFile(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.runtime.exists(filePath);
  }

  async mkdir(dirPath: string): Promise<void> {
    await this.runtime.mkdir(dirPath);
  }
}
