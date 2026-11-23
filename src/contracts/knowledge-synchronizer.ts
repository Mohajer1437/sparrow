import { StructuralGraph, StructuralSyncState } from '../domain/structural-knowledge';
import { MutationLedger } from '../domain/execution/mutation-safety';

/**
 * Input for deterministic, LLM-free structural knowledge synchronization.
 * Candidate paths typically come from the Mutation Ledger; filesystem is authoritative.
 */
export interface KnowledgeSyncInput {
  readonly sessionId: string;
  readonly stepId: string;
  readonly todoId?: string;
  readonly candidatePaths: ReadonlyArray<string>;
  readonly outcome: 'success' | 'failed' | 'rolled_back' | 'skipped';
  /**
   * Optional: force full reindex fallback (tests / recovery).
   * Default path is incremental.
   */
  readonly forceFullReindex?: boolean;
}

export interface KnowledgeSyncEdgeChange {
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly change: 'added' | 'removed';
}

export interface KnowledgeSyncResult {
  readonly changedNodes: ReadonlyArray<string>;
  readonly changedEdges: ReadonlyArray<KnowledgeSyncEdgeChange>;
  readonly skipped: boolean;
  readonly reason?: string;
  readonly ok: boolean;
  readonly stale: boolean;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
  /** Total structural file nodes in graph before this sync (N). */
  readonly repositoryFileCount: number;
  /** Unique candidate structural paths considered (M). */
  readonly affectedFileCount: number;
  /** Paths that were AST-analyzed this sync (K). Must be << N for limited mutations. */
  readonly analyzedFileCount: number;
  readonly analyzedPaths: ReadonlyArray<string>;
  readonly graph: StructuralGraph | null;
  readonly syncState: StructuralSyncState;
}

/**
 * Incrementally updates the structural graph from filesystem truth.
 * Must not call LLM, KnowledgePipeline, TaskExecutor, or Planner.
 */
export interface KnowledgeSynchronizer {
  sync(input: KnowledgeSyncInput): Promise<KnowledgeSyncResult>;

  /**
   * Fail-open wrapper: never throws. On internal failure marks graph/state stale
   * and returns ok=false while preserving the caller's ability to keep execution.
   */
  syncFailOpen(input: KnowledgeSyncInput): Promise<KnowledgeSyncResult>;

  /** Derive candidate paths from a Mutation Ledger (deduped, normalized). */
  candidatesFromLedger(ledger: MutationLedger): ReadonlyArray<string>;

  /** Load last persisted sync observability state, if any. */
  loadSyncState(): Promise<StructuralSyncState | null>;
}
