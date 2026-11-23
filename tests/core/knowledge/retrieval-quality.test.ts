import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import { DefaultStructuralGraphIndexer } from '../../../src/core/knowledge/structural-graph-indexer';
import { DefaultKnowledgeSynchronizer } from '../../../src/core/knowledge/knowledge-synchronizer';
import {
  DefaultStructuralKnowledgeQuery,
} from '../../../src/core/knowledge/structural-knowledge-query';
import { STRUCTURAL_QUERY_HARD_LIMITS } from '../../../src/contracts/structural-knowledge-query';
import { StructuralAnalyzer } from '../../../src/core/patch/structural-analyzer';
import { PlanStepKnowledgeBridge } from '../../../src/core/knowledge/plan-step-knowledge-bridge';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import {
  STRUCTURAL_GRAPH_RELATIVE_PATH,
  STRUCTURAL_SYNC_STATE_RELATIVE_PATH,
} from '../../../src/domain/structural-knowledge';

async function write(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, ...rel.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

describe('Phase 4 retrieval quality', () => {
  let tempDir: string;
  let indexer: DefaultStructuralGraphIndexer;
  let query: DefaultStructuralKnowledgeQuery;
  let synchronizer: DefaultKnowledgeSynchronizer;
  let runtime: LocalRuntimeRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase4-'));
    await write(tempDir, 'types/domain.ts', `export type Id = string;\n`);
    await write(tempDir, 'components/A.tsx', `import { B } from './B';\nexport function A() { return <B />; }\n`);
    await write(tempDir, 'components/B.tsx', `import { C } from './C';\nexport function B() { return <C />; }\n`);
    await write(tempDir, 'components/C.tsx', `export function C() { return <span>c</span>; }\n`);
    await write(tempDir, 'components/UnrelatedA.tsx', `export function UnrelatedA() { return null; }\n`);
    await write(tempDir, 'components/UnrelatedB.tsx', `export function UnrelatedB() { return null; }\n`);
    await write(tempDir, 'components/UnrelatedC.tsx', `export function UnrelatedC() { return null; }\n`);
    await fs.mkdir(path.join(tempDir, '.ai'), { recursive: true });

    const workspace = new LocalWorkspace(tempDir);
    runtime = new LocalRuntimeRepository(tempDir);
    const analyzer = new StructuralAnalyzer();
    indexer = new DefaultStructuralGraphIndexer(workspace, runtime, tempDir, analyzer);
    synchronizer = new DefaultKnowledgeSynchronizer(workspace, runtime, tempDir, analyzer, indexer);
    query = new DefaultStructuralKnowledgeQuery(indexer, runtime);
    await indexer.indexAndPersist();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // T1
  it('T1 query contract exposes explicit bounds', () => {
    expect(STRUCTURAL_QUERY_HARD_LIMITS.maxDepth).toBe(3);
    expect(STRUCTURAL_QUERY_HARD_LIMITS.maxNodes).toBe(64);
    expect(STRUCTURAL_QUERY_HARD_LIMITS.maxFiles).toBe(32);
  });

  // T2
  it('T2 direct imports query', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 1,
    });
    expect(result.relatedFiles).toEqual(expect.arrayContaining(['components/A.tsx', 'components/B.tsx']));
    expect(result.relatedFiles).not.toContain('components/C.tsx');
    expect(result.provenance.direction).toBe('imports');
  });

  // T3
  it('T3 reverse importers query', async () => {
    const result = await query.query({
      seeds: ['components/B.tsx'],
      direction: 'importers',
      maxDepth: 1,
    });
    expect(result.relatedFiles).toContain('components/A.tsx');
    expect(result.relatedFiles).toContain('components/B.tsx');
    expect(result.relatedFiles).not.toContain('components/C.tsx');
  });

  // T4
  it('T4 depth-1 excludes depth-2 nodes', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 1,
    });
    expect(result.relatedFiles).toContain('components/B.tsx');
    expect(result.relatedFiles).not.toContain('components/C.tsx');
    expect(result.provenance.maxDepth).toBe(1);
  });

  // T5
  it('T5 depth-2 includes transitive node', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 2,
    });
    expect(result.relatedFiles).toEqual(expect.arrayContaining([
      'components/A.tsx',
      'components/B.tsx',
      'components/C.tsx',
    ]));
  });

  // T6
  it('T6 unrelated nodes excluded', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'both',
      maxDepth: 2,
    });
    expect(result.relatedFiles).not.toContain('components/UnrelatedA.tsx');
    expect(result.relatedFiles).not.toContain('components/UnrelatedB.tsx');
    expect(result.relatedFiles).not.toContain('components/UnrelatedC.tsx');
  });

  // T7
  it('T7 maxNodes enforced', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 2,
      maxNodes: 2,
      includeSymbols: false,
    });
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.provenance.maxNodes).toBe(2);
  });

  // T8
  it('T8 maxFiles enforced', async () => {
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 2,
      maxFiles: 2,
      includeSymbols: false,
    });
    expect(result.relatedFiles.length).toBeLessThanOrEqual(2);
    expect(result.provenance.maxFiles).toBe(2);
  });

  // T9
  it('T9 deterministic identical query', async () => {
    const req = {
      seeds: ['components/A.tsx'],
      direction: 'both' as const,
      maxDepth: 1,
      maxNodes: 12,
      maxFiles: 8,
      queryId: 'det-1',
    };
    const a = await query.query(req);
    const b = await query.query(req);
    expect(a.relatedFiles).toEqual(b.relatedFiles);
    expect(a.provenance.graphContentHash).toBe(b.provenance.graphContentHash);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
  });

  // T10
  it('T10 query reads graph not filesystem', async () => {
    // Delete a related file from FS but leave graph — query still returns graph edge
    await fs.unlink(path.join(tempDir, 'components', 'B.tsx'));
    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 1,
    });
    expect(result.provenance.source).toMatch(/structural-graph/);
    expect(result.relatedFiles).toContain('components/B.tsx');
  });

  // T11
  it('T11 provenance records graph source', async () => {
    const result = await query.query({ seeds: ['components/A.tsx'], direction: 'both', maxDepth: 1 });
    expect(result.provenance.source).toBe('structural-graph');
    expect(result.provenance.graphContentHash).toBeTruthy();
    expect(result.provenance.freshness).toBe('FRESH');
    expect(result.provenance.claimCertainty).toBe(true);
  });

  // T12
  it('T12 fresh graph identified as fresh', async () => {
    const result = await query.query({ seeds: ['components/B.tsx'], maxDepth: 1 });
    expect(result.provenance.freshness).toBe('FRESH');
    expect(result.provenance.claimCertainty).toBe(true);
  });

  // T13 / T15
  it('T13/T15 sync failure produces stale and does not claim fresh provenance', async () => {
    // Mark graph stale via sync-state + meta
    const graph = await indexer.load();
    await runtime.writeFile(STRUCTURAL_GRAPH_RELATIVE_PATH, JSON.stringify({
      ...graph,
      meta: { ...graph!.meta, stale: true, staleReason: 'simulated sync failure' },
    }, null, 2) + '\n');
    await runtime.writeFile(STRUCTURAL_SYNC_STATE_RELATIVE_PATH, JSON.stringify({
      ok: false,
      stale: true,
      skipped: false,
      reason: 'sync failed',
      fallbackUsed: false,
      repositoryFileCount: graph!.meta.fileCount,
      affectedFileCount: 1,
      analyzedFileCount: 0,
      analyzedPaths: [],
      changedNodes: [],
      updatedAt: new Date().toISOString(),
      error: 'simulated',
    }, null, 2) + '\n');

    const result = await query.query({ seeds: ['components/A.tsx'], maxDepth: 1 });
    expect(result.provenance.freshness).toBe('STALE');
    expect(result.provenance.claimCertainty).toBe(false);
    expect(result.provenance.source).toBe('structural-graph-stale');
    expect(result.promptSection).toMatch(/STALE|do not treat as authoritative/i);
  });

  // T14
  it('T14 fail-open execution still works via syncFailOpen', async () => {
    const flakyWorkspace = new LocalWorkspace(tempDir);
    const failing = {
      readFile: async (p: string) => {
        if (p.includes('A.tsx')) throw new Error('boom');
        return flakyWorkspace.readFile(p);
      },
      writeFile: (p: string, c: string) => flakyWorkspace.writeFile(p, c),
      exists: (p: string) => flakyWorkspace.exists(p),
      listFiles: (p: string) => flakyWorkspace.listFiles(p),
      listEntries: (p: string) => flakyWorkspace.listEntries(p),
      createSnapshot: (d?: string) => flakyWorkspace.createSnapshot(d),
      rollback: (id: string) => flakyWorkspace.rollback(id),
      diff: (a: string, b?: string) => flakyWorkspace.diff(a, b),
      deleteFile: (p: string) => flakyWorkspace.deleteFile(p),
      mkdir: (p: string, o?: { recursive?: boolean }) => flakyWorkspace.mkdir(p, o),
      isDirectory: (p: string) => flakyWorkspace.isDirectory(p),
    };
    const sync = new DefaultKnowledgeSynchronizer(
      failing as any,
      runtime,
      tempDir,
      new StructuralAnalyzer(),
      new DefaultStructuralGraphIndexer(failing as any, runtime, tempDir),
    );
    const result = await sync.syncFailOpen({
      sessionId: 's',
      stepId: 'step',
      candidatePaths: ['components/A.tsx'],
      outcome: 'failed',
    });
    expect(result.ok).toBe(false);
    expect(result.stale).toBe(true);
  });

  // T16 / T17 / T18
  it('T16/T17/T18 planner and executor share query implementation with different bounds', async () => {
    const registry = createDefaultSkillRegistry();
    const resolvedSkills = {
      skills: [registry.get('frontend.core')!],
      reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'test' }],
      mode: 'explicit' as const,
    };
    const projectProfile = freezeProjectProfile({
      workspaceRoot: tempDir,
      projectType: 'frontend',
      detectedDomains: [],
      detectedFrameworks: [],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: [],
      capabilities: [],
    });
    const aiContext = freezeAiContextDiscovery({
      workspaceRoot: tempDir,
      rootPath: path.join(tempDir, '.ai'),
      exists: true,
      files: [],
    } as any);

    const strategy = new PlannerContextStrategyBuilder().build({
      userTask: 'Inspect components/A.tsx relationships',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      codebaseMapAvailable: true,
    });

    const gatherer = new TargetedContextGatherer({
      cache: new InMemoryContextCache(),
      aiContextLoader: { load: async () => aiContext } as any,
      structuralQuery: query,
    });
    const gathered = await gatherer.gather({
      workspaceRoot: tempDir,
      userTask: 'Inspect components/A.tsx relationships',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      strategy,
      aiContext,
    });
    const plannerRecord = gathered.records.find(r => r.source === 'CODEBASE_MAP' && r.status === 'COLLECTED');
    expect(plannerRecord?.collectionMethod).toBe('GRAPH_QUERY');

    const bridge = new PlanStepKnowledgeBridge(synchronizer, query);
    const exec = await bridge.beforeStep({
      sessionId: 's',
      step: {
        id: 's1',
        description: 'Edit components/A.tsx',
        objective: 'Edit components/A.tsx',
        expectedOutcome: 'done',
      } as any,
      seedPaths: ['components/A.tsx'],
    });
    expect(exec.query?.provenance.maxDepth).toBe(1);
    expect(exec.query?.provenance.maxFiles).toBe(8);
    expect(exec.promptSection).toContain('STRUCTURAL KNOWLEDGE');
    // Same class instance path — both used DefaultStructuralKnowledgeQuery
    expect(exec.query?.provenance.source).toMatch(/structural-graph/);
  });

  // T19 — duplicate traversal: only DefaultStructuralKnowledgeQuery implements query BFS
  it('T19 no duplicate graph traversal logic in bridge', async () => {
    const bridgeSrc = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/plan-step-knowledge-bridge.ts'),
      'utf-8',
    );
    expect(bridgeSrc).not.toMatch(/for \(const edge of graph\.edges\)/);
    expect(bridgeSrc).toMatch(/queryService\.query/);
  });

  // T20
  it('T20 large graph remains bounded', async () => {
    // Add many unrelated files under a scanned root (lib/)
    for (let i = 0; i < 80; i++) {
      await write(tempDir, `lib/filler${i}.ts`, `export const F${i} = ${i};\n`);
    }
    await indexer.indexAndPersist();
    const graph = await indexer.load();
    expect(graph!.meta.fileCount).toBeGreaterThan(70);

    const result = await query.query({
      seeds: ['components/A.tsx'],
      direction: 'imports',
      maxDepth: 2,
      maxNodes: 10,
      maxFiles: 5,
    });
    expect(result.relatedFiles.length).toBeLessThanOrEqual(5);
    expect(result.nodes.length).toBeLessThanOrEqual(10);
    expect(result.relatedFiles.every(f => !f.startsWith('lib/filler'))).toBe(true);
    expect(result.promptSection.length).toBeLessThan(4000);
  });

  // T27 / T28
  it('T27/T28 no LLM or KnowledgePipeline in retrieval hot path', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/structural-knowledge-query.ts'),
      'utf-8',
    );
    const imports = src.split(/\r?\n/).filter(l => /^\s*import\s/.test(l)).join('\n');
    expect(imports).not.toMatch(/KnowledgePipeline|ollama|TaskExecutor|TaskPlanner/i);
  });

  // T29
  it('T29 no full graph prompt', async () => {
    const graph = await indexer.load();
    const result = await query.query({
      seeds: ['components/A.tsx'],
      maxDepth: 1,
      maxFiles: 4,
    });
    expect(result.relatedFiles.length).toBeLessThan(graph!.meta.fileCount);
    expect(result.provenance.filesReturned).toBeLessThan(graph!.meta.fileCount);
  });
});
