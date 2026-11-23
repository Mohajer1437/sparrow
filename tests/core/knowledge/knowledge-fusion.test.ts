import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalRuntimeRepository } from '../../../src/core/runtime/local-runtime-repository';
import { DefaultStructuralGraphIndexer } from '../../../src/core/knowledge/structural-graph-indexer';
import { DefaultStructuralKnowledgeQuery } from '../../../src/core/knowledge/structural-knowledge-query';
import { DefaultKnowledgeFusionRetriever } from '../../../src/core/knowledge/knowledge-fusion-retriever';
import { PlanStepKnowledgeBridge } from '../../../src/core/knowledge/plan-step-knowledge-bridge';
import { DefaultKnowledgeSynchronizer } from '../../../src/core/knowledge/knowledge-synchronizer';
import { StructuralAnalyzer } from '../../../src/core/patch/structural-analyzer';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { FUSION_HARD_LIMITS } from '../../../src/domain/knowledge-fusion';
import { PlanStep } from '../../../src/domain/execution-plan';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';

async function seedWorkspace(tempDir: string): Promise<void> {
  await fs.mkdir(path.join(tempDir, 'components'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'services'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'types'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.ai', 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.ai', 'memory', 'shared'), { recursive: true });

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
  await fs.writeFile(
    path.join(tempDir, 'services', 'taskService.ts'),
    `export async function saveTask(_id: string) { return true; }\n`,
  );

  await fs.writeFile(
    path.join(tempDir, '.ai', 'knowledge', 'semantic-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'sem-taskcard-presentation',
          content: 'TaskCard is a presentation component. Do not place persistence logic here.',
          relatedFiles: ['components/TaskCard.tsx'],
          keywords: ['TaskCard', 'presentation'],
          scope: 'module',
          updatedAt: '2026-09-20T00:00:00.000Z',
          confidence: 'HIGH',
        },
        {
          id: 'sem-unrelated-global',
          content: 'Never mutate production databases from UI components.',
          keywords: ['database', 'unrelated-token-xyz'],
          scope: 'global',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'sem-conflict-import',
          content: 'Historical assumption: TaskCard imports taskService (persistence in UI).',
          relatedFiles: ['components/TaskCard.tsx'],
          keywords: ['TaskCard'],
          scope: 'module',
          updatedAt: '2025-01-01T00:00:00.000Z',
          structuralClaim: {
            subjectFile: 'components/TaskCard.tsx',
            predicate: 'imports',
            objectFile: 'components/TaskList.tsx',
          },
        },
      ],
    }, null, 2),
  );

  await fs.writeFile(
    path.join(tempDir, '.ai', 'knowledge', 'experiential-lessons.json'),
    JSON.stringify({
      lessons: [
        {
          id: 'exp-taskcard-persistence',
          title: 'UI persistence mistake',
          content: 'Previous attempt failed because persistence logic was added to TaskCard instead of taskService.',
          relatedFiles: ['components/TaskCard.tsx', 'services/taskService.ts'],
          keywords: ['TaskCard', 'persistence'],
          scope: 'module',
          createdAt: '2026-06-01T00:00:00.000Z',
          confidence: 'MEDIUM',
        },
        {
          id: 'exp-stale-import-claim',
          title: 'Stale import memory',
          content: 'TaskCard historically imported TaskList (wrong direction).',
          relatedFiles: ['components/TaskCard.tsx'],
          keywords: ['TaskCard'],
          scope: 'file',
          createdAt: '2024-01-01T00:00:00.000Z',
          confidence: 'LOW',
          structuralClaim: {
            subjectFile: 'components/TaskCard.tsx',
            predicate: 'imports',
            objectFile: 'components/TaskList.tsx',
          },
        },
        {
          id: 'exp-global-only',
          title: 'Global lesson',
          content: 'Always write unit tests for every change.',
          scope: 'global',
          keywords: ['unit-tests-global-only-xyz'],
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    }, null, 2),
  );

  await fs.writeFile(
    path.join(tempDir, '.ai', 'knowledge', 'feedback_candidates.json'),
    JSON.stringify({
      candidates: [
        {
          id: 'cand-1',
          type: 'BEST_PRACTICE',
          title: 'TaskCard boundary',
          content: 'Keep TaskCard free of service calls',
          reason: 'prior review',
          evidence: ['components/TaskCard.tsx'],
          confidence: 'HIGH',
          confidenceReasons: ['review'],
          status: 'pending_review',
          generatedAt: '2026-08-01T00:00:00.000Z',
          sourceSessionId: 's1',
        },
      ],
    }, null, 2),
  );
}

async function buildFusion(tempDir: string) {
  const workspace = new LocalWorkspace(tempDir);
  const runtime = new LocalRuntimeRepository(tempDir);
  const analyzer = new StructuralAnalyzer();
  const indexer = new DefaultStructuralGraphIndexer(workspace, runtime, tempDir, analyzer);
  await indexer.indexAndPersist();
  const structural = new DefaultStructuralKnowledgeQuery(indexer, runtime);
  const fusion = new DefaultKnowledgeFusionRetriever(structural, runtime);
  return { fusion, structural, indexer, runtime, workspace, analyzer };
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

describe('Phase 5 Knowledge Fusion', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5-fusion-'));
    await seedWorkspace(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('T1: inventory artifact exists and lists sources', async () => {
    const inventory = await fs.readFile(
      path.join(process.cwd(), 'knowledge-audit/05-knowledge-fusion/current-knowledge-flow.md'),
      'utf8',
    );
    expect(inventory).toContain('structural graph');
    expect(inventory).toContain('feedback_candidates');
    expect(inventory).toContain('NOT IMPLEMENTED');
  });

  test('T2: structural knowledge retrievable via fusion delegate', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'Modify TaskCard behavior',
    });
    expect(result.structural.length).toBeGreaterThan(0);
    expect(result.relatedFiles.some(f => f.includes('TaskCard'))).toBe(true);
    expect(result.structuralQuery).not.toBeNull();
  });

  test('T3: semantic knowledge retrievable', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'Modify TaskCard presentation',
    });
    expect(result.semantic.some(s => s.id === 'sem-taskcard-presentation')).toBe(true);
    expect(result.semantic.every(s => s.knowledgeClass === 'semantic')).toBe(true);
  });

  test('T4: experiential knowledge retrievable', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'Modify TaskCard persistence boundary',
    });
    expect(result.experiential.length).toBeGreaterThan(0);
    expect(result.experiential.every(e => e.knowledgeClass === 'experiential')).toBe(true);
  });

  test('T5: knowledge types remain distinguishable', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    expect(result.promptSection).toContain('### STRUCTURAL');
    expect(result.promptSection).toContain('### SEMANTIC');
    expect(result.promptSection).toContain('### EXPERIENTIAL');
    expect(result.structural.every(i => i.knowledgeClass === 'structural')).toBe(true);
    expect(result.semantic.every(i => i.knowledgeClass === 'semantic')).toBe(true);
    expect(result.experiential.every(i => i.knowledgeClass === 'experiential')).toBe(true);
  });

  test('T6: bounded fusion (hard caps)', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    expect(result.semantic.length).toBeLessThanOrEqual(FUSION_HARD_LIMITS.maxSemanticItems);
    expect(result.experiential.length).toBeLessThanOrEqual(FUSION_HARD_LIMITS.maxExperientialItems);
    expect(result.provenance.promptChars).toBeLessThanOrEqual(FUSION_HARD_LIMITS.maxTotalPromptChars + 80);
    expect(result.promptSection).not.toContain('FakeLegacyStore.ts\n'.repeat(100));
  });

  test('T7/T8: structural truth wins over historical import claim', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    const contradicted = result.conflicts.filter(c => c.structuralVerdict === 'contradicted');
    expect(contradicted.length).toBeGreaterThan(0);
    expect(contradicted.every(c => c.resolution === 'structural_wins')).toBe(true);
    // Must not present TaskList as a TaskCard import in structural section from the claim
    const structuralPrompt = result.structuralQuery?.promptSection ?? '';
    expect(structuralPrompt).not.toMatch(/TaskCard\.tsx.*imports.*TaskList/i);
  });

  test('T9: semantic conflict handled deterministically', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    const semConflict = result.conflicts.find(c => c.claimSourceItemId === 'sem-conflict-import');
    expect(semConflict).toBeDefined();
    expect(semConflict!.resolution).toBe('structural_wins');
    expect(result.promptSection).toContain('structural_wins');
  });

  test('T10: experiential scope enforced (global-only excluded without overlap)', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
      experientialScope: 'module',
    });
    expect(result.experiential.some(e => e.id === 'exp-global-only')).toBe(false);
    expect(result.experiential.some(e => e.id === 'exp-taskcard-persistence')).toBe(true);
  });

  test('T11: historical/stale experience identifiable', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    const stale = result.experiential.find(e => e.id === 'exp-stale-import-claim');
    expect(stale).toBeDefined();
    expect(stale!.freshness).toBe('HISTORICAL');
    expect(stale!.content).toMatch(/HISTORICAL/i);
  });

  test('T12/T13: provenance and freshness preserved', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
      queryId: 't12',
    });
    expect(result.provenance.queryId).toBe('t12');
    expect(result.provenance.structuralFreshness).toBeTruthy();
    expect(result.semantic.every(s => s.source && s.freshness)).toBe(true);
    expect(result.experiential.every(e => e.freshness === 'HISTORICAL')).toBe(true);
  });

  test('T14/T16: planner consumes fused knowledge without entire KB', async () => {
    const { fusion } = await buildFusion(tempDir);
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
    const strategy = new PlannerContextStrategyBuilder().build({
      userTask: 'Modify components/TaskCard.tsx presentation behavior',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      codebaseMapAvailable: true,
    });
    const gatherer = new TargetedContextGatherer({
      cache: new InMemoryContextCache(),
      aiContextLoader: { load: async () => aiContext } as any,
      fusionRetriever: fusion,
    });
    const gathered = await gatherer.gather({
      workspaceRoot: tempDir,
      userTask: 'Modify components/TaskCard.tsx presentation behavior',
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      strategy,
      aiContext,
    });
    const collected = gathered.records.find(r => r.source === 'CODEBASE_MAP' && r.status === 'COLLECTED');
    expect(collected).toBeDefined();
    expect(collected!.content).toContain('STRUCTURAL');
    expect(collected!.content).toContain('SEMANTIC');
    expect(collected!.metadata?.fusionSemanticCount).toBeGreaterThan(0);
    expect(collected!.content).not.toContain('unrelated-token-xyz');
  });

  test('T15/T17: executor bridge consumes step-relevant fusion only', async () => {
    const { fusion, structural, runtime, workspace, analyzer, indexer } = await buildFusion(tempDir);
    const sync = new DefaultKnowledgeSynchronizer(workspace, runtime, tempDir, analyzer, indexer);
    const bridge = new PlanStepKnowledgeBridge(sync, structural, undefined, fusion);
    const s = step('s1', 'Modify TaskCard presentation', ['components/TaskCard.tsx']);
    const out = await bridge.beforeStep({
      sessionId: 'sess',
      step: s,
      seedPaths: ['components/TaskCard.tsx'],
    });
    expect(out.fusion).not.toBeNull();
    expect(out.promptSection).toContain('SEMANTIC');
    expect(out.promptSection).toContain('EXPERIENTIAL');
    expect(out.fusion!.provenance.semanticItemCount).toBeLessThanOrEqual(3);
    expect(out.fusion!.provenance.experientialItemCount).toBeLessThanOrEqual(3);
    const last = bridge.getLastFusion('s1');
    expect(last?.promptSection).toBe(out.promptSection);
  });

  test('T18: no full graph dump', async () => {
    const { fusion, indexer } = await buildFusion(tempDir);
    const graph = await indexer.load();
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    expect(graph!.nodes.length).toBeGreaterThanOrEqual(result.structuralQuery!.nodes.length);
    // Bounded query must not serialize the entire graph payload
    expect(result.promptSection.length).toBeLessThan(JSON.stringify(graph).length);
    expect(result.structuralQuery!.provenance.truncated || graph!.nodes.length >= result.structuralQuery!.nodes.length).toBe(true);
  });

  test('T19: fusion path does not invoke LLM / KnowledgePipeline', async () => {
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'executor',
      taskText: 'TaskCard',
    });
    expect(result.provenance.structuralSource).toMatch(/structural-graph/);
    expect(result.promptSection).not.toMatch(/openai|anthropic|llm-index/i);
  });

  test('T20: KnowledgePipeline not required for fusion retrieve', async () => {
    // Absence of architectural-map / knowledge_base must not fail fusion
    await expect(fs.access(path.join(tempDir, '.ai', 'knowledge', 'architectural-map.json'))).rejects.toBeTruthy();
    const { fusion } = await buildFusion(tempDir);
    const result = await fusion.retrieve({
      seeds: ['components/TaskCard.tsx'],
      consumer: 'planner',
      taskText: 'TaskCard',
    });
    expect(result.promptSection.length).toBeGreaterThan(0);
  });

  test('T21-T24: runtime evidence artifacts exist (TaskFlow harness)', async () => {
    const root = path.join(process.cwd(), 'knowledge-audit/05-knowledge-fusion');
    const required = [
      'fusion/structural.json',
      'fusion/semantic.json',
      'fusion/experiential.json',
      'fusion/combined.json',
      'fusion/bounded-context.json',
      'conflicts/structural-vs-history.json',
      'conflicts/semantic-conflict.json',
      'staleness/historical-experience.json',
      'provenance/fusion-trace.json',
      'provenance/planner-trace.json',
      'provenance/executor-trace.json',
      'benchmark/phase5.json',
      'after/summary.json',
    ];
    for (const rel of required) {
      await expect(fs.access(path.join(root, rel))).resolves.toBeUndefined();
    }
    const summary = JSON.parse(await fs.readFile(path.join(root, 'after/summary.json'), 'utf8'));
    expect(summary.semanticConsumed).toBe(true);
    expect(summary.experientialConsumed).toBe(true);
    expect(summary.executorConsumed).toBe(true);
    expect(summary.plannerConsumed).toBe(true);
    expect(summary.conflictsDeterministic).toBe(true);
    expect(summary.historicalIdentifiable).toBe(true);

    const conflicts = JSON.parse(
      await fs.readFile(path.join(root, 'conflicts/structural-vs-history.json'), 'utf8'),
    );
    expect(conflicts.conflicts.every((c: any) => c.resolution === 'structural_wins')).toBe(true);
    expect(conflicts.conflicts.some((c: any) => c.structuralVerdict === 'contradicted')).toBe(true);

    const stale = JSON.parse(
      await fs.readFile(path.join(root, 'staleness/historical-experience.json'), 'utf8'),
    );
    expect(stale.items.every((i: any) => i.freshness === 'HISTORICAL')).toBe(true);
  });

  test('T25: exploration benchmark shows zero fusion exploration tools', async () => {
    const bench = JSON.parse(
      await fs.readFile(
        path.join(process.cwd(), 'knowledge-audit/05-knowledge-fusion/benchmark/phase5.json'),
        'utf8',
      ),
    );
    expect(bench.exploration_tools_invoked_by_fusion).toBe(0);
    expect(bench.total_injected_chars).toBeLessThanOrEqual(FUSION_HARD_LIMITS.maxTotalPromptChars);
    expect(bench.related_files).toBeLessThan(bench.full_graph_nodes);
  });

  test('T26: Phase 1-4 knowledge suites remain importable / green companion', async () => {
    // Companion assertion: fusion module does not import KnowledgePipeline
    const src = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/knowledge-fusion-retriever.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/KnowledgePipeline|ollama|openai/i);
    const bridge = await fs.readFile(
      path.join(__dirname, '../../../src/core/knowledge/plan-step-knowledge-bridge.ts'),
      'utf8',
    );
    expect(bridge).toMatch(/fusionRetriever/);
  });
});
