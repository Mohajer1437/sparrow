import { ReliabilityStore } from '../contracts/reliability-store';
import { TaskRunStore } from '../contracts/task-run-store';
import {
  ReliabilityRate,
  ReliabilityRecord,
  ReliabilityReport,
  isReliabilityTimeWindow,
  isRunPopulation,
} from '../domain/reliability';
import {
  ReliabilityAggregationOptions,
  aggregateReliability,
} from '../core/reliability/reliability-aggregator';

export { ReliabilityAggregationOptions };
import { buildReliabilityRecord } from '../core/reliability/reliability-record-builder';
import { isValidTaskId } from './file-task-run-store';
import { recordMatchesSnapshot } from './file-reliability-store';
import { TaskQueryError } from './task-query-service';

/** Runs scanned by default. Reliability history is small; this is not a page size. */
const DEFAULT_RUN_SCAN_LIMIT = 1000;

export interface MetricContributionView {
  readonly metric: string;
  readonly rate: ReliabilityRate;
  readonly numeratorRuns: ReadonlyArray<ReliabilityRecordSummary>;
  readonly denominatorRuns: ReadonlyArray<ReliabilityRecordSummary>;
}

export interface ReliabilityRecordSummary {
  readonly taskId: string;
  readonly task: string;
  readonly startedAt: string;
  readonly outcome: string;
  readonly outcomeReason: string;
  readonly firstPassSuccess: boolean;
  readonly suspicious: boolean;
}

export interface SuspicionDetailView {
  readonly taskId: string;
  readonly outcome: string;
  readonly outcomeReason: string;
  readonly findings: ReadonlyArray<{ readonly code: string; readonly detail: string }>;
  readonly requiredChecks: number;
  readonly executedChecks: number;
  readonly missingChecks: number;
  readonly verificationStatus: string;
  readonly conclusion: string;
}

/**
 * The single application boundary for reliability measurement.
 *
 * CLI, REPL and Web all read through this service, so no adapter can compute
 * a metric of its own and disagree with another surface. Records are derived
 * from task-run snapshots — the existing source of truth — and cached in the
 * reliability store so history survives restarts without becoming a second,
 * competing record of what happened.
 */
export class ReliabilityService {
  constructor(
    private readonly runs: TaskRunStore,
    private readonly store: ReliabilityStore,
    private readonly workspaceRoot: string,
  ) {}

  async listRecords(limit = DEFAULT_RUN_SCAN_LIMIT): Promise<ReadonlyArray<ReliabilityRecord>> {
    const snapshots = await this.runs.list(limit);
    const persisted = await this.safeListPersisted();
    const byTaskId = new Map(persisted.map(record => [record.taskId, record]));
    const records: ReliabilityRecord[] = [];
    const seen = new Set<string>();

    for (const snapshot of snapshots) {
      // A run recorded twice in the store must still count once.
      if (seen.has(snapshot.taskId)) continue;
      seen.add(snapshot.taskId);

      const cached = byTaskId.get(snapshot.taskId);
      if (cached && recordMatchesSnapshot(cached, snapshot)) {
        records.push(cached);
        continue;
      }
      const rebuilt = buildReliabilityRecord(snapshot);
      records.push(rebuilt);
      await this.safeSave(rebuilt);
    }

    // Records whose snapshot is gone are retained: historical evidence is
    // never dropped just because the run file was pruned (G.33).
    for (const record of persisted) {
      if (seen.has(record.taskId)) continue;
      seen.add(record.taskId);
      records.push(record);
    }

    return Object.freeze(records.sort((a, b) => {
      const byTime = a.startedAt.localeCompare(b.startedAt);
      return byTime !== 0 ? byTime : a.taskId.localeCompare(b.taskId);
    }));
  }

  async getRecord(taskId: string): Promise<ReliabilityRecord> {
    if (!isValidTaskId(taskId)) {
      throw new TaskQueryError('INVALID_TASK_ID', `Invalid task id: ${taskId}`);
    }
    const snapshot = await this.runs.get(taskId);
    if (snapshot) {
      const cached = await this.safeGetPersisted(taskId);
      if (cached && recordMatchesSnapshot(cached, snapshot)) return cached;
      const rebuilt = buildReliabilityRecord(snapshot);
      await this.safeSave(rebuilt);
      return rebuilt;
    }
    const cached = await this.safeGetPersisted(taskId);
    if (cached) return cached;
    throw new TaskQueryError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
  }

