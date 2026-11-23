import {
  KnowledgeSyncEdgeChange,
  KnowledgeSyncInput,
  KnowledgeSyncResult,
  KnowledgeSynchronizer,
} from '../../contracts/knowledge-synchronizer';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Workspace } from '../../contracts/workspace';
import {
  EMPTY_MUTATION_LEDGER,
  MutationLedger,
  normalizeMutationPath,
} from '../../domain/execution/mutation-safety';
import {
  KnowledgeEdge,
  KnowledgeNode,
  STRUCTURAL_GRAPH_RELATIVE_PATH,
  STRUCTURAL_GRAPH_SCHEMA_VERSION,
  STRUCTURAL_SYNC_STATE_RELATIVE_PATH,
  StructuralGraph,
  StructuralSyncState,
  freezeStructuralGraph,
  freezeStructuralSyncState,
} from '../../domain/structural-knowledge';
import { StructuralAnalyzer } from '../patch/structural-analyzer';
import {
  DefaultStructuralGraphIndexer,
  discoverRootsFromFiles,
  hashCanonicalPayload,
  moduleIdForFile,
  normalizePosix,
  resolveImportToFile,
  serializeCanonical,
} from './structural-graph-indexer';
import { ChangeDetector, isStructuralSourceFile } from './utils/change-detector';

/**
 * Deterministic incremental structural synchronizer.
 * Reuses StructuralAnalyzer + ChangeDetector.hashFile.
 * Filesystem is authoritative; Mutation Ledger only supplies candidate paths.
 * Does not call LLM, KnowledgePipeline, TaskExecutor, or Planner.
 */
export class DefaultKnowledgeSynchronizer implements KnowledgeSynchronizer {
  private readonly changeDetector: ChangeDetector;
  private readonly analyzer: StructuralAnalyzer;
  private readonly indexer: DefaultStructuralGraphIndexer;

  constructor(
    private readonly workspace: Workspace,
    private readonly runtime: RuntimeRepository,
    private readonly projectRoot: string,
    analyzer?: StructuralAnalyzer,
    indexer?: DefaultStructuralGraphIndexer,
  ) {
    this.changeDetector = new ChangeDetector(workspace);
    this.analyzer = analyzer ?? new StructuralAnalyzer();
    this.indexer = indexer ?? new DefaultStructuralGraphIndexer(
      workspace,
      runtime,
      projectRoot,
      this.analyzer,
    );
  }

  candidatesFromLedger(ledger: MutationLedger = EMPTY_MUTATION_LEDGER): ReadonlyArray<string> {
    const paths = new Set<string>();
    for (const result of ledger.results) {
      const normalized = normalizePosix(normalizeMutationPath(result.path));
      if (normalized && isStructuralSourceFile(normalized)) {
        paths.add(normalized);
      }
    }
    return Object.freeze([...paths].sort());
  }

  async loadSyncState(): Promise<StructuralSyncState | null> {
    try {
      if (!(await this.runtime.exists(STRUCTURAL_SYNC_STATE_RELATIVE_PATH))) {
        return null;
      }
      const raw = await this.runtime.readFile(STRUCTURAL_SYNC_STATE_RELATIVE_PATH);
      if (!raw?.trim()) return null;
      return freezeStructuralSyncState(JSON.parse(raw) as StructuralSyncState);
    } catch {
      return null;
    }
  }

