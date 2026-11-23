/**
 * Phase 6 provider diagnostic — ONE Task A run only (no OFF/ON A/B).
 * Reuses the same AppFactory → TaskExecutionService → PlanStep path as the
 * effectiveness harness. Does not change application/Knowledge/retry behavior.
 *
 * Usage:
 *   npx tsx scripts/phase6-provider-diagnostic.ts \
 *     --workspace E:\agentic-r9-real-project \
 *     --auditDir E:\agentic\knowledge-audit\06-effectiveness\diagnostic \
 *     --mode off
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { AppFactory } from '../src/core/app-factory';
import { ExecutionLogger } from '../src/core/observability/execution-logger';
import {
  assertOneLineTask,
  PHASE6_TASK_A,
  KnowledgeConsumptionMode,
} from '../src/core/benchmark/phase6-effectiveness';

const KNOWLEDGE_GRAPH = 'knowledge/structural-graph.json';
const KNOWLEDGE_SYNC = 'knowledge/structural-sync-state.json';

function parseArgs(argv: string[]): {
  workspace: string;
  auditDir: string;
  mode: KnowledgeConsumptionMode;
} {
  let workspace = 'E:/agentic-r9-real-project';
  let auditDir = 'E:/agentic/knowledge-audit/06-effectiveness/diagnostic';
  let mode: KnowledgeConsumptionMode = 'off';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--workspace' && next) { workspace = next; i++; }
    else if (a === '--auditDir' && next) { auditDir = next; i++; }
    else if (a === '--mode' && next) {
      if (next !== 'on' && next !== 'off') throw new Error(`invalid --mode ${next}`);
      mode = next;
      i++;
    }
  }
  return { workspace, auditDir, mode };
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

function currentHead(cwd: string): string | null {
  try { return git(cwd, ['rev-parse', 'HEAD']); } catch { return null; }
}

function gitStatusPorcelain(cwd: string): string {
  try { return git(cwd, ['status', '--porcelain']); } catch { return ''; }
}

function aiPath(workspace: string, rel: string): string {
  return path.join(workspace, '.ai', ...rel.split('/'));
}

function fileSha256(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function restoreWorkspaceFiles(cwd: string, baselineHead: string | null): void {
  git(cwd, ['checkout', '--', '.']);
  spawnSync('git', ['clean', '-fd', '--', ':!node_modules', ':!.next', ':!.ai'], {
    cwd, encoding: 'utf8',
  });
  if (baselineHead && currentHead(cwd) !== baselineHead) {
    git(cwd, ['reset', '--soft', baselineHead]);
    git(cwd, ['checkout', '--', '.']);
    spawnSync('git', ['clean', '-fd', '--', ':!node_modules', ':!.next', ':!.ai'], {
      cwd, encoding: 'utf8',
    });
  }
}

function snapshotKnowledge(workspace: string, destDir: string): void {
  ensureDir(destDir);
  for (const rel of [KNOWLEDGE_GRAPH, KNOWLEDGE_SYNC]) {
    const src = aiPath(workspace, rel);
    const dest = path.join(destDir, path.basename(rel));
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }
}

function restoreKnowledge(workspace: string, snapshotDir: string): void {
  ensureDir(path.dirname(aiPath(workspace, KNOWLEDGE_GRAPH)));
  for (const rel of [KNOWLEDGE_GRAPH, KNOWLEDGE_SYNC]) {
    const snap = path.join(snapshotDir, path.basename(rel));
    const dest = aiPath(workspace, rel);
    if (fs.existsSync(snap)) {
      fs.copyFileSync(snap, dest);
    } else if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }
}

function findNewestLog(workspace: string, afterMs: number, sessionId: string): string | null {
  const active = ExecutionLogger.getLogFile();
  if (active && fs.existsSync(active)) return active;
  const logDir = path.join(workspace, '.ai', 'logs', 'pipeline');
  if (!fs.existsSync(logDir)) return null;
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.log'))
    .filter(f => f.includes(sessionId))
    .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs }))
    .filter(x => x.t >= afterMs - 5000)
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(logDir, files[0].f) : null;
}

function extractProviderMeta(logText: string): Array<Record<string, unknown>> {
  return logText
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
    })
    .filter((e): e is Record<string, unknown> => !!e && e.phase === 'PROVIDER_META');
}

async function main(): Promise<void> {
  const { workspace, auditDir, mode } = parseArgs(process.argv.slice(2));
  const task = PHASE6_TASK_A;
  assertOneLineTask(task);

  const sessionId = `phase6-A-diag-${mode}`;
  const knowledgeSnap = path.join(auditDir, 'knowledge-snapshot');
  ensureDir(auditDir);

  const baselineHead = currentHead(workspace);
  const baselineStatus = gitStatusPorcelain(workspace);
  const graphPath = aiPath(workspace, KNOWLEDGE_GRAPH);
  const syncPath = aiPath(workspace, KNOWLEDGE_SYNC);
  const startedAt = new Date().toISOString();

  const preflight = {
    startedAtUtc: startedAt,
    workspace,
    baselineHead,
    statusPorcelain: baselineStatus,
    structuralGraphSha256: fileSha256(graphPath),
    structuralSyncSha256: fileSha256(syncPath),
    models: {
      planner: 'gpt-oss:120b-cloud',
      coder: 'gpt-oss:20b-cloud',
      reviewer: 'gpt-oss:120b-cloud',
    },
    knowledgeMode: mode,
    task,
    sessionId,
  };
  writeJson(path.join(auditDir, 'preflight.json'), preflight);
  snapshotKnowledge(workspace, knowledgeSnap);

  console.log(`[diag] ONE Task A run mode=${mode} session=${sessionId}`);
  console.log(`[diag] startedAtUtc=${startedAt} head=${baselineHead}`);

  ExecutionLogger.init(workspace, sessionId);
  const logger = {
    debug() {},
    info: (m: string) => console.log(`[diag] ${m}`),
    warn: (m: string) => console.warn(`[diag] ${m}`),
    error: (m: string) => console.error(`[diag] ${m}`),
  };

  const factory = new AppFactory(workspace, logger, undefined, mode);
  if (factory.getKnowledgeConsumption() !== mode) {
    throw new Error(`knowledgeConsumption mismatch: expected ${mode}`);
  }
  const engine = factory.createStepExecutionEngine(workspace);
  const bridge = engine.getKnowledgeBridge();
  if (mode === 'off' && bridge) throw new Error('OFF still wired knowledgeBridge');
  if (mode === 'on' && !bridge) throw new Error('ON missing knowledgeBridge');

  const discovered = await factory.discoverOllamaModels();
  if (discovered <= 0) throw new Error('provider unavailable: no Ollama models');

  const startedMs = Date.now();
  let outcome: any = null;
  let error: string | null = null;
  try {
    const service = factory.createTaskExecutionService();
    outcome = await service.execute({
      roleId: 'coder',
      task,
      sessionId,
      executionMode: 'STANDARD',
      onConfirmationRequested: async () => true,
    });
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const endedAt = new Date().toISOString();
  const logFile = findNewestLog(workspace, startedMs, sessionId);
  let logText = '';
  if (logFile && fs.existsSync(logFile)) {
    logText = fs.readFileSync(logFile, 'utf8');
    fs.copyFileSync(logFile, path.join(auditDir, 'pipeline.log'));
  }

  const providerMeta = extractProviderMeta(logText);
  writeJson(path.join(auditDir, 'provider-meta.json'), {
    startedAtUtc: startedAt,
    endedAtUtc: endedAt,
    taskId: outcome?.taskId ?? null,
    runId: outcome?.runId ?? null,
    sessionId,
    success: outcome?.result?.success === true,
    error: error ?? outcome?.result?.error ?? null,
    planStepCount: outcome?.result?.workflowResult?.plan?.steps?.length ?? null,
    abortedAt: outcome?.result?.workflowResult?.abortedAt ?? null,
    logFile: logFile ? path.relative(workspace, logFile).replace(/\\/g, '/') : null,
    events: providerMeta,
  });

  writeJson(path.join(auditDir, 'run.json'), {
    knowledgeMode: mode,
    startedAtUtc: startedAt,
    endedAtUtc: endedAt,
    taskId: outcome?.taskId ?? null,
    runId: outcome?.runId ?? null,
    sessionId,
    success: outcome?.result?.success === true,
    error: error ?? outcome?.result?.error ?? null,
    planStepCount: outcome?.result?.workflowResult?.plan?.steps?.length ?? null,
    usedPlanStepPath: typeof (outcome?.result?.workflowResult?.plan?.steps?.length) === 'number'
      && outcome.result.workflowResult.plan.steps.length > 0,
    providerMetaCount: providerMeta.length,
  });

  console.log(`[diag] Restoring workspace…`);
  restoreWorkspaceFiles(workspace, baselineHead);
  restoreKnowledge(workspace, knowledgeSnap);

  const taskCard = path.join(workspace, 'components', 'TaskCard.tsx');
  const k6aPresent = fs.existsSync(taskCard)
    && fs.readFileSync(taskCard, 'utf8').includes('K6A');
  const afterStatus = gitStatusPorcelain(workspace);
  const restoration = {
    ok: !k6aPresent && afterStatus === baselineStatus,
    k6aPresent,
    afterHead: currentHead(workspace),
    afterStatusPorcelain: afterStatus,
    structuralGraphSha256: fileSha256(graphPath),
    structuralSyncSha256: fileSha256(syncPath),
  };
  writeJson(path.join(auditDir, 'restoration.json'), restoration);

  console.log(JSON.stringify({
    taskId: outcome?.taskId ?? null,
    runId: outcome?.runId ?? null,
    success: outcome?.result?.success === true,
    error: error ?? outcome?.result?.error ?? null,
    providerMetaCount: providerMeta.length,
    restorationOk: restoration.ok,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
