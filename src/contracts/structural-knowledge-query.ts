import { KnowledgeEdge, KnowledgeNode, StructuralGraph } from '../domain/structural-knowledge';

/** Explicit traversal direction. Replaces ambiguous boolean pairs for new callers. */
export type StructuralQueryDirection = 'imports' | 'importers' | 'both';

/** Observable freshness of structural knowledge at query time. */
export type StructuralKnowledgeFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';

/**
 * Bounded structural graph query. LLM-free. Reads the structural graph — not filesystem search.
 *
 * Hard upper bounds (enforced by implementation):
 *   maxDepth ≤ 3, maxNodes ≤ 64, maxFiles ≤ 32
 */
export interface StructuralKnowledgeQueryRequest {
  readonly seeds: ReadonlyArray<string>;
  /** Preferred over includeImports/includeImporters when set. */
  readonly direction?: StructuralQueryDirection;
  /** @deprecated Prefer `direction`. Kept for Phase 3 callers. */
  readonly includeImporters?: boolean;
  /** @deprecated Prefer `direction`. Kept for Phase 3 callers. */
  readonly includeImports?: boolean;
  /** Hop count along import edges from seeds. Default 1. Hard cap 3. */
  readonly maxDepth?: number;
  /** Max nodes of any kind (files + symbols + modules). Default 12. Hard cap 64. */
  readonly maxNodes?: number;
  /** Max file nodes returned. Default = maxNodes. Hard cap 32. */
  readonly maxFiles?: number;
  /** Include file→symbol contains edges for selected files. Default true. */
  readonly includeSymbols?: boolean;
  /** Optional correlation for evidence/audit (not sent to LLM). */
  readonly queryId?: string;
  readonly sessionId?: string;
  readonly stepId?: string;
  /** Why this query was issued (audit). */
  readonly reason?: string;
}

export interface StructuralKnowledgeQueryProvenance {
  /**
   * Where the answer came from.
   * - structural-graph: graph answered; freshness separate
   * - structural-graph-stale: graph answered but marked stale/uncertain
   * - unavailable: no graph / no seeds
   */
  readonly source: 'structural-graph' | 'structural-graph-stale' | 'unavailable';
  readonly freshness: StructuralKnowledgeFreshness;
  /** False when stale/unknown — caller must not treat result as authoritative FS truth. */
  readonly claimCertainty: boolean;
  readonly queryId: string;
  readonly seeds: ReadonlyArray<string>;
  readonly direction: StructuralQueryDirection;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxFiles: number;
  readonly nodesReturned: number;
  readonly edgesReturned: number;
  readonly filesReturned: number;
  readonly truncated: boolean;
  readonly graphContentHash: string | null;
  readonly graphFileCount: number | null;
  readonly reason?: string;
  readonly staleReason?: string;
}

export interface StructuralKnowledgeQueryResult {
  readonly nodes: ReadonlyArray<KnowledgeNode>;
  readonly edges: ReadonlyArray<KnowledgeEdge>;
  /** Workspace-relative file paths in the result (deterministic order). */
  readonly relatedFiles: ReadonlyArray<string>;
  readonly promptSection: string;
  readonly provenance: StructuralKnowledgeQueryProvenance;
  readonly graph: StructuralGraph | null;
}

export interface StructuralKnowledgeQuery {
  query(request: StructuralKnowledgeQueryRequest): Promise<StructuralKnowledgeQueryResult>;
}

/** Absolute hard caps — never raised by callers. */
export const STRUCTURAL_QUERY_HARD_LIMITS = Object.freeze({
  maxDepth: 3,
  maxNodes: 64,
  maxFiles: 32,
  defaultMaxNodes: 12,
  defaultMaxDepth: 1,
});
