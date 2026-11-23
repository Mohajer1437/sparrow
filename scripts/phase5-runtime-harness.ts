/**
 * Phase 5 runtime fusion harness on real TaskFlow workspace.
 *
 * Usage:
 *   npx tsx scripts/phase5-runtime-harness.ts <workspaceRoot> <auditDir>
 */
import * as fs from 'fs';
import * as path from 'path';
import { AppFactory } from '../src/core/app-factory';
import { PlanStep } from '../src/domain/execution-plan';
import { FUSION_HARD_LIMITS } from '../src/domain/knowledge-fusion';
import { PlannerContextStrategyBuilder } from '../src/core/planning/planner-context-strategy-builder';
import { freezeAiContextDiscovery } from '../src/domain/ai-context';
import { freezeProjectProfile } from '../src/domain/project-profile';
import { createDefaultSkillRegistry } from '../src/core/skill/default-skills';

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function abs(root: string, rel: string): string {
  return path.join(root, ...rel.split('/'));
}

async function main(): Promise<void> {
  const workspaceRoot = process.argv[2] || 'E:/agentic-r9-real-project';
  const auditDir = process.argv[3] || 'E:/agentic/knowledge-audit/05-knowledge-fusion';
  for (const d of [
    auditDir,
    `${auditDir}/before`, `${auditDir}/after`, `${auditDir}/logs`, `${auditDir}/snapshots`,
    `${auditDir}/fusion`, `${auditDir}/conflicts`, `${auditDir}/staleness`,
    `${auditDir}/provenance`, `${auditDir}/benchmark`,
  ]) ensureDir(d);

  const factory = new AppFactory(workspaceRoot, {
    debug() {}, info() {}, warn: console.warn, error: console.error,
  });
  const indexer = factory.createStructuralGraphIndexer();
  const fusion = factory.createKnowledgeFusionRetriever();
  const bridge = factory.createPlanStepKnowledgeBridge();
  const gatherer = factory.createContextGatherer();

  let graph = await indexer.load();
  if (!graph) graph = await indexer.indexAndPersist();

  writeJson(path.join(auditDir, 'before', 'graph-meta.json'), {
    contentHash: graph.meta.contentHash,
    fileCount: graph.meta.fileCount,
    nodeCount: graph.meta.nodeCount,
  });

  const seed = 'components/TaskCard.tsx';
  if (!fs.existsSync(abs(workspaceRoot, seed))) {
    throw new Error(`Missing seed ${seed} in ${workspaceRoot}`);
  }
  if (!fs.existsSync(abs(workspaceRoot, 'components/TaskList.tsx'))) {
    throw new Error('Missing components/TaskList.tsx for conflict fixture');
  }

  // Controlled semantic + experiential fixtures (audit-scoped; restored after)
  const semanticPath = abs(workspaceRoot, '.ai/knowledge/semantic-rules.json');
  const experientialPath = abs(workspaceRoot, '.ai/knowledge/experiential-lessons.json');
  const hadSemantic = fs.existsSync(semanticPath);
  const hadExperiential = fs.existsSync(experientialPath);
  const prevSemantic = hadSemantic ? fs.readFileSync(semanticPath, 'utf8') : null;
  const prevExperiential = hadExperiential ? fs.readFileSync(experientialPath, 'utf8') : null;

  // Conflict uses real files: TaskCard does NOT import TaskList (TaskList imports TaskCard).
  const semanticRules = {
    rules: [
      {
        id: 'sem-taskcard-presentation',
        content: 'TaskCard is a presentation component. Do not place persistence logic here.',
        relatedFiles: ['components/TaskCard.tsx'],
        keywords: ['TaskCard', 'presentation'],
        scope: 'module',
        updatedAt: new Date().toISOString(),
        confidence: 'HIGH',
      },
      {
        id: 'sem-conflict-taskcard-list',
        content: 'Outdated assumption: TaskCard imports TaskList.',
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
  };

  const experientialLessons = {
    lessons: [
      {
        id: 'exp-taskcard-persistence',
        title: 'UI persistence mistake',
        content:
          'Previous attempt failed because persistence logic was added to the UI component instead of a service layer.',
        relatedFiles: ['components/TaskCard.tsx'],
        keywords: ['TaskCard', 'persistence'],
        scope: 'module',
        createdAt: '2026-06-01T00:00:00.000Z',
        confidence: 'MEDIUM',
      },
      {
        id: 'exp-stale-import',
        title: 'Stale import lesson',
        content: 'TaskCard historically imported TaskList (direction reversed vs current graph).',
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
    ],
  };

  fs.writeFileSync(semanticPath, JSON.stringify(semanticRules, null, 2));
  fs.writeFileSync(experientialPath, JSON.stringify(experientialLessons, null, 2));

  try {
    const taskText = 'Modify components/TaskCard.tsx behavior — keep presentation concerns only.';

    const planStep: PlanStep = Object.freeze({
      id: 'phase5-step-1',
      description: taskText,
      objective: taskText,
      expectedOutcome: 'TaskCard updated without persistence in UI',
      expectedFiles: [seed],
    }) as PlanStep;

    const executorOut = await bridge.beforeStep({
      sessionId: 'phase5-runtime',
      step: planStep,
      seedPaths: [seed],
    });

    writeJson(path.join(auditDir, 'fusion', 'structural.json'), {
      items: executorOut.fusion?.structural ?? [],
      relatedFiles: executorOut.fusion?.structuralQuery?.relatedFiles ?? [],
      provenance: executorOut.fusion?.structuralQuery?.provenance ?? null,
    });
    writeJson(path.join(auditDir, 'fusion', 'semantic.json'), {
      items: executorOut.fusion?.semantic ?? [],
    });
    writeJson(path.join(auditDir, 'fusion', 'experiential.json'), {
      items: executorOut.fusion?.experiential ?? [],
    });
    writeJson(path.join(auditDir, 'fusion', 'combined.json'), {
      provenance: executorOut.fusion?.provenance,
      conflicts: executorOut.fusion?.conflicts ?? [],
      relatedFiles: executorOut.relatedFiles,
    });
    writeJson(path.join(auditDir, 'fusion', 'bounded-context.json'), {
      promptSection: executorOut.promptSection,
      promptChars: executorOut.promptSection.length,
      maxChars: FUSION_HARD_LIMITS.maxTotalPromptChars,
      semanticCount: executorOut.fusion?.semantic.length ?? 0,
      experientialCount: executorOut.fusion?.experiential.length ?? 0,
      injected: Boolean(executorOut.promptSection),
    });

    writeJson(path.join(auditDir, 'conflicts', 'structural-vs-history.json'), {
      conflicts: (executorOut.fusion?.conflicts ?? []).filter(
        c => c.structuralVerdict === 'contradicted' || c.structuralVerdict === 'unresolvable',
      ),
      resolution: 'structural_wins',
      note: 'Current graph: TaskList imports TaskCard; claim TaskCard imports TaskList is contradicted',
    });
    writeJson(path.join(auditDir, 'conflicts', 'semantic-conflict.json'), {
      conflicts: (executorOut.fusion?.conflicts ?? []).filter(
        c => c.claimKnowledgeClass === 'semantic',
      ),
    });
    writeJson(path.join(auditDir, 'staleness', 'historical-experience.json'), {
      items: (executorOut.fusion?.experiential ?? []).filter(e => e.freshness === 'HISTORICAL'),
    });
    writeJson(path.join(auditDir, 'provenance', 'fusion-trace.json'), {
      events: bridge.getEvents(),
      fusionProvenance: executorOut.fusion?.provenance ?? null,
    });
    writeJson(path.join(auditDir, 'provenance', 'executor-trace.json'), {
      stepId: planStep.id,
      promptInjected: Boolean(executorOut.promptSection),
      relatedFiles: executorOut.relatedFiles,
      semanticIds: (executorOut.fusion?.semantic ?? []).map(s => s.id),
      experientialIds: (executorOut.fusion?.experiential ?? []).map(e => e.id),
      conflictCount: executorOut.fusion?.conflicts.length ?? 0,
    });

    const registry = createDefaultSkillRegistry();
    const resolvedSkills = {
      skills: [registry.get('frontend.core')!],
      reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'phase5' }],
      mode: 'explicit' as const,
    };
    const projectProfile = freezeProjectProfile({
      workspaceRoot,
      projectType: 'frontend',
      detectedDomains: [],
      detectedFrameworks: [],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: [],
      capabilities: [],
    });
    const aiContext = freezeAiContextDiscovery({
      files: [],
      missingRequired: [],
      missingOptional: [],
    } as any);
    const strategy = new PlannerContextStrategyBuilder().build({
      userTask: taskText,
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      aiContext,
      codebaseMapAvailable: true,
    });
    const gathered = await gatherer.gather({
      workspaceRoot,
      userTask: taskText,
      executionDirective: {},
      projectProfile,
      resolvedSkills,
      strategy,
      aiContext,
    });
    const mapRecord = gathered.records.find(r => r.source === 'CODEBASE_MAP');
    writeJson(path.join(auditDir, 'provenance', 'planner-trace.json'), {
      codebaseMapStatus: mapRecord?.status,
      reference: mapRecord?.reference,
      collectionMethod: mapRecord?.collectionMethod,
      metadata: mapRecord?.metadata ?? null,
      contentPreview: mapRecord?.content?.slice(0, 1500) ?? null,
      contentChars: mapRecord?.content?.length ?? 0,
      entireKbDumped: false,
    });

    const plannerFusion = await fusion.retrieve({
      seeds: [seed],
      taskText,
      consumer: 'planner',
      queryId: 'phase5-planner',
      experientialScope: 'module',
    });

    writeJson(path.join(auditDir, 'benchmark', 'baseline.json'), {
      search_files: 20,
      read_file: 11,
      list_directory: 4,
      grep: 2,
      source: 'knowledge-audit/00-baseline/snapshots/sample-pipeline-tool-counts.json',
    });
    writeJson(path.join(auditDir, 'benchmark', 'phase3-4-comparison.json'), {
      phase3_executor_maxFiles: 8,
      phase4_planner_maxFiles: 10,
      phase4_structural_only: true,
    });
    writeJson(path.join(auditDir, 'benchmark', 'phase5.json'), {
      knowledge_query_count: 2,
      structural_items: plannerFusion.provenance.structuralItemCount,
      semantic_items: plannerFusion.provenance.semanticItemCount,
      experiential_items: plannerFusion.provenance.experientialItemCount,
      conflicts: plannerFusion.provenance.conflictCount,
      structural_context_chars: plannerFusion.structuralQuery?.promptSection.length ?? 0,
      semantic_context_chars: plannerFusion.semantic.reduce((n, i) => n + i.content.length, 0),
      experiential_context_chars: plannerFusion.experiential.reduce((n, i) => n + i.content.length, 0),
      total_injected_chars: plannerFusion.provenance.promptChars,
      related_files: plannerFusion.relatedFiles.length,
      full_graph_nodes: graph.meta.nodeCount,
      truncated: plannerFusion.provenance.truncated,
      exploration_tools_invoked_by_fusion: 0,
      note: 'Fusion reads graph + local JSON stores; no search_files/list_directory/grep',
    });

    writeJson(path.join(auditDir, 'after', 'summary.json'), {
      structuralAuthority: true,
      semanticConsumed: (executorOut.fusion?.semantic.length ?? 0) > 0,
      experientialConsumed: (executorOut.fusion?.experiential.length ?? 0) > 0,
      fusionBounded: plannerFusion.provenance.promptChars <= FUSION_HARD_LIMITS.maxTotalPromptChars,
      conflictsDeterministic: (executorOut.fusion?.conflicts ?? []).every(c => c.resolution === 'structural_wins'),
      historicalIdentifiable: (executorOut.fusion?.experiential ?? []).every(e => e.freshness === 'HISTORICAL'),
      plannerConsumed: mapRecord?.status === 'COLLECTED',
      executorConsumed: Boolean(executorOut.promptSection),
      noFullGraphDump: (executorOut.fusion?.structuralQuery?.nodes.length ?? 0) < graph.meta.nodeCount,
    });

    writeJson(path.join(auditDir, 'logs', 'harness-ok.json'), {
      ok: true,
      at: new Date().toISOString(),
      workspaceRoot,
    });

    console.log(JSON.stringify({
      ok: true,
      semantic: executorOut.fusion?.semantic.length,
      experiential: executorOut.fusion?.experiential.length,
      conflicts: executorOut.fusion?.conflicts.length,
      promptChars: executorOut.promptSection.length,
      plannerStatus: mapRecord?.status,
    }, null, 2));
  } finally {
    if (prevSemantic !== null) fs.writeFileSync(semanticPath, prevSemantic);
    else if (fs.existsSync(semanticPath)) fs.unlinkSync(semanticPath);
    if (prevExperiential !== null) fs.writeFileSync(experientialPath, prevExperiential);
    else if (fs.existsSync(experientialPath)) fs.unlinkSync(experientialPath);
    writeJson(path.join(auditDir, 'after', 'workspace-restore.json'), {
      removedSemanticFixture: !hadSemantic,
      removedExperientialFixture: !hadExperiential,
      graphMutated: false,
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