  async syncFailOpen(input: KnowledgeSyncInput): Promise<KnowledgeSyncResult> {
    try {
      return await this.sync(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.markStaleAndReturn(input, message, /*rethrow*/ false);
    }
  }

  async sync(input: KnowledgeSyncInput): Promise<KnowledgeSyncResult> {
    const candidates = uniqueStructuralPaths(input.candidatePaths);
    const repositoryFileCountEstimate = await this.estimateRepositoryFileCount();

    if (candidates.length === 0 || input.outcome === 'skipped') {
      const reason = candidates.length === 0 ? 'no mutation' : 'outcome skipped';
      const state = await this.persistSyncState({
        ok: true,
        stale: false,
        skipped: true,
        reason,
        fallbackUsed: false,
        repositoryFileCount: repositoryFileCountEstimate,
        affectedFileCount: 0,
        analyzedFileCount: 0,
        analyzedPaths: [],
        changedNodes: [],
        sessionId: input.sessionId,
        stepId: input.stepId,
        updatedAt: new Date().toISOString(),
      });
      const graph = await this.indexer.load();
      return {
        changedNodes: [],
        changedEdges: [],
        skipped: true,
        reason,
        ok: true,
        stale: false,
        fallbackUsed: false,
        repositoryFileCount: repositoryFileCountEstimate,
        affectedFileCount: 0,
        analyzedFileCount: 0,
        analyzedPaths: [],
        graph,
        syncState: state,
      };
    }

    let graph = await this.indexer.load();
    let fallbackUsed = false;
    let fallbackReason: string | undefined;

    if (!graph || input.forceFullReindex) {
      fallbackUsed = true;
      fallbackReason = !graph
        ? 'missing structural graph — full reindex required'
        : 'forceFullReindex requested';
      graph = await this.indexer.indexAndPersist();
      // After bootstrap, still apply incremental FS truth for candidates
      // so create/delete during missing-graph recovery is correct.
    }

    const beforeEdges = new Set(graph.edges.map(edgeKey));
    const beforeNodes = new Set(graph.nodes.map(n => n.id));
    const repositoryFileCount = graph.nodes.filter(n => n.kind === 'file').length;

    const { nextGraph, analyzedPaths, changedNodeIds } = await this.applyIncremental(
      graph,
      candidates,
    );

    // Clear stale flags on successful sync
    const cleared: StructuralGraph = freezeStructuralGraph({
      ...nextGraph,
      meta: {
        ...nextGraph.meta,
        stale: false,
        staleReason: undefined,
        lastSyncError: undefined,
        generationMode: fallbackUsed && analyzedPaths.length === 0
          ? 'full'
          : 'incremental',
      },
    });

    // Recompute content hash after clearing stale (stale is not part of hash payload nodes/edges)
    const finalGraph = rebuildMeta(cleared, this.projectRoot, cleared.meta.generationMode);

    await this.indexer.persist(finalGraph);

    const afterEdges = new Set(finalGraph.edges.map(edgeKey));
    const afterNodes = new Set(finalGraph.nodes.map(n => n.id));
    const changedEdges = diffEdges(beforeEdges, afterEdges);
    const changedNodes = [
      ...new Set([
        ...changedNodeIds,
        ...[...afterNodes].filter(id => !beforeNodes.has(id)),
        ...[...beforeNodes].filter(id => !afterNodes.has(id)),
      ]),
    ].sort();

    const state = await this.persistSyncState({
      ok: true,
      stale: false,
      skipped: false,
      reason: fallbackUsed ? `incremental after fallback: ${fallbackReason}` : 'incremental sync',
      fallbackUsed,
      fallbackReason,
      repositoryFileCount,
      affectedFileCount: candidates.length,
      analyzedFileCount: analyzedPaths.length,
      analyzedPaths,
      changedNodes,
      sessionId: input.sessionId,
      stepId: input.stepId,
      updatedAt: new Date().toISOString(),
    });

    return {
      changedNodes,
      changedEdges,
      skipped: false,
      reason: state.reason,
      ok: true,
      stale: false,
      fallbackUsed,
      fallbackReason,
      repositoryFileCount,
      affectedFileCount: candidates.length,
      analyzedFileCount: analyzedPaths.length,
      analyzedPaths,
      graph: finalGraph,
      syncState: state,
    };
  }

  /**
   * Apply filesystem-authoritative create/modify/delete for candidate paths only.
   * Only existing candidate files are AST-analyzed (K << N for limited mutations).
   */
  private async applyIncremental(
    graph: StructuralGraph,
    candidates: ReadonlyArray<string>,
  ): Promise<{
    nextGraph: StructuralGraph;
    analyzedPaths: string[];
    changedNodeIds: string[];
  }> {
    let nodes = [...graph.nodes];
    let edges = [...graph.edges];
    const analyzedPaths: string[] = [];
    const changedNodeIds: string[] = [];

    // Working file set = current file nodes + all candidates that exist on FS.
    // Pre-register creates so same-batch import resolution (A→B) succeeds.
    const fileSet = new Set(
      nodes.filter(n => n.kind === 'file' && n.path).map(n => normalizePosix(n.path!)),
    );
    for (const filePath of candidates) {
      if (await this.workspace.exists(filePath)) {
        fileSet.add(filePath);
      } else {
        fileSet.delete(filePath);
      }
    }

    for (const filePath of candidates) {
      const exists = await this.workspace.exists(filePath);
      if (!exists) {
        const removed = removeFileContribution(nodes, edges, filePath, 'delete');
        nodes = removed.nodes;
        edges = removed.edges;
        fileSet.delete(filePath);
        changedNodeIds.push(filePath);
        continue;
      }

      // Create or modify — analyze this file only
      const content = await this.workspace.readFile(filePath);
      const hash = await this.changeDetector.hashFile(filePath);
      const signature = this.analyzer.extractSignature(content, filePath);
      analyzedPaths.push(filePath);

      const stripped = removeFileContribution(nodes, edges, filePath, 'replace');
      nodes = stripped.nodes;
      edges = stripped.edges;

      const contribution = buildFileContribution(filePath, hash, signature, fileSet);
      nodes.push(...contribution.nodes);
      edges.push(...contribution.edges);
      // Dedupe nodes/edges (module nodes may already exist from siblings)
      nodes = dedupeNodesById(nodes);
      edges = dedupeEdges(edges);
      changedNodeIds.push(filePath, ...contribution.nodes.map(n => n.id));
    }

    // Drop orphan module nodes (no remaining contains → file)
    const cleaned = pruneOrphanModules(nodes, edges);
    nodes = cleaned.nodes;
    edges = cleaned.edges;

    nodes.sort(compareById);
    edges.sort(compareEdges);

    const nextGraph = rebuildMeta(
      freezeStructuralGraph({
        meta: {
          schemaVersion: STRUCTURAL_GRAPH_SCHEMA_VERSION,
          projectRoot: normalizePosix(this.projectRoot),
          indexedAt: new Date().toISOString(),
          contentHash: '',
          fileCount: 0,
          nodeCount: 0,
          edgeCount: 0,
          roots: [],
          generationMode: 'incremental',
        },
        nodes,
        edges,
      }),
      this.projectRoot,
      'incremental',
    );

    return {
      nextGraph,
      analyzedPaths: [...analyzedPaths].sort(),
      changedNodeIds: [...new Set(changedNodeIds)].sort(),
    };
  }

  private async estimateRepositoryFileCount(): Promise<number> {
    const graph = await this.indexer.load();
    if (graph) return graph.nodes.filter(n => n.kind === 'file').length;
    try {
      const files = await this.changeDetector.listAllSourceFiles();
      return files.length;
    } catch {
      return 0;
    }
  }

  private async persistSyncState(state: StructuralSyncState): Promise<StructuralSyncState> {
    const frozen = freezeStructuralSyncState(state);
    await this.runtime.mkdir('knowledge');
    await this.runtime.writeFile(
      STRUCTURAL_SYNC_STATE_RELATIVE_PATH,
      `${JSON.stringify(frozen, null, 2)}\n`,
    );
    return frozen;
  }

  private async markStaleAndReturn(
    input: KnowledgeSyncInput,
    errorMessage: string,
    _rethrow: boolean,
  ): Promise<KnowledgeSyncResult> {
    const existing = await this.indexer.load();
    const repositoryFileCount = existing?.nodes.filter(n => n.kind === 'file').length ?? 0;
    const candidates = uniqueStructuralPaths(input.candidatePaths);

    if (existing) {
      const staleGraph = rebuildMeta(
        freezeStructuralGraph({
          ...existing,
          meta: {
            ...existing.meta,
            stale: true,
            staleReason: 'knowledge sync failed',
            lastSyncError: errorMessage,
            indexedAt: new Date().toISOString(),
          },
        }),
        this.projectRoot,
        existing.meta.generationMode,
      );
      // Persist stale marker without recomputing nodes (contentHash unchanged structurally)
      await this.runtime.mkdir('knowledge');
      await this.runtime.writeFile(STRUCTURAL_GRAPH_RELATIVE_PATH, serializeCanonical(staleGraph));
    }

    const state = await this.persistSyncState({
      ok: false,
      stale: true,
      skipped: false,
      reason: 'sync failed',
      fallbackUsed: false,
      repositoryFileCount,
      affectedFileCount: candidates.length,
      analyzedFileCount: 0,
      analyzedPaths: [],
      changedNodes: [],
      sessionId: input.sessionId,
      stepId: input.stepId,
      updatedAt: new Date().toISOString(),
      error: errorMessage,
    });

    return {
      changedNodes: [],
      changedEdges: [],
      skipped: false,
      reason: 'sync failed',
      ok: false,
      stale: true,
      fallbackUsed: false,
      repositoryFileCount,
      affectedFileCount: candidates.length,
      analyzedFileCount: 0,
      analyzedPaths: [],
      graph: existing,
      syncState: state,
    };
  }
}

function uniqueStructuralPaths(paths: ReadonlyArray<string>): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const normalized = normalizePosix(normalizeMutationPath(p));
    if (normalized && isStructuralSourceFile(normalized)) {
      set.add(normalized);
    }
  }
  return [...set].sort();
}

