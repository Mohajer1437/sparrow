/**
 * Structural project graph — deterministic index of repository truth.
 * Not LLM prose. Filesystem remains the source of truth.
 */

export type KnowledgeNodeKind = 'file' | 'module' | 'symbol';
export type KnowledgeEdgeKind = 'imports' | 'contains';

export interface KnowledgeNode {
  readonly id: string;
  readonly kind: KnowledgeNodeKind;
  readonly path?: string;
  readonly hash?: string;
  readonly exports?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface KnowledgeEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: KnowledgeEdgeKind;
}

export type StructuralGenerationMode = 'full' | 'incremental';

export interface StructuralGraphMeta {
  readonly schemaVersion: string;
  readonly projectRoot: string;
  /** Wall-clock index time; excluded from contentHash. */
  readonly indexedAt: string;
  /** SHA-256 (16 hex) of canonical nodes+edges payload for determinism checks. */
  readonly contentHash: string;
  readonly fileCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly roots: ReadonlyArray<string>;
  readonly generationMode: StructuralGenerationMode;
  /** True when last sync failed; graph may lag filesystem. Observable, not silent. */
  readonly stale?: boolean;
  readonly staleReason?: string;
  readonly lastSyncError?: string;
}

/** Persisted sync observability (fail-open / incrementality). */
export const STRUCTURAL_SYNC_STATE_RELATIVE_PATH = 'knowledge/structural-sync-state.json';

export interface StructuralSyncState {
  readonly ok: boolean;
  readonly stale: boolean;
  readonly skipped: boolean;
  readonly reason?: string;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
  readonly repositoryFileCount: number;
  readonly affectedFileCount: number;
  readonly analyzedFileCount: number;
  readonly analyzedPaths: ReadonlyArray<string>;
  readonly changedNodes: ReadonlyArray<string>;
  readonly sessionId?: string;
  readonly stepId?: string;
  readonly updatedAt: string;
  readonly error?: string;
}

export interface StructuralGraph {
  readonly meta: StructuralGraphMeta;
  readonly nodes: ReadonlyArray<KnowledgeNode>;
  readonly edges: ReadonlyArray<KnowledgeEdge>;
}

export const STRUCTURAL_GRAPH_SCHEMA_VERSION = '1.0.0';
export const STRUCTURAL_GRAPH_RELATIVE_PATH = 'knowledge/structural-graph.json';

export function freezeStructuralGraph(graph: StructuralGraph): StructuralGraph {
  return Object.freeze({
    meta: Object.freeze({ ...graph.meta, roots: Object.freeze([...graph.meta.roots]) }),
    nodes: Object.freeze(graph.nodes.map(n => Object.freeze({
      ...n,
      exports: n.exports ? Object.freeze([...n.exports]) : undefined,
      metadata: n.metadata ? Object.freeze({ ...n.metadata }) : undefined,
    }))),
    edges: Object.freeze(graph.edges.map(e => Object.freeze({ ...e }))),
  });
}

export function freezeStructuralSyncState(state: StructuralSyncState): StructuralSyncState {
  return Object.freeze({
    ...state,
    analyzedPaths: Object.freeze([...state.analyzedPaths]),
    changedNodes: Object.freeze([...state.changedNodes]),
  });
}
