import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfirmationStore, ConfirmationListFilter } from '../../contracts/confirmation-store';
import { ConfirmationRequest, isConfirmationExpired } from '../../domain/confirmation';

const CONFIRMATIONS_DIRNAME = path.join('.ai', 'confirmations');
const CONFIRMATION_SUFFIX = '.confirmation.json';

const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export function isValidConfirmationId(id: string): boolean {
  return CONFIRMATION_ID_PATTERN.test(id) && !id.includes('..');
}

/**
 * Atomic file-based confirmation store.
 * Persists confirmation requests to `.ai/confirmations`.
 * Survived process restarts: PENDING states remain PENDING unless expired.
 */
export class FileConfirmationStore implements ConfirmationStore {
  private readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, CONFIRMATIONS_DIRNAME);
  }

  async save(request: ConfirmationRequest): Promise<void> {
    if (!isValidConfirmationId(request.id)) {
      throw new Error(`Invalid confirmation id: ${request.id}`);
    }
    await this.writeJson(request.id + CONFIRMATION_SUFFIX, request);
  }

  async get(id: string): Promise<ConfirmationRequest | null> {
    if (!isValidConfirmationId(id)) return null;
    const request = await this.readJson<ConfirmationRequest>(id + CONFIRMATION_SUFFIX);
    if (!request) return null;

    // Check expiration deterministically on read
    if (request.status === 'PENDING' && isConfirmationExpired(request)) {
      const expiredRequest: ConfirmationRequest = Object.freeze({
        ...request,
        status: 'EXPIRED',
      });
      await this.save(expiredRequest);
      return expiredRequest;
    }

    return request;
  }

  async list(filter?: ConfirmationListFilter): Promise<ReadonlyArray<ConfirmationRequest>> {
    const names = await this.listConfirmationFiles();
    const requests: ConfirmationRequest[] = [];

    for (const name of names) {
      const parsed = await this.readJson<ConfirmationRequest>(name);
      if (parsed && typeof parsed.id === 'string') {
        let req = parsed;
        if (req.status === 'PENDING' && isConfirmationExpired(req)) {
          req = Object.freeze({
            ...req,
            status: 'EXPIRED',
          });
          // Best effort update
          this.save(req).catch(() => {});
        }

        if (filter?.status && req.status !== filter.status) {
          continue;
        }
        if (filter?.taskId && req.taskId !== filter.taskId) {
          continue;
        }
        requests.push(req);
      }
    }

    requests.sort((a, b) => compareDesc(a.createdAt, b.createdAt));
    const limit = filter?.limit ?? 50;
    return requests.slice(0, Math.max(0, limit));
  }

  async lastModified(): Promise<number> {
    let latest = 0;
    try {
      const entries = await fs.readdir(this.dir);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const stat = await fs.stat(path.join(this.dir, entry));
          latest = Math.max(latest, stat.mtimeMs);
        } catch {
          // entry disappeared
        }
      }
    } catch {
      return 0;
    }
    return latest;
  }

  private async listConfirmationFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries.filter(entry => entry.endsWith(CONFIRMATION_SUFFIX));
    } catch {
      return [];
    }
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, fileName);
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');

    let retries = 5;
    while (retries > 0) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY') && retries > 1) {
          retries--;
          await new Promise(r => setTimeout(r, 20 * (6 - retries)));
          continue;
        }
        try { await fs.unlink(temp); } catch {}
        throw err;
      }
    }
  }

  private async readJson<T>(fileName: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, fileName), 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

function compareDesc(a: string | undefined, b: string | undefined): number {
  return String(b ?? '').localeCompare(String(a ?? ''));
}