function edgeKey(e: KnowledgeEdge): string {
  return `${e.kind}|${e.from}|${e.to}`;
}

function diffEdges(
  before: Set<string>,
  after: Set<string>,
): KnowledgeSyncEdgeChange[] {
  const changes: KnowledgeSyncEdgeChange[] = [];
  for (const key of before) {
    if (!after.has(key)) {
      const [kind, from, to] = key.split('|');
      changes.push({ from, to, kind, change: 'removed' });
    }
  }
  for (const key of after) {
    if (!before.has(key)) {
      const [kind, from, to] = key.split('|');
      changes.push({ from, to, kind, change: 'added' });
    }
  }
  return changes.sort((a, b) => {
    const ak = `${a.change}|${a.from}|${a.to}`;
    const bk = `${b.change}|${b.from}|${b.to}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareEdges(a: KnowledgeEdge, b: KnowledgeEdge): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
}

/** Remove file node, its symbols, and edges that belong to this file's contribution.
 * @param mode 'replace' keeps incoming import edges from other files (modify path).
 *              'delete' removes all edges touching the file (true deletion).
 */
export function removeFileContribution(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  filePath: string,
  mode: 'replace' | 'delete' = 'delete',
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const path = normalizePosix(filePath);
  const removeIds = new Set<string>();
  for (const n of nodes) {
    if (n.id === path) removeIds.add(n.id);
    if (n.kind === 'symbol' && n.path === path) removeIds.add(n.id);
  }
  const nextNodes = nodes.filter(n => !removeIds.has(n.id));
  const nextEdges = edges.filter(e => {
    if (mode === 'delete') {
      return !removeIds.has(e.from) && !removeIds.has(e.to);
    }
    // replace: drop this file's outgoing contribution + symbol edges only
    if (removeIds.has(e.from)) return false;
    if (e.to.startsWith(`${path}#`)) return false;
    return true;
  });
  return { nodes: nextNodes, edges: nextEdges };
}

