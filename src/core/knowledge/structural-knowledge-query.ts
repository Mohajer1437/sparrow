import {
  STRUCTURAL_QUERY_HARD_LIMITS,
  StructuralKnowledgeFreshness,
  StructuralKnowledgeQuery,
  StructuralKnowledgeQueryProvenance,
  StructuralKnowledgeQueryRequest,
  StructuralKnowledgeQueryResult,
  StructuralQueryDirection,
} from '../../contracts/structural-knowledge-query';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import {
  KnowledgeEdge,
  KnowledgeNode,
  STRUCTURAL_SYNC_STATE_RELATIVE_PATH,
  StructuralGraph,
  StructuralSyncState,
} from '../../domain/structural-knowledge';
import { DefaultStructuralGraphIndexer, normalizePosix } from './structural-graph-indexer';

/**
 * Deterministic bounded query over the persisted structural graph.
 * Does not call LLM, KnowledgePipeline, TaskExecutor, or walk the filesystem for discovery.
 *
 * Complexity notes (honest):
 * - Graph is loaded wholly into memory via indexer.load() (O(N) nodes+edges).
 * - Traversal is O(E * depth) over import edges, then capped by maxNodes/maxFiles.
 * - Persistence cost is zero for queries (read-only).
 */
export class DefaultStructuralKnowledgeQuery implements StructuralKnowledgeQuery {
  constructor(
    private readonly indexer: DefaultStructuralGraphIndexer,
    private readonly runtime?: RuntimeRepository,
  ) {}

