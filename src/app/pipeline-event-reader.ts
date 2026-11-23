import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { TaskRunStatus } from '../domain/task-run';
import { PipelineEvent, PIPELINE_EVENT_SCHEMA_VERSION } from '../domain/pipeline-event';
import { LEGACY_UNKNOWN_RUN_ID, UNKNOWN_IDENTIFIER } from '../domain/correlation';
import { redactText, redactValue } from './secret-redaction';

export { PipelineEvent };

const LOG_DIR = path.join('.ai', 'logs', 'pipeline');

/** Only the tail of a log file is read, so a very large log cannot stall a request. */
const MAX_TAIL_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 500;
/** Cap on unnamed logs scanned when no file matches the session. */
const MAX_FALLBACK_LOG_FILES = 10;

/** Fields that carry prompt or response bodies rather than pipeline facts. */
const OMITTED_DATA_KEYS: ReadonlySet<string> = new Set([
  'systemPrompt',
  'userPrompt',
  'contentPreview',
  'content',
  'env',
  'environment',
  'headers',
]);

/**
 * Phases that identify a pipeline stage. Generic phases such as WORKFLOW,
 * AGENT or REPL are deliberately absent: they appear throughout a run, so
 * treating them as a stage would drag the reported phase backwards.
 */
const PHASE_TO_STATUS: ReadonlyArray<readonly [RegExp, TaskRunStatus]> = Object.freeze([
  [/^(REPAIR_CONTEXT|REPAIR_PLAN|REPAIR_ATTEMPT|REPAIR_RESULT|FAILURE_PRIORITIZATION)$/, 'REPAIR'],
  [/^(VERIFICATION|VV|REVIEW|REFLECTION)$/, 'VERIFICATION'],
  [/^(EXECUTION|STEP|TOOL|PATCH|GIT|STATE|IMPACT)$/, 'EXECUTION'],
  [/^(CONTEXT|CONTEXT_STRATEGY|CONTEXT_GATHERING|PLANNER_CONTEXT)$/, 'CONTEXT'],
  [/^(PLANNING|TODO_PLAN|TODO_BRIDGE|PRE_EXECUTION|DECOMPOSE)$/, 'PLANNING'],
]);

export interface PipelineEventReadOptions {
  readonly runId?: string;
  readonly taskId?: string;
  readonly sessionIds?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly sinceSeq?: number;
  readonly sinceTs?: string;
}

/**
 * Structured read model over pipeline event logs (R6.27).
 *
 * Provides:
 * - Direct queries by authoritative `runId` (primary query key).
 * - Deterministic sequence ordering (R6.8, R6.9).
 * - Event deduplication / idempotency by `eventId` (R6.10).
 * - Full backward compatibility with legacy un-correlated logs (R6.13, R6.14).
 * - Never invents run identity when absent (R6.14, R6.41).
 */
