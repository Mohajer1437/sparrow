import * as fs from 'fs/promises';
import * as path from 'path';
import { ReliabilityStore } from '../contracts/reliability-store';
import { RELIABILITY_SCHEMA_VERSION, ReliabilityRecord } from '../domain/reliability';
import { isValidTaskId } from './file-task-run-store';

const RELIABILITY_DIRNAME = path.join('.ai', 'reliability');
const RECORD_SUFFIX = '.reliability.json';

/**
 * Reliability records under `.ai/reliability`.
 *
 * Writes are atomic (temp file + rename) so a reader never sees a partial
 * record. Records from a future or unreadable schema are ignored rather than
 * coerced, because a half-understood record would corrupt every metric
 * derived from it; the caller rebuilds those from the task-run snapshot.
 */
export class FileReliabilityStore implements ReliabilityStore {
  private readonly dir: string;

  constructor(private readonly workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, RELIABILITY_DIRNAME);
  }

  async save(record: ReliabilityRecord): Promise<void> {
    if (!isValidTaskId(record.taskId)) {
      throw new Error(`Invalid task id: ${record.taskId}`);
    }
    await fs.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, record.taskId + RECORD_SUFFIX);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  async get(taskId: string): Promise<ReliabilityRecord | null> {
    if (!isValidTaskId(taskId)) return null;
    return this.readRecord(taskId + RECORD_SUFFIX);
  }

  async list(): Promise<ReadonlyArray<ReliabilityRecord>> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const records: ReliabilityRecord[] = [];
    for (const entry of entries.filter(name => name.endsWith(RECORD_SUFFIX)).sort()) {
      const record = await this.readRecord(entry);
      if (record) records.push(record);
    }
    return records;
  }

  private async readRecord(fileName: string): Promise<ReliabilityRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.dir, fileName), 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A truncated or corrupted record is discarded, not partially trusted.
      return null;
    }
    return isUsableRecord(parsed) ? parsed : null;
  }
}

/**
 * A stored record is usable only if it declares a schema version this build
 * understands and still carries the fields every metric depends on.
 */
export function isUsableRecord(value: unknown): value is ReliabilityRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReliabilityRecord>;
  if (candidate.schemaVersion !== RELIABILITY_SCHEMA_VERSION) return false;
  if (typeof candidate.taskId !== 'string' || candidate.taskId.length === 0) return false;
  if (typeof candidate.startedAt !== 'string') return false;
  if (typeof candidate.outcome !== 'string') return false;
  if (!Array.isArray(candidate.populations)) return false;
  return Boolean(
    candidate.execution
    && candidate.verification
    && candidate.evidenceCompleteness
    && candidate.dimensions
    && candidate.repair
    && candidate.suspicion,
  );
}

/**
 * True when a stored record still describes the snapshot it was derived from.
 * A run that later progressed (for example COMPLETED after a repair) must be
 * rebuilt rather than reported from its earlier projection.
 */
export function recordMatchesSnapshot(
  record: ReliabilityRecord,
  snapshot: { status: string; startedAt: string; completedAt?: string },
): boolean {
  return record.recordedStatus === snapshot.status
    && record.startedAt === snapshot.startedAt
    && (record.completedAt ?? null) === (snapshot.completedAt ?? null);
}