  async getReport(options: ReliabilityAggregationOptions = {}): Promise<ReliabilityReport> {
    const records = await this.listRecords();
    return aggregateReliability(records, options);
  }

  /** Resolves the runs behind one rate so any published number can be audited (G.31). */
  async getContribution(
    metric: string,
    options: ReliabilityAggregationOptions = {},
  ): Promise<MetricContributionView> {
    const records = await this.listRecords();
    const report = aggregateReliability(records, options);
    const rate = report.rates.find(entry => entry.name === metric);
    const contribution = report.contributions.find(entry => entry.name === metric);
    if (!rate || !contribution) {
      throw new TaskQueryError('TASK_NOT_FOUND', `Unknown reliability metric: ${metric}`);
    }
    const byTaskId = new Map(records.map(record => [record.taskId, record]));
    const summarize = (ids: ReadonlyArray<string>) => Object.freeze(
      ids.map(id => byTaskId.get(id)).filter(Boolean).map(record => summary(record!)),
    );
    return Object.freeze({
      metric,
      rate,
      numeratorRuns: summarize(contribution.numeratorRuns),
      denominatorRuns: summarize(contribution.denominatorRuns),
    });
  }

  /** Explains why a recorded success could not be fully trusted (G.32). */
  async getSuspicionDetail(taskId: string): Promise<SuspicionDetailView> {
    const record = await this.getRecord(taskId);
    const coverage = record.verification.coverage;
    return Object.freeze({
      taskId: record.taskId,
      outcome: record.outcome,
      outcomeReason: record.outcomeReason,
      findings: record.suspicion.findings,
      requiredChecks: coverage.required,
      executedChecks: coverage.executed,
      missingChecks: coverage.unknown,
      verificationStatus: record.verification.status,
      conclusion: record.suspicion.suspicious
        ? 'Success cannot be fully trusted: see findings.'
        : 'No suspicion findings for this run.',
    });
  }

  workspace(): { readonly workspaceRoot: string; readonly readOnly: true } {
    return { workspaceRoot: this.workspaceRoot, readOnly: true };
  }

  private async safeListPersisted(): Promise<ReadonlyArray<ReliabilityRecord>> {
    try {
      return await this.store.list();
    } catch {
      return [];
    }
  }

  private async safeGetPersisted(taskId: string): Promise<ReliabilityRecord | null> {
    try {
      return await this.store.get(taskId);
    } catch {
      return null;
    }
  }

  private async safeSave(record: ReliabilityRecord): Promise<void> {
    try {
      await this.store.save(record);
    } catch {
      // Measurement must keep working on a read-only or full disk.
    }
  }
}

function summary(record: ReliabilityRecord): ReliabilityRecordSummary {
  return Object.freeze({
    taskId: record.taskId,
    task: record.task,
    startedAt: record.startedAt,
    outcome: record.outcome,
    outcomeReason: record.outcomeReason,
    firstPassSuccess: record.firstPassSuccess,
    suspicious: record.suspicion.suspicious,
  });
}

/** Parses adapter query parameters into aggregation options without trusting them. */
export function parseAggregationOptions(params: {
  readonly window?: string | null;
  readonly workspace?: string | null;
  readonly projectType?: string | null;
  readonly framework?: string | null;
  readonly skill?: string | null;
  readonly population?: string | null;
  readonly minSample?: string | null;
}): ReliabilityAggregationOptions {
  const minSample = params.minSample ? Number(params.minSample) : undefined;
  return {
    window: isReliabilityTimeWindow(params.window) ? params.window : 'all',
    workspaceRoot: params.workspace || undefined,
    projectType: params.projectType || undefined,
    framework: params.framework || undefined,
    skillId: params.skill || undefined,
    population: isRunPopulation(params.population) ? params.population : 'ALL_RUNS',
    minSampleSize: Number.isInteger(minSample) && minSample! >= 0 ? minSample : undefined,
  };
}