  async query(request: StructuralKnowledgeQueryRequest): Promise<StructuralKnowledgeQueryResult> {
    const bounds = resolveBounds(request);
    const direction = resolveDirection(request);
    const queryId = request.queryId ?? `q-${stableQueryKey(request)}`;
    const seeds = uniquePaths(request.seeds);
    const includeSymbols = request.includeSymbols !== false;

    const graph = await this.indexer.load();
    const freshness = await this.resolveFreshness(graph);

    if (!graph || seeds.length === 0) {
      return emptyResult({
        queryId,
        seeds,
        direction,
        bounds,
        graph,
        freshness: graph ? freshness : 'UNKNOWN',
        reason: request.reason,
      });
    }

    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const importAdj = buildImportAdjacency(graph.edges, direction);

    const selected = new Set<string>();
    const seedIds: string[] = [];
    for (const seed of seeds) {
      const id = resolveSeedId(seed, nodeById);
      if (id) {
        selected.add(id);
        seedIds.push(id);
      }
    }

    // Depth-limited BFS along import edges only (no module fan-out)
    let frontier = [...seedIds];
    for (let depth = 0; depth < bounds.maxDepth; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        const neighbors = importAdj.get(current) ?? [];
        for (const neighbor of neighbors) {
          if (!nodeById.has(neighbor) || selected.has(neighbor)) continue;
          selected.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    // Cap file nodes by maxFiles (prefer seeds)
    let fileIds = [...selected].filter(id => nodeById.get(id)?.kind === 'file').sort();
    if (fileIds.length > bounds.maxFiles) {
      const seedSet = new Set(seedIds);
      const preferred = fileIds.filter(id => seedSet.has(id));
      const rest = fileIds.filter(id => !seedSet.has(id));
      fileIds = [...preferred, ...rest].slice(0, bounds.maxFiles);
      selected.clear();
      for (const id of fileIds) selected.add(id);
    }

    // Soft-cap total nodes before symbols
    softCapSelected(selected, nodeById, seedIds, bounds.maxNodes);

    if (includeSymbols) {
      for (const id of [...selected]) {
        if (selected.size >= bounds.maxNodes) break;
        const node = nodeById.get(id);
        if (!node || node.kind !== 'file') continue;
        for (const edge of graph.edges) {
          if (edge.kind !== 'contains') continue;
          if (edge.from === id && !selected.has(edge.to) && nodeById.has(edge.to)) {
            selected.add(edge.to);
            if (selected.size >= bounds.maxNodes) break;
          }
        }
      }
    }

    // Include containing module nodes for selected files (if budget allows)
    for (const id of [...selected]) {
      if (selected.size >= bounds.maxNodes) break;
      const node = nodeById.get(id);
      if (!node || node.kind !== 'file') continue;
      for (const edge of graph.edges) {
        if (edge.kind !== 'contains') continue;
        if (edge.to === id && nodeById.get(edge.from)?.kind === 'module' && !selected.has(edge.from)) {
          selected.add(edge.from);
          if (selected.size >= bounds.maxNodes) break;
        }
      }
    }

    softCapSelected(selected, nodeById, seedIds, bounds.maxNodes);

    const nodes = [...selected]
      .map(id => nodeById.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const edges = graph.edges
      .filter(e => selected.has(e.from) && selected.has(e.to))
      .sort((a, b) => {
        const ak = `${a.kind}|${a.from}|${a.to}`;
        const bk = `${b.kind}|${b.from}|${b.to}`;
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      });

    const relatedFiles = nodes
      .filter(n => n.kind === 'file' && n.path)
      .map(n => n.path!)
      .sort();

    const truncated =
      graph.nodes.length > nodes.length
      || fileIds.length > relatedFiles.length
      || relatedFiles.length >= bounds.maxFiles
      || nodes.length >= bounds.maxNodes;

    const provenance = buildProvenance({
      freshness,
      queryId,
      seeds,
      direction,
      bounds,
      nodesReturned: nodes.length,
      edgesReturned: edges.length,
      filesReturned: relatedFiles.length,
      truncated,
      graph,
      reason: request.reason,
      staleReason: graph.meta.staleReason,
    });

    return {
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
      relatedFiles: Object.freeze(relatedFiles),
      promptSection: formatPromptSection(nodes, edges, provenance),
      provenance,
      graph,
    };
  }

  private async resolveFreshness(graph: StructuralGraph | null): Promise<StructuralKnowledgeFreshness> {
    if (!graph) return 'UNKNOWN';
    if (graph.meta.stale === true) return 'STALE';

    if (this.runtime) {
      try {
        if (await this.runtime.exists(STRUCTURAL_SYNC_STATE_RELATIVE_PATH)) {
          const raw = await this.runtime.readFile(STRUCTURAL_SYNC_STATE_RELATIVE_PATH);
          if (raw?.trim()) {
            const state = JSON.parse(raw) as StructuralSyncState;
            if (state.stale || state.ok === false) return 'STALE';
          }
        }
      } catch {
        return 'UNKNOWN';
      }
    }

    return 'FRESH';
  }
}

function resolveDirection(request: StructuralKnowledgeQueryRequest): StructuralQueryDirection {
  if (request.direction) return request.direction;
  const includeImports = request.includeImports !== false;
  const includeImporters = request.includeImporters !== false;
  if (includeImports && includeImporters) return 'both';
  if (includeImports) return 'imports';
  if (includeImporters) return 'importers';
  return 'both';
}

function resolveBounds(request: StructuralKnowledgeQueryRequest): {
  maxDepth: number;
  maxNodes: number;
  maxFiles: number;
} {
  const hard = STRUCTURAL_QUERY_HARD_LIMITS;
  const maxDepth = clamp(
    request.maxDepth ?? hard.defaultMaxDepth,
    1,
    hard.maxDepth,
  );
  const maxNodes = clamp(
    request.maxNodes ?? hard.defaultMaxNodes,
    1,
    hard.maxNodes,
  );
  const maxFiles = clamp(
    request.maxFiles ?? maxNodes,
    1,
    Math.min(hard.maxFiles, maxNodes),
  );
  return { maxDepth, maxNodes, maxFiles };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function buildImportAdjacency(
  edges: ReadonlyArray<KnowledgeEdge>,
  direction: StructuralQueryDirection,
): Map<string, string[]> {
  const adj = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from)!.add(to);
  };
  for (const e of edges) {
    if (e.kind !== 'imports') continue;
    if (direction === 'imports' || direction === 'both') add(e.from, e.to);
    if (direction === 'importers' || direction === 'both') add(e.to, e.from);
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of adj) {
    out.set(k, [...set].sort());
  }
  return out;
}

function softCapSelected(
  selected: Set<string>,
  nodeById: Map<string, KnowledgeNode>,
  seedIds: ReadonlyArray<string>,
  maxNodes: number,
): void {
  if (selected.size <= maxNodes) return;
  const seedSet = new Set(seedIds);
  const ids = [...selected].sort((a, b) => {
    const as = seedSet.has(a) ? 0 : 1;
    const bs = seedSet.has(b) ? 0 : 1;
    if (as !== bs) return as - bs;
    const ak = nodeById.get(a)?.kind === 'file' ? 0 : 1;
    const bk = nodeById.get(b)?.kind === 'file' ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  selected.clear();
  for (const id of ids.slice(0, maxNodes)) selected.add(id);
}

function buildProvenance(input: {
  freshness: StructuralKnowledgeFreshness;
  queryId: string;
  seeds: ReadonlyArray<string>;
  direction: StructuralQueryDirection;
  bounds: { maxDepth: number; maxNodes: number; maxFiles: number };
  nodesReturned: number;
  edgesReturned: number;
  filesReturned: number;
  truncated: boolean;
  graph: StructuralGraph | null;
  reason?: string;
  staleReason?: string;
}): StructuralKnowledgeQueryProvenance {
  const claimCertainty = input.freshness === 'FRESH';
  const source =
    !input.graph ? 'unavailable' as const
      : input.freshness === 'STALE' ? 'structural-graph-stale' as const
        : 'structural-graph' as const;

  return Object.freeze({
    source,
    freshness: input.freshness,
    claimCertainty,
    queryId: input.queryId,
    seeds: Object.freeze([...input.seeds]),
    direction: input.direction,
    maxDepth: input.bounds.maxDepth,
    maxNodes: input.bounds.maxNodes,
    maxFiles: input.bounds.maxFiles,
    nodesReturned: input.nodesReturned,
    edgesReturned: input.edgesReturned,
    filesReturned: input.filesReturned,
    truncated: input.truncated,
    graphContentHash: input.graph?.meta.contentHash ?? null,
    graphFileCount: input.graph?.meta.fileCount ?? null,
    reason: input.reason,
    staleReason: input.freshness === 'STALE' ? (input.staleReason ?? 'sync state or graph marked stale') : undefined,
  });
}

function emptyResult(input: {
  queryId: string;
  seeds: ReadonlyArray<string>;
  direction: StructuralQueryDirection;
  bounds: { maxDepth: number; maxNodes: number; maxFiles: number };
  graph: StructuralGraph | null;
  freshness: StructuralKnowledgeFreshness;
  reason?: string;
}): StructuralKnowledgeQueryResult {
  const provenance = buildProvenance({
    freshness: input.freshness,
    queryId: input.queryId,
    seeds: input.seeds,
    direction: input.direction,
    bounds: input.bounds,
    nodesReturned: 0,
    edgesReturned: 0,
    filesReturned: 0,
    truncated: false,
    graph: input.graph,
    reason: input.reason,
  });
  return {
    nodes: Object.freeze([]),
    edges: Object.freeze([]),
    relatedFiles: Object.freeze([]),
    promptSection: '',
    provenance,
    graph: input.graph,
  };
}

function uniquePaths(paths: ReadonlyArray<string>): string[] {
  return [...new Set(paths.map(p => normalizePosix(p)).filter(Boolean))].sort();
}

function resolveSeedId(seed: string, nodeById: Map<string, KnowledgeNode>): string | null {
  const norm = normalizePosix(seed);
  if (nodeById.has(norm)) return norm;
  for (const n of nodeById.values()) {
    if (n.kind === 'file' && n.path === norm) return n.id;
  }
  return null;
}

/** Stable id so identical requests without queryId stay deterministic. */
function stableQueryKey(request: StructuralKnowledgeQueryRequest): string {
  const seeds = uniquePaths(request.seeds).join(',');
  const direction = resolveDirection(request);
  const bounds = resolveBounds(request);
  return `${direction}|d${bounds.maxDepth}|n${bounds.maxNodes}|f${bounds.maxFiles}|${seeds}`;
}

function formatPromptSection(
  nodes: ReadonlyArray<KnowledgeNode>,
  edges: ReadonlyArray<KnowledgeEdge>,
  provenance: StructuralKnowledgeQueryProvenance,
): string {
  if (nodes.length === 0) return '';
  const lines: string[] = [
    '## STRUCTURAL KNOWLEDGE (bounded graph query — not full repository)',
    `freshness: ${provenance.freshness}${provenance.claimCertainty ? '' : ' — do not treat as authoritative FS truth'}`,
    `source: ${provenance.source}`,
    `seeds: ${provenance.seeds.join(', ') || '(none)'}`,
    `bounds: direction=${provenance.direction} depth≤${provenance.maxDepth} files≤${provenance.maxFiles} nodes≤${provenance.maxNodes}`,
    `returned: files=${provenance.filesReturned} nodes=${provenance.nodesReturned}/${provenance.maxNodes} (graph files=${provenance.graphFileCount ?? '?'})`,
  ];
  if (provenance.staleReason) {
    lines.push(`staleReason: ${provenance.staleReason}`);
  }

  const files = nodes.filter(n => n.kind === 'file');
  if (files.length > 0) {
    lines.push('Relevant files:');
    for (const f of files) {
      const exports = f.exports?.slice(0, 6).join(', ') ?? '';
      lines.push(`- ${f.path}${exports ? ` exports=[${exports}]` : ''}`);
    }
  }

  const modules = nodes.filter(n => n.kind === 'module');
  if (modules.length > 0) {
    lines.push('Containing modules:');
    for (const m of modules.slice(0, provenance.maxFiles)) {
      lines.push(`- ${m.path ?? m.id}`);
    }
  }

  const imports = edges.filter(e => e.kind === 'imports');
  if (imports.length > 0) {
    lines.push('Import relationships:');
    for (const e of imports.slice(0, provenance.maxFiles * 2)) {
      lines.push(`- ${e.from} → ${e.to}`);
    }
  }

  return lines.join('\n');
}