export class PipelineEventReader {
  private readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, LOG_DIR);
  }

  async read(options?: PipelineEventReadOptions): Promise<ReadonlyArray<PipelineEvent>> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const wantedSessions = new Set((options?.sessionIds ?? []).filter(Boolean));
    const targetRunId = options?.runId;
    const targetTaskId = options?.taskId;

    const { files, matchedByName } = await this.resolveLogFiles(wantedSessions);
    const eventMap = new Map<string, PipelineEvent>();
    let fallbackSeq = 0;

    for (const file of files) {
      const text = await this.readTail(file);
      const lines = text.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
        const trimmed = lines[lineIdx].trim();
        if (!trimmed.startsWith('{')) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        fallbackSeq += 1;
        const entry = toEvent(file, lineIdx, fallbackSeq, parsed);

        // Filter by runId if requested (R6.7, R6.27)
        if (targetRunId !== undefined) {
          if (entry.runId !== targetRunId) {
            // For legacy logs, if searching for LEGACY_UNKNOWN or matched session
            if (targetRunId !== LEGACY_UNKNOWN_RUN_ID || !entry.isLegacy) {
              continue;
            }
          }
        }

        // Filter by taskId if requested
        if (targetTaskId !== undefined) {
          if (entry.taskId !== targetTaskId && entry.taskId !== UNKNOWN_IDENTIFIER) {
            continue;
          }
        }

        // Filter by session if requested and log was not matched by file name
        if (
          !matchedByName
          && wantedSessions.size > 0
          && entry.sessionId
          && !wantedSessions.has(entry.sessionId)
        ) {
          continue;
        }

        // Filter by timestamp if requested
        if (options?.sinceTs && entry.ts < options.sinceTs) {
          continue;
        }

        // Idempotency / Deduplication by eventId (R6.10)
        if (!eventMap.has(entry.eventId)) {
          eventMap.set(entry.eventId, entry);
        }
      }
    }

    const allEvents = Array.from(eventMap.values());

    const filtered = options?.sinceSeq
      ? allEvents.filter(event => event.seq > options.sinceSeq!)
      : allEvents;

    // Deterministic ordering:
    // 1. If both events have explicit sequence from the same non-legacy run, sequence is authoritative (R6.8, R6.9, R6.21).
    // 2. Otherwise (including legacy logs and cross-run events), order by timestamp first, then sequence number, then eventId tie-breaker.
    const ordered = [...filtered].sort((a, b) => {
      if (!a.isLegacy && !b.isLegacy && a.runId === b.runId && a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      if (a.ts !== b.ts) {
        return a.ts.localeCompare(b.ts);
      }
      if (a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      return a.eventId.localeCompare(b.eventId);
    });

    return ordered.slice(Math.max(0, ordered.length - limit));
  }

  async lastModified(): Promise<number> {
    let latest = 0;
    for (const file of await this.listLogFiles()) {
      try {
        const stat = await fs.stat(file);
        latest = Math.max(latest, stat.mtimeMs);
      } catch {
        // file removed between listing and stat
      }
    }
    return latest;
  }

  async findLogFileForRun(
    runId: string,
    taskId?: string,
    sessionIds?: ReadonlyArray<string>,
  ): Promise<{ absolutePath: string; fileName: string; relativePath: string } | null> {
    const { files } = await this.resolveLogFiles(
      sessionIds ? new Set(sessionIds.filter(Boolean)) : undefined,
    );
    for (const file of files) {
      try {
        const text = await fs.readFile(file, 'utf8');
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.runId === runId) {
              return {
                absolutePath: file,
                fileName: path.basename(file),
                relativePath: path.relative(path.resolve(this.dir, '..', '..', '..'), file).replace(/\\/g, '/'),
              };
            }
            if (taskId && parsed.taskId === taskId && (runId === LEGACY_UNKNOWN_RUN_ID || !parsed.runId)) {
              return {
                absolutePath: file,
                fileName: path.basename(file),
                relativePath: path.relative(path.resolve(this.dir, '..', '..', '..'), file).replace(/\\/g, '/'),
              };
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  async getRawLogLines(
    filePath: string,
    runId: string,
    taskId?: string,
    limit = 500,
  ): Promise<{ fileName: string; lines: string[] }> {
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(this.dir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      throw new Error('Access denied: log file must reside within the pipeline log directory');
    }
    const text = await fs.readFile(resolvedPath, 'utf8');
    const allLines = text.split('\n');
    const matched: string[] = [];
    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed.runId === runId
          || (taskId && parsed.taskId === taskId && (parsed.runId === LEGACY_UNKNOWN_RUN_ID || !parsed.runId))
        ) {
          matched.push(redactText(trimmed));
        }
      } catch {
        // ignore
      }
    }
    const resultLines = matched.slice(Math.max(0, matched.length - limit));
    return {
      fileName: path.basename(resolvedPath),
      lines: resultLines,
    };
  }

  private async resolveLogFiles(
    sessionIds?: ReadonlySet<string>,
  ): Promise<{ files: string[]; matchedByName: boolean }> {
    try {
      const entries = (await fs.readdir(this.dir)).filter(entry => entry.endsWith('.log')).sort();
      if (!sessionIds || sessionIds.size === 0) {
        return { files: entries.map(entry => path.join(this.dir, entry)), matchedByName: false };
      }
      const named = entries.filter(entry => [...sessionIds].some(id => entry.includes(id)));
      const candidates = named.length > 0
        ? named
        : entries.slice(Math.max(0, entries.length - MAX_FALLBACK_LOG_FILES));
      return {
        files: candidates.map(entry => path.join(this.dir, entry)),
        matchedByName: named.length > 0,
      };
    } catch {
      return { files: [], matchedByName: false };
    }
  }

  private async listLogFiles(): Promise<string[]> {
    return (await this.resolveLogFiles()).files;
  }

  private async readTail(file: string): Promise<string> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
      const length = stat.size - start;
      if (length <= 0) return '';
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      const text = buffer.toString('utf8');
      return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    } catch {
      return '';
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

/**
 * Current stage of a run according to its most recent event. Terminal statuses
 * recorded by the Core always win: an intermediate event can never turn a
 * failed or limit-reached run back into progress.
 */
export function derivePhaseFromEvents(
  events: ReadonlyArray<PipelineEvent>,
): TaskRunStatus | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const phase = events[index].phase;
    for (const [pattern, status] of PHASE_TO_STATUS) {
      if (pattern.test(phase)) return status;
    }
  }
  return undefined;
}