export function buildFileContribution(
  filePath: string,
  hash: string,
  signature: { exports: Array<{ name: string; kind: string }>; imports: Array<{ modulePath: string }>; topLevelStatements: number },
  fileSet: Set<string>,
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const path = normalizePosix(filePath);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();

  const exportNames = signature.exports.map(e => e.name).sort();
  nodes.push({
    id: path,
    kind: 'file',
    path,
    hash,
    exports: exportNames.length > 0 ? exportNames : undefined,
    metadata: Object.freeze({
      extension: path.endsWith('.tsx') ? '.tsx' : '.ts',
      topLevelStatements: signature.topLevelStatements,
      importCount: signature.imports.length,
    }),
  });

  const moduleId = moduleIdForFile(path);
  if (moduleId) {
    nodes.push({
      id: moduleId,
      kind: 'module',
      path: moduleId.replace(/^module:/, ''),
      metadata: Object.freeze({ derivedFrom: 'directory' }),
    });
    addEdge(edgeKeys, edges, { from: moduleId, to: path, kind: 'contains' });
  }

  for (const exp of signature.exports) {
    const symbolId = `${path}#${exp.name}`;
    nodes.push({
      id: symbolId,
      kind: 'symbol',
      path,
      metadata: Object.freeze({ symbolKind: exp.kind, name: exp.name }),
    });
    addEdge(edgeKeys, edges, { from: path, to: symbolId, kind: 'contains' });
  }

  for (const imp of signature.imports) {
    if (!imp.modulePath.startsWith('.') && !imp.modulePath.startsWith('/')) continue;
    const resolved = resolveImportToFile(path, imp.modulePath, fileSet);
    if (resolved) {
      addEdge(edgeKeys, edges, { from: path, to: resolved, kind: 'imports' });
    }
  }

  return { nodes, edges };
}

