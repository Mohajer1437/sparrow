import * as fs from 'fs/promises';
import * as path from 'path';
import { TaskRunStore } from '../contracts/task-run-store';
import { TaskRunContextContent, TaskRunSnapshot } from '../domain/task-run';
import { isValidIdentifier } from '../domain/correlation';

const RUNS_DIRNAME = path.join('.ai', 'runs');
const SNAPSHOT_SUFFIX = '.run.json';
const CONTEXT_SUFFIX = '.context.json';

/** Rejects ids that could escape the runs directory. */
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export function isValidTaskId(taskId: string): boolean {
  return isValidIdentifier(taskId);
}

/**
 * Run store backed by `.ai/runs` (R6.16).
 *
 * Writes are atomic (temp file + rename) so an observer never reads a
 * half-written snapshot, and a failed write never breaks the pipeline:
 * callers treat persistence as best effort (R6.45).
 */
export class FileTaskRunStore implements TaskRunStore {
  private readonly dir: string;

  constructor(private readonly workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, RUNS_DIRNAME);
  }

  async save(snapshot: TaskRunSnapshot): Promise<void> {
    if (!isValidTaskId(snapshot.taskId)) {
      throw new Error(`Invalid task id: ${snapshot.taskId}`);
    }
    // Save primary snapshot file by taskId
    await this.writeJson(snapshot.taskId + SNAPSHOT_SUFFIX, snapshot);
    // If runId exists and differs from taskId, also save by runId for fast lookup
    if (snapshot.runId && snapshot.runId !== snapshot.taskId && isValidTaskId(snapshot.runId)) {
      await this.writeJson(snapshot.runId + SNAPSHOT_SUFFIX, snapshot);
    }
  }

  async saveContextContent(content: TaskRunContextContent): Promise<void> {
    if (!isValidTaskId(content.taskId)) {
      throw new Error(`Invalid task id: ${content.taskId}`);
    }
    await this.writeJson(content.taskId + CONTEXT_SUFFIX, content);
  }

  async list(limit = 50): Promise<ReadonlyArray<TaskRunSnapshot>> {
    const names = await this.listSnapshotFiles();
    const snapshotMap = new Map<string, TaskRunSnapshot>();
    for (const name of names) {
      const parsed = await this.readJson<TaskRunSnapshot>(name);
      if (parsed && typeof parsed.taskId === 'string') {
        const key = parsed.runId ?? parsed.taskId;
        if (!snapshotMap.has(key)) {
          snapshotMap.set(key, parsed);
        }
      }
    }
    const snapshots = Array.from(snapshotMap.values());
    snapshots.sort((a, b) => compareDesc(a.startedAt, b.startedAt));
    return snapshots.slice(0, Math.max(0, limit));
  }

  async get(taskId: string): Promise<TaskRunSnapshot | null> {
    if (!isValidTaskId(taskId)) return null;
    const direct = await this.readJson<TaskRunSnapshot>(taskId + SNAPSHOT_SUFFIX);
    if (direct) return direct;

    // Fallback: search snapshots if stored under a different name
    const all = await this.list(100);
    return all.find(s => s.taskId === taskId) ?? null;
  }

  async getRun(runId: string): Promise<TaskRunSnapshot | null> {
    if (!isValidTaskId(runId)) return null;
    const direct = await this.readJson<TaskRunSnapshot>(runId + SNAPSHOT_SUFFIX);
    if (direct) return direct;

    const all = await this.list(100);
    return all.find(s => s.runId === runId || s.sessionId === runId || s.taskId === runId) ?? null;
  }

  async listRuns(taskId: string): Promise<ReadonlyArray<TaskRunSnapshot>> {
    if (!isValidTaskId(taskId)) return [];
    const all = await this.list(100);
    return all.filter(s => s.taskId === taskId);
  }

  async getContextContent(taskId: string): Promise<TaskRunContextContent | null> {
    if (!isValidTaskId(taskId)) return null;
    return this.readJson<TaskRunContextContent>(taskId + CONTEXT_SUFFIX);
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
          // entry disappeared between readdir and stat
        }
      }
    } catch {
      return 0;
    }
    return latest;
  }

  private async listSnapshotFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries.filter(entry => entry.endsWith(SNAPSHOT_SUFFIX));
    } catch {
      return [];
    }
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, fileName);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, target);
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