function toEvent(
  file: string,
  lineIdx: number,
  fallbackSeq: number,
  parsed: Record<string, unknown>,
): PipelineEvent {
  const {
    eventId: rawEventId,
    seq: rawSeq,
    ts: rawTs,
    taskId: rawTaskId,
    runId: rawRunId,
    sessionId: rawSessionId,
    attemptId: rawAttemptId,
    schemaVersion: rawSchemaVersion,
    phase: rawPhase,
    role: rawRole,
    model: rawModel,
    message: rawMessage,
    ...rest
  } = parsed;

  const isLegacy = typeof rawRunId !== 'string' || !rawRunId.trim();
  const runId = typeof rawRunId === 'string' && rawRunId.trim()
    ? rawRunId.trim()
    : LEGACY_UNKNOWN_RUN_ID;

  const taskId = typeof rawTaskId === 'string' && rawTaskId.trim()
    ? rawTaskId.trim()
    : UNKNOWN_IDENTIFIER;

  const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim()
    ? rawSessionId.trim()
    : 'global';

  const attemptId = typeof rawAttemptId === 'string' && rawAttemptId.trim()
    ? rawAttemptId.trim()
    : undefined;

  const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) && rawSeq > 0
    ? rawSeq
    : fallbackSeq;

  const ts = typeof rawTs === 'string' && rawTs.trim()
    ? rawTs.trim()
    : new Date(0).toISOString();

  const phase = typeof rawPhase === 'string' ? rawPhase : 'UNKNOWN';
  const role = typeof rawRole === 'string' ? rawRole : '-';
  const model = typeof rawModel === 'string' ? rawModel : '-';
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const schemaVersion = typeof rawSchemaVersion === 'string'
    ? rawSchemaVersion
    : (isLegacy ? undefined : PIPELINE_EVENT_SCHEMA_VERSION);

  const eventId = typeof rawEventId === 'string' && rawEventId.trim()
    ? rawEventId.trim()
    : buildLegacyEventId(file, lineIdx, ts, message);

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (OMITTED_DATA_KEYS.has(key)) continue;
    data[key] = value;
  }

  return redactValue<PipelineEvent>({
    eventId,
    seq,
    ts,
    taskId,
    runId,
    sessionId,
    ...(attemptId ? { attemptId } : {}),
    phase,
    role,
    model,
    message,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
    ...(schemaVersion ? { schemaVersion } : {}),
    ...(isLegacy ? { isLegacy: true } : {}),
  });
}

function buildLegacyEventId(file: string, lineIdx: number, ts: string, message: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${path.basename(file)}:${lineIdx}:${ts}:${message}`, 'utf8')
    .digest('hex')
    .substring(0, 16);
  return `evt-legacy-${hash}`;
}
