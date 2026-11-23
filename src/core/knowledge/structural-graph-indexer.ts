import * as crypto from 'crypto';
import * as path from 'path';
import { StructuralGraphIndexer } from '../../contracts/structural-graph-indexer';
import { RuntimeRepository } from '../../contracts/runtime-repository';
import { Workspace } from '../../contracts/workspace';
import {
  STRUCTURAL_GRAPH_RELATIVE_PATH,
  STRUCTURAL_GRAPH_SCHEMA_VERSION,
  StructuralGraph,
  KnowledgeEdge,
  KnowledgeNode,
  freezeStructuralGraph,
} from '../../domain/structural-knowledge';
import { StructuralAnalyzer } from '../patch/structural-analyzer';
import { ChangeDetector } from './utils/change-detector';

/**
 * Deterministic, LLM-free structural indexer.
 * Reuses StructuralAnalyzer (AST) and ChangeDetector.hashFile (canonical hash).
 * Does not call KnowledgePipeline or TaskExecutor.
 */
export class DefaultStructuralGraphIndexer implements StructuralGraphIndexer {
  private readonly changeDetector: ChangeDetector;
  private readonly analyzer: StructuralAnalyzer;

  constructor(
    private readonly workspace: Workspace,
    private readonly runtime: RuntimeRepository,
    private readonly projectRoot: string,
    analyzer?: StructuralAnalyzer,
  ) {
    this.changeDetector = new ChangeDetector(workspace);
    this.analyzer = analyzer ?? new StructuralAnalyzer();
  }

  async buildInitialIndex(): Promise<StructuralGraph> {
    const files = await this.changeDetector.listAllSourceFiles();
    const fileSet = new Set(files);
    const roots = discoverRootsFromFiles(files);

    const nodes: KnowledgeNode[] = [];
    const edgeKeys = new Set<string>();
    const edges: KnowledgeEdge[] = [];

    const moduleIds = new Set<string>();

    for (const filePath of files) {
      const content = await this.workspace.readFile(filePath);
      const hash = await this.changeDetector.hashFile(filePath);
      const signature = this.analyzer.extractSignature(content, filePath);
      const exportNames = signature.exports.map(e => e.name).sort();

      nodes.push({
        id: filePath,
        kind: 'file',
        path: filePath,
        hash,
        exports: exportNames.length > 0 ? exportNames : undefined,
        metadata: Object.freeze({
          extension: filePath.endsWith('.tsx') ? '.tsx' : '.ts',
          topLevelStatements: signature.topLevelStatements,
          importCount: signature.imports.length,
        }),
      });

      const moduleId = moduleIdForFile(filePath);
      if (moduleId && !moduleIds.has(moduleId)) {
        moduleIds.add(moduleId);
        nodes.push({
          id: moduleId,
          kind: 'module',
          path: moduleId.replace(/^module:/, ''),
          metadata: Object.freeze({ derivedFrom: 'directory' }),
        });
      }
      if (moduleId) {
        addEdge(edgeKeys, edges, {
          from: moduleId,
          to: filePath,
          kind: 'contains',
        });
      }

      for (const exp of signature.exports) {
        const symbolId = `${filePath}#${exp.name}`;
        nodes.push({
          id: symbolId,
          kind: 'symbol',
          path: filePath,
          metadata: Object.freeze({ symbolKind: exp.kind, name: exp.name }),
        });
        addEdge(edgeKeys, edges, {
          from: filePath,
          to: symbolId,
          kind: 'contains',
        });
      }

      for (const imp of signature.imports) {
        if (!imp.modulePath.startsWith('.') && !imp.modulePath.startsWith('/')) {
          // External package — record unresolved edge target as package id (no file node required)
          continue;
        }
        const resolved = resolveImportToFile(filePath, imp.modulePath, fileSet);
        if (resolved) {
          addEdge(edgeKeys, edges, {
            from: filePath,
            to: resolved,
            kind: 'imports',
          });
        }
      }
    }

    nodes.sort(compareById);
    edges.sort(compareEdges);

    const contentHash = hashCanonicalPayload(nodes, edges);
    const graph = freezeStructuralGraph({
      meta: {
        schemaVersion: STRUCTURAL_GRAPH_SCHEMA_VERSION,
        projectRoot: normalizePosix(this.projectRoot),
        indexedAt: new Date().toISOString(),
        contentHash,
        fileCount: files.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        roots,
        generationMode: 'full',
      },
      nodes,
      edges,
    });

    return graph;
  }

  async persist(graph: StructuralGraph): Promise<void> {
    await this.runtime.mkdir('knowledge');
    const payload = serializeCanonical(graph);
    await this.runtime.writeFile(STRUCTURAL_GRAPH_RELATIVE_PATH, payload);
  }

  async indexAndPersist(): Promise<StructuralGraph> {
    const graph = await this.buildInitialIndex();
    await this.persist(graph);
    return graph;
  }

