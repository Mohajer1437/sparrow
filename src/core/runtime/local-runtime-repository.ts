import fs from 'fs/promises';
import path from 'path';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { KnowledgeCandidate } from '../../domain/knowledge-feedback';

export class LocalRuntimeRepository implements RuntimeRepository {
  private readonly aiRoot: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(projectRoot: string) {
    this.aiRoot = path.join(projectRoot, '.ai');
  }

  private resolve(filePath: string): string {
    const resolved = path.resolve(this.aiRoot, filePath);
    if (!resolved.startsWith(this.aiRoot)) {
      throw new Error('Path traversal detected: cannot escape runtime state directory');
    }
    return resolved;
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolve(filePath);
    // Serialize writes + retry rename on Windows EPERM (OS briefly locks files)
    const doWrite = async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const tempPath = `${resolved}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
      await fs.writeFile(tempPath, content, 'utf-8');
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempPath, resolved);
          return;
        } catch (err: any) {
          if (err.code === 'EPERM' && attempt < 4) {
            await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
          } else {
            try { await fs.unlink(tempPath); } catch { /* ignore */ }
            throw err;
          }
        }
      }
    };
    this.writeQueue = this.writeQueue.catch(() => {}).then(doWrite);
    return this.writeQueue;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const resolved = this.resolve(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        files.push(entryPath);
      } else if (entry.isDirectory()) {
        const subFiles = await this.listFiles(entryPath);
        files.push(...subFiles);
      }
    }
    return files;
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(this.resolve(dirPath), { recursive: true });
  }

  async appendFeedbackCandidates(candidates: ReadonlyArray<KnowledgeCandidate>): Promise<void> {
    const filePath = 'knowledge/feedback_candidates.json';
    
    try {
      let existing: { candidates: KnowledgeCandidate[] } = { candidates: [] };
      
      if (await this.exists(filePath)) {
        const raw = await this.readFile(filePath);
        if (raw && raw.trim().length > 0) {
          existing = JSON.parse(raw);
        }
      }
      
      // Filter duplicates by content
      const newCandidates = candidates.filter(c => 
        !existing.candidates.some(e => e.content === c.content && e.type === c.type)
      );
      
      existing.candidates.push(...newCandidates);
      
      await this.writeFile(filePath, JSON.stringify(existing, null, 2));
    } catch (error: any) {
      console.warn(`[RuntimeRepository] appendFeedbackCandidates failed: ${error.message}`);
    }
  }

  async saveHealingKnowledge(sessionId: string, taskId: string, attempt: number, errorLog: string): Promise<void> {
    const filePath = `knowledge/temp/${sessionId}.json`;
    
    try {
      let existing: any = { sessionId, taskId, attempts: [], mergedToMain: false };
      
      if (await this.exists(filePath)) {
        const raw = await this.readFile(filePath);
        if (raw && raw.trim().length > 0) {
          existing = JSON.parse(raw);
        }
      }
      
      existing.attempts.push({
        attempt,
        errorLog: errorLog.substring(0, 2000),
        timestamp: new Date().toISOString(),
      });
      
      await this.writeFile(filePath, JSON.stringify(existing, null, 2));
    } catch (error: any) {
      console.warn(`[RuntimeRepository] saveHealingKnowledge failed: ${error.message}`);
    }
  }

  async loadHealingKnowledge(sessionId: string): Promise<any | null> {
    const filePath = `knowledge/temp/${sessionId}.json`;
    
    try {
      if (await this.exists(filePath)) {
        const raw = await this.readFile(filePath);
        if (raw && raw.trim().length > 0) {
          return JSON.parse(raw);
        }
      }
      return null;
    } catch (error: any) {
      console.warn(`[RuntimeRepository] loadHealingKnowledge failed: ${error.message}`);
      return null;
    }
  }

  async deleteHealingKnowledge(sessionId: string): Promise<void> {
    const filePath = `knowledge/temp/${sessionId}.json`;
    
    try {
      if (await this.exists(filePath)) {
        const fs = await import('fs/promises');
        const resolved = this.resolve(filePath);
        await fs.unlink(resolved);
      }
    } catch (error: any) {
      console.warn(`[RuntimeRepository] deleteHealingKnowledge failed: ${error.message}`);
    }
  }
}
