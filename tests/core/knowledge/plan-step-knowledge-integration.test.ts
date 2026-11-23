import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import { DefaultStructuralGraphIndexer } from '../../../src/core/knowledge/structural-graph-indexer';
import { DefaultKnowledgeSynchronizer } from '../../../src/core/knowledge/knowledge-synchronizer';
import { DefaultStructuralKnowledgeQuery } from '../../../src/core/knowledge/structural-knowledge-query';
import { PlanStepKnowledgeBridge } from '../../../src/core/knowledge/plan-step-knowledge-bridge';
import { StructuralAnalyzer } from '../../../src/core/patch/structural-analyzer';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import {
  EMPTY_DIFF_SUMMARY,
  MutationLedger,
  buildMutationLedger,
} from '../../../src/domain/execution/mutation-safety';
import { PlanStep } from '../../../src/domain/execution-plan';

async function seed(tempDir: string): Promise<void> {
  await fs.mkdir(path.join(tempDir, 'components'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'types'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.ai'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'types', 'domain.ts'),
    `export type TaskStatus = 'todo' | 'done';\nexport interface Task { id: string; status: TaskStatus }\n`,
  );
  await fs.writeFile(
    path.join(tempDir, 'components', 'StatusBadge.tsx'),
    `export function StatusBadge() { return <span>ok</span>; }\n`,
  );
  await fs.writeFile(
    path.join(tempDir, 'components', 'TaskCard.tsx'),
    `import type { Task } from '../types/domain';\nimport { StatusBadge } from './StatusBadge';\nexport function TaskCard(_p: { task: Task }) { return <StatusBadge />; }\n`,
  );
  await fs.writeFile(
    path.join(tempDir, 'components', 'TaskList.tsx'),
    `import { TaskCard } from './TaskCard';\nexport function TaskList() { return <TaskCard task={{ id: '1', status: 'todo' }} />; }\n`,
  );
}

function step(id: string, description: string, expectedFiles?: string[]): PlanStep {
  return Object.freeze({
    id,
    description,
    objective: description,
    expectedOutcome: 'done',
    ...(expectedFiles ? { expectedFiles } : {}),
  }) as PlanStep;
}

function ledgerFor(paths: string[]): MutationLedger {
  return buildMutationLedger([{
    toolName: 'write_file',
    status: 'APPLIED',
    blockedBeforeWrite: false,
    findings: [],
    results: paths.map(p => ({
      path: p,
      operation: 'modify' as const,
      toolName: 'write_file',
      status: 'APPLIED' as const,
      beforeState: 'PRESENT' as const,
      afterState: 'PRESENT' as const,
      beforeHash: '0',
      afterHash: '1',
      changed: true,
      syntaxValid: true,
      expectedChangePresent: null,
      expectedMarkers: [],
      diffSummary: EMPTY_DIFF_SUMMARY,
      suspicious: false,
      rolledBack: false,
      rollbackVerified: null,
      decision: 'ALLOW' as const,
      findings: [],
    })),
  }]);
}

describe('Phase 3 PlanStep knowledge integration', () => {
  let tempDir: string;
  let indexer: DefaultStructuralGraphIndexer;
  let synchronizer: DefaultKnowledgeSynchronizer;
  let query: DefaultStructuralKnowledgeQuery;
  let bridge: PlanStepKnowledgeBridge;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-'));
    await seed(tempDir);
    const workspace = new LocalWorkspace(tempDir);
    const runtime = new LocalRuntimeRepository(tempDir);
    const analyzer = new StructuralAnalyzer();
    indexer = new DefaultStructuralGraphIndexer(workspace, runtime, tempDir, analyzer);
    synchronizer = new DefaultKnowledgeSynchronizer(workspace, runtime, tempDir, analyzer, indexer);
    query = new DefaultStructuralKnowledgeQuery(indexer);
    bridge = new PlanStepKnowledgeBridge(synchronizer, query);
    await indexer.indexAndPersist();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('T4/T5 query reads structural graph and is bounded', async () => {
    const graph = await indexer.load();
    expect(graph!.meta.fileCount).toBeGreaterThan(2);
    const result = await query.query({
      seeds: ['components/TaskCard.tsx'],
      includeImports: true,
      includeImporters: true,
      maxNodes: 8,
      maxFiles: 3,
    });
    expect(result.provenance.source).toBe('structural-graph');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.length).toBeLessThanOrEqual(8);
    expect(result.relatedFiles.length).toBeLessThanOrEqual(3);
    expect(result.relatedFiles.length).toBeLessThan(graph!.meta.fileCount);
    expect(result.relatedFiles).toContain('components/TaskCard.tsx');
    expect(result.promptSection).toContain('STRUCTURAL KNOWLEDGE');
  });

  it('T2/T3/T8/T9 Step1 mutation sync then Step2 query sees updated knowledge', async () => {
    const target = 'components/Phase3Target.tsx';
    const step1 = step('step-1', `Create ${target}`, [target]);
    const step2 = step('step-2', `Find importers of ${target}`, [target]);

    const before = await indexer.load();
    expect(before!.nodes.some(n => n.path === target)).toBe(false);

    // Step 1 mutation (filesystem truth)
    await fs.writeFile(
      path.join(tempDir, 'components', 'Phase3Target.tsx'),
      `export function Phase3Target() { return <div>p3</div>; }\n`,
    );
    // Make TaskCard import the new target (relationship Step2 must discover via graph)
    await fs.writeFile(
      path.join(tempDir, 'components', 'TaskCard.tsx'),
      `import type { Task } from '../types/domain';\nimport { Phase3Target } from './Phase3Target';\nexport function TaskCard(_p: { task: Task }) { return <Phase3Target />; }\n`,
    );

    const sync = await bridge.afterStepSync({
      sessionId: 's1',
      stepId: step1.id,
      ledger: ledgerFor([target, 'components/TaskCard.tsx']),
      outcome: 'success',
    });
    bridge.markCheckpoint('s1', step1.id);

    expect(sync!.ok).toBe(true);
    expect(sync!.fallbackUsed).toBe(false);
    expect(sync!.analyzedFileCount).toBe(2);

    const mid = await indexer.load();
    expect(mid!.nodes.some(n => n.path === target)).toBe(true);
    expect(mid!.edges.some(e =>
      e.kind === 'imports'
      && e.from === 'components/TaskCard.tsx'
      && e.to === target,
    )).toBe(true);

    // Step 2 query — must consume updated graph (causality)
    const q = await bridge.beforeStep({
      sessionId: 's1',
      step: step2,
      seedPaths: [target],
    });

    expect(q.query).not.toBeNull();
    expect(q.relatedFiles).toContain(target);
    expect(q.relatedFiles).toContain('components/TaskCard.tsx');
    expect(q.promptSection).toContain('Phase3Target');
    expect(q.promptSection).toContain('TaskCard.tsx');
    expect(q.query!.provenance.source).toBe('structural-graph');
    expect(q.query!.provenance.graphContentHash).toBe(mid!.meta.contentHash);

    // Ordering: sync before checkpoint
    const events = bridge.getEvents();
    const syncEvt = events.find(e => e.type === 'after_step_sync');
    const cpEvt = events.find(e => e.detail.marker === 'checkpoint');
    const queryEvt = events.find(e => e.type === 'before_step_query' && e.stepId === step2.id);
    expect(syncEvt).toBeDefined();
    expect(cpEvt).toBeDefined();
    expect(queryEvt).toBeDefined();
    expect(syncEvt!.sequence).toBeLessThan(cpEvt!.sequence);
    expect(cpEvt!.sequence).toBeLessThan(queryEvt!.sequence);
  });

  it('T12/T13 query source has no LLM/pipeline imports', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/structural-knowledge-query.ts'),
      'utf-8',
    );
    const imports = src.split(/\r?\n/).filter(l => /^\s*import\s/.test(l)).join('\n');
    expect(imports).not.toMatch(/KnowledgePipeline|ollama|TaskExecutor|TaskPlanner/i);
  });

  it('T6/T11 CODEBASE_MAP gathers bounded GRAPH_QUERY when structural graph present', async () => {
    const { freezeAiContextDiscovery } = await import('../../../src/domain/ai-context');
    const { freezeProjectProfile } = await import('../../../src/domain/project-profile');
    const { createDefaultSkillRegistry } = await import('../../../src/core/skill/default-skills');
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
    const aiContext = freezeAiContextDiscovery({ files: [], missingRequired: [], missingOptional: [] } as any);

    const builder = new PlannerContextStrategyBuilder();
    const strategy = builder.build({
      userTask: 'Update components/TaskCard.tsx importers',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      codebaseMapAvailable: true,
    });
    const mapSource = strategy.sources.find(s => s.type === 'CODEBASE_MAP');
    expect(mapSource?.status).toBe('SELECTED');

    const gatherer = new TargetedContextGatherer({
      cache: new InMemoryContextCache(),
      aiContextLoader: { load: async () => aiContext } as any,
      structuralQuery: query,
    });
    const gathered = await gatherer.gather({
      workspaceRoot: tempDir,
      userTask: 'Inspect components/TaskCard.tsx relationships',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      strategy,
      aiContext,
    });

    const record = gathered.records.find(r => r.source === 'CODEBASE_MAP' && r.status === 'COLLECTED');
    expect(record).toBeDefined();
    expect(record!.collectionMethod).toBe('GRAPH_QUERY');
    expect(record!.content).toContain('STRUCTURAL KNOWLEDGE');
    expect(record!.metadata?.graphNodesReturned).toBeGreaterThan(0);
    expect(record!.metadata?.graphNodesReturned).toBeLessThanOrEqual(12);
  });

  it('T10 query does not dump entire graph into prompt', async () => {
    const graph = await indexer.load();
    const result = await query.query({
      seeds: ['components/StatusBadge.tsx'],
      maxNodes: 5,
    });
    expect(result.provenance.nodesReturned).toBeLessThanOrEqual(5);
    expect(result.provenance.truncated).toBe(true);
    // Prompt should not list every graph node id
    const allIds = graph!.nodes.map(n => n.id);
    const listed = allIds.filter(id => result.promptSection.includes(id));
    expect(listed.length).toBeLessThan(allIds.length);
  });
});