  async load(): Promise<StructuralGraph | null> {
    try {
      if (!(await this.runtime.exists(STRUCTURAL_GRAPH_RELATIVE_PATH))) {
        return null;
      }
      const raw = await this.runtime.readFile(STRUCTURAL_GRAPH_RELATIVE_PATH);
      if (!raw || raw.trim().length === 0) return null;
      const parsed = JSON.parse(raw) as StructuralGraph;
      if (!parsed?.meta || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        return null;
      }
      return freezeStructuralGraph(parsed);
    } catch {
      return null;
    }
  }
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

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareEdges(a: KnowledgeEdge, b: KnowledgeEdge): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
}

export function normalizePosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function moduleIdForFile(filePath: string): string | null {
  const normalized = normalizePosix(filePath);
  const parts = normalized.split('/');
  if (parts.length < 2) return null;
  // server/src/tasks/foo.ts → module:server/src/tasks
  // components/TaskCard.tsx → module:components
  // app/tasks/page.tsx → module:app/tasks
  if (parts[0] === 'server' && parts[1] === 'src' && parts.length >= 3) {
    return `module:server/src/${parts[2]}`;
  }
  if (parts.length >= 2) {
    return `module:${parts[0]}`;
  }
  return null;
}

export function discoverRootsFromFiles(files: string[]): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    const top = normalizePosix(f).split('/')[0];
    if (top) roots.add(top);
  }
  return [...roots].sort();
}

/**
 * Resolve a relative import specifier to a workspace-relative source file path.
 */
export function resolveImportToFile(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const fromDir = path.posix.dirname(normalizePosix(fromFile));
  let joined = normalizePosix(path.posix.normalize(path.posix.join(fromDir, specifier)));
  if (joined.startsWith('./')) joined = joined.slice(2);

  const candidates: string[] = [];
  // Specifier may already include .ts/.tsx/.js
  candidates.push(joined);
  candidates.push(joined.replace(/\.js$/, '.ts'));
  candidates.push(joined.replace(/\.jsx$/, '.tsx'));
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(joined)) {
    candidates.push(`${joined}.ts`, `${joined}.tsx`, `${joined}/index.ts`, `${joined}/index.tsx`);
  }

  for (const c of candidates) {
    const norm = normalizePosix(c);
    if (fileSet.has(norm)) return norm;
  }
  return null;
}

/** Canonical JSON for persistence — stable key order via sorted arrays already. */
export function serializeCanonical(graph: StructuralGraph): string {
  // Re-build a plain object with meta fields in fixed order for stable stringification.
  const meta: Record<string, unknown> = {
    schemaVersion: graph.meta.schemaVersion,
    projectRoot: graph.meta.projectRoot,
    indexedAt: graph.meta.indexedAt,
    contentHash: graph.meta.contentHash,
    fileCount: graph.meta.fileCount,
    nodeCount: graph.meta.nodeCount,
    edgeCount: graph.meta.edgeCount,
    roots: [...graph.meta.roots],
    generationMode: graph.meta.generationMode,
  };
  if (graph.meta.stale !== undefined) meta.stale = graph.meta.stale;
  if (graph.meta.staleReason !== undefined) meta.staleReason = graph.meta.staleReason;
  if (graph.meta.lastSyncError !== undefined) meta.lastSyncError = graph.meta.lastSyncError;

  const payload = {
    meta,
    nodes: graph.nodes.map(n => ({
      id: n.id,
      kind: n.kind,
      ...(n.path !== undefined ? { path: n.path } : {}),
      ...(n.hash !== undefined ? { hash: n.hash } : {}),
      ...(n.exports !== undefined ? { exports: [...n.exports] } : {}),
      ...(n.metadata !== undefined ? { metadata: { ...n.metadata } } : {}),
    })),
    edges: graph.edges.map(e => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function hashCanonicalPayload(
  nodes: ReadonlyArray<KnowledgeNode>,
  edges: ReadonlyArray<KnowledgeEdge>,
): string {
  const body = JSON.stringify({
    nodes: nodes.map(n => ({
      id: n.id,
      kind: n.kind,
      path: n.path ?? null,
      hash: n.hash ?? null,
      exports: n.exports ? [...n.exports] : null,
      metadata: n.metadata ? { ...n.metadata } : null,
    })),
    edges: edges.map(e => ({ from: e.from, to: e.to, kind: e.kind })),
  });
  return crypto.createHash('sha256').update(body, 'utf-8').digest('hex').substring(0, 16);
}

/** Compare two graphs ignoring wall-clock indexedAt. */
export function structuralContentEqual(a: StructuralGraph, b: StructuralGraph): boolean {
  return a.meta.contentHash === b.meta.contentHash
    && JSON.stringify(a.nodes) === JSON.stringify(b.nodes)
    && JSON.stringify(a.edges) === JSON.stringify(b.edges);
}