function addEdge(
  keys: Set<string>,
  edges: KnowledgeEdge[],
  edge: KnowledgeEdge,
): void {
  const key = `${edge.kind}|${edge.from}|${edge.to}`;
  if (keys.has(key)) return;
  keys.add(key);
  edges.push(edge);
}

function dedupeNodesById(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const map = new Map<string, KnowledgeNode>();
  for (const n of nodes) map.set(n.id, n);
  return [...map.values()];
}

function dedupeEdges(edges: KnowledgeEdge[]): KnowledgeEdge[] {
  const map = new Map<string, KnowledgeEdge>();
  for (const e of edges) map.set(edgeKey(e), e);
  return [...map.values()];
}

function pruneOrphanModules(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const fileIds = new Set(nodes.filter(n => n.kind === 'file').map(n => n.id));
  const keepModules = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== 'module') continue;
    // Keep module if it still contains at least one file node
    const hasFile = edges.some(
      e => e.kind === 'contains' && e.from === n.id && fileIds.has(e.to),
    );
    if (hasFile) keepModules.add(n.id);
  }

  const nextNodes = nodes.filter(n => {
    if (n.kind === 'module') return keepModules.has(n.id);
    return true;
  });
  const keepIds = new Set(nextNodes.map(n => n.id));
  const nextEdges = edges.filter(e => keepIds.has(e.from) && keepIds.has(e.to));
  return { nodes: nextNodes, edges: nextEdges };
}

function rebuildMeta(
  graph: StructuralGraph,
  projectRoot: string,
  generationMode: 'full' | 'incremental',
): StructuralGraph {
  const fileNodes = graph.nodes.filter(n => n.kind === 'file');
  const files = fileNodes.map(n => n.path!).filter(Boolean);
  const contentHash = hashCanonicalPayload(graph.nodes, graph.edges);
  return freezeStructuralGraph({
    meta: {
      schemaVersion: STRUCTURAL_GRAPH_SCHEMA_VERSION,
      projectRoot: normalizePosix(projectRoot),
      indexedAt: graph.meta.indexedAt || new Date().toISOString(),
      contentHash,
      fileCount: fileNodes.length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      roots: discoverRootsFromFiles(files),
      generationMode,
      ...(graph.meta.stale ? { stale: true } : { stale: false }),
      ...(graph.meta.staleReason ? { staleReason: graph.meta.staleReason } : {}),
      ...(graph.meta.lastSyncError ? { lastSyncError: graph.meta.lastSyncError } : {}),
    },
    nodes: graph.nodes,
    edges: graph.edges,
  });
}
