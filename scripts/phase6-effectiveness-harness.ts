/**
 * Phase 6 Milestone 1 — Knowledge effectiveness A/B harness (Task A only).
 *
 * Programmatic TaskExecutionService only (no interactive readline).
 *
 * Usage:
 *   npx tsx scripts/phase6-effectiveness-harness.ts \
 *     --workspace E:\agentic-r9-real-project \
 *     --auditDir E:\agentic\knowledge-audit\06-effectiveness \
 *     --taskId A
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AppFactory } from '../src/core/app-factory';
import { ExecutionLogger } from '../src/core/observability/execution-logger';
import {
  assertOneLineTask,
  PHASE6_TASKS,
  KnowledgeConsumptionMode,
} from '../src/core/benchmark/phase6-effectiveness';

type RunStatus =
  | 'VALID'
  | 'INVALID_INPUT'
  | 'INVALID_PLAN_PATH'
  | 'INVALID_KNOWLEDGE_EVIDENCE'
  | 'INVALID_INFRASTRUCTURE'
  | 'EXECUTION_FAILED';

const EXPLORATION_TOOLS = new Set(['search_files', 'list_directory', 'grep', 'read_file']);
const MUTATION_TOOLS = new Set([
  'apply_patch', 'write_file', 'create_file', 'delete_file', 'rename_file', 'str_replace',
]);

const KNOWLEDGE_GRAPH = 'knowledge/structural-graph.json';
const KNOWLEDGE_SYNC = 'knowledge/structural-sync-state.json';

interface ToolMetrics {
  search_files: number;
  list_directory: number;
  grep: number;
  read_file: number;
  totalToolCalls: number;
  explorationToolCalls: number;
  mutationOperations: number;
  uniqueFilesRead: string[];
  repeatedFileReads: number;
  readFilePaths: string[];
}

interface RunEvidence {
  knowledgeMode: KnowledgeConsumptionMode;
  knowledgeInjection: 'disabled' | 'proven' | 'unproven';
  status: RunStatus;
  success: boolean | null;
  error: string | null;
  planStepCount: number | null;
  usedPlanStepPath: boolean;
  usedSparrowFallback: boolean;
  verificationStatus: string | null;
  repairAttempts: number | null;
  logFile: string | null;
  metrics: ToolMetrics;
  knowledge: Record<string, unknown>;
  taskId: string | null;
  runId: string | null;
  sessionId: string | null;
}

function parseArgs(argv: string[]): { workspace: string; auditDir: string; taskId: string } {
  let workspace = 'E:/agentic-r9-real-project';
  let auditDir = 'E:/agentic/knowledge-audit/06-effectiveness';
  let taskId = 'A';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--workspace' && next) { workspace = next; i++; }
    else if (a === '--auditDir' && next) { auditDir = next; i++; }
    else if (a === '--taskId' && next) { taskId = next; i++; }
  }
  return { workspace, auditDir, taskId };
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

/** R9-style restore kept inside the harness (does not modify production R9). */
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

function aiPath(workspace: string, rel: string): string {
  return path.join(workspace, '.ai', ...rel.split('/'));
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
      // Baseline had no file — remove if created during the run
      fs.unlinkSync(dest);
    }
  }
}

function emptyMetrics(): ToolMetrics {
  return {
    search_files: 0,
    list_directory: 0,
    grep: 0,
    read_file: 0,
    totalToolCalls: 0,
    explorationToolCalls: 0,
    mutationOperations: 0,
    uniqueFilesRead: [],
    repeatedFileReads: 0,
    readFilePaths: [],
  };
}

function parseToolMetrics(logText: string): ToolMetrics {
  const metrics = emptyMetrics();
  const readCounts = new Map<string, number>();
  const toolRe = /Executing tool:\s*([a-zA-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = toolRe.exec(logText)) !== null) {
    const name = m[1];
    metrics.totalToolCalls += 1;
    if (name === 'search_files') metrics.search_files += 1;
    if (name === 'list_directory') metrics.list_directory += 1;
    if (name === 'grep') metrics.grep += 1;
    if (name === 'read_file') metrics.read_file += 1;
    if (EXPLORATION_TOOLS.has(name)) metrics.explorationToolCalls += 1;
    if (MUTATION_TOOLS.has(name)) metrics.mutationOperations += 1;
  }

  // Best-effort path extraction near read_file executions
  const readBlocks = logText.split(/Executing tool:\s*read_file/);
  for (let i = 1; i < readBlocks.length; i++) {
    const chunk = readBlocks[i].slice(0, 400);
    const pathMatch = chunk.match(/"path"\s*:\s*"([^"]+)"/)
      || chunk.match(/path['"]?\s*[:=]\s*['"]([^'"]+)/i);
    if (pathMatch) {
      const p = pathMatch[1].replace(/\\/g, '/');
      metrics.readFilePaths.push(p);
      readCounts.set(p, (readCounts.get(p) ?? 0) + 1);
    }
  }
  metrics.uniqueFilesRead = [...readCounts.keys()].sort();
  metrics.repeatedFileReads = [...readCounts.values()].filter(c => c > 1).reduce((a, b) => a + (b - 1), 0);
  return metrics;
}

function detectKnowledgeInjection(logText: string): boolean {
  return /Phase5:\s*injected bounded fused knowledge/i.test(logText)
    || /Phase3:\s*injected bounded structural/i.test(logText)
    || /\[KNOWLEDGE\].*injected/i.test(logText)
    || /before_step_query/i.test(logText);
}

function detectSparrowFallback(logText: string, abortAt: string | null | undefined): boolean {
  if (abortAt === 'sparrow-execution' || abortAt === 'agentic-execution') return true;
  return /Sparrow execution via TaskExecutor \(fallback\)/i.test(logText)
    || /Agentic execution via TaskExecutor \(fallback\)/i.test(logText);
}

function findNewestLog(workspace: string, afterMs: number, sessionId?: string): string | null {
  // Prefer the active logger file when available
  const active = ExecutionLogger.getLogFile();
  if (active && fs.existsSync(active)) return active;

  const logDir = path.join(workspace, '.ai', 'logs', 'pipeline');
  if (!fs.existsSync(logDir)) return null;
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.log'))
    .filter(f => !sessionId || f.includes(sessionId))
    .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs }))
    .filter(x => x.t >= afterMs - 5000)
    .sort((a, b) => b.t - a.t);
  if (files[0]) return path.join(logDir, files[0].f);

  // Fallback: newest matching session regardless of mtime window
  if (sessionId) {
    const bySession = fs.readdirSync(logDir)
      .filter(f => f.includes(sessionId) && f.endsWith('.log'))
      .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (bySession[0]) return path.join(logDir, bySession[0].f);
  }
  return null;
}

async function runOnce(input: {
  workspace: string;
  task: string;
  mode: KnowledgeConsumptionMode;
  auditRunDir: string;
  sessionId: string;
}): Promise<RunEvidence> {
  ensureDir(input.auditRunDir);
  const startedMs = Date.now();
  const logger = {
    debug() {},
    info: (m: string) => console.log(`[phase6:${input.mode}] ${m}`),
    warn: (m: string) => console.warn(`[phase6:${input.mode}] ${m}`),
    error: (m: string) => console.error(`[phase6:${input.mode}] ${m}`),
  };

  // Reset logger state between runs
  ExecutionLogger.init(input.workspace, input.sessionId);

  const factory = new AppFactory(input.workspace, logger, undefined, input.mode);
  if (factory.getKnowledgeConsumption() !== input.mode) {
    return {
      knowledgeMode: input.mode,
      knowledgeInjection: input.mode === 'off' ? 'disabled' : 'unproven',
      status: 'INVALID_INFRASTRUCTURE',
      success: null,
      error: `AppFactory knowledgeConsumption mismatch: expected ${input.mode}`,
      planStepCount: null,
      usedPlanStepPath: false,
      usedSparrowFallback: false,
      verificationStatus: null,
      repairAttempts: null,
      logFile: null,
      metrics: emptyMetrics(),
      knowledge: {},
      taskId: null,
      runId: null,
      sessionId: input.sessionId,
    };
  }

  // Wiring check before execute
  const engine = factory.createStepExecutionEngine(input.workspace);
  const bridge = engine.getKnowledgeBridge();
  if (input.mode === 'off' && bridge) {
    return {
      knowledgeMode: 'off',
      knowledgeInjection: 'disabled',
      status: 'INVALID_INFRASTRUCTURE',
      success: null,
      error: 'Knowledge OFF still wired knowledgeBridge',
      planStepCount: null,
      usedPlanStepPath: false,
      usedSparrowFallback: false,
      verificationStatus: null,
      repairAttempts: null,
      logFile: null,
      metrics: emptyMetrics(),
      knowledge: {},
      taskId: null,
      runId: null,
      sessionId: input.sessionId,
    };
  }
  if (input.mode === 'on' && !bridge) {
    return {
      knowledgeMode: 'on',
      knowledgeInjection: 'unproven',
      status: 'INVALID_INFRASTRUCTURE',
      success: null,
      error: 'Knowledge ON missing knowledgeBridge',
      planStepCount: null,
      usedPlanStepPath: false,
      usedSparrowFallback: false,
      verificationStatus: null,
      repairAttempts: null,
      logFile: null,
      metrics: emptyMetrics(),
      knowledge: {},
      taskId: null,
      runId: null,
      sessionId: input.sessionId,
    };
  }

  let success: boolean | null = null;
  let error: string | null = null;
  let planStepCount: number | null = null;
  let usedPlanStepPath = false;
  let usedSparrowFallback = false;
  let verificationStatus: string | null = null;
  let repairAttempts: number | null = null;
  let taskId: string | null = null;
  let runId: string | null = null;
  let abortAt: string | null = null;
  let status: RunStatus = 'VALID';

  try {
    const discovered = await factory.discoverOllamaModels();
    if (discovered <= 0) {
      return {
        knowledgeMode: input.mode,
        knowledgeInjection: input.mode === 'off' ? 'disabled' : 'unproven',
        status: 'INVALID_INFRASTRUCTURE',
        success: null,
        error: 'provider unavailable: no Ollama models discovered',
        planStepCount: null,
        usedPlanStepPath: false,
        usedSparrowFallback: false,
        verificationStatus: null,
        repairAttempts: null,
        logFile: null,
        metrics: emptyMetrics(),
        knowledge: {},
        taskId: null,
        runId: null,
        sessionId: input.sessionId,
      };
    }

    const service = factory.createTaskExecutionService();
    const outcome = await service.execute({
      roleId: 'coder',
      task: input.task,
      sessionId: input.sessionId,
      executionMode: 'STANDARD',
      onConfirmationRequested: async () => true,
    });

    taskId = outcome.taskId;
    runId = outcome.runId;
    success = outcome.result?.success === true;
    const wf: any = outcome.result?.workflowResult;
    planStepCount = wf?.plan?.steps?.length ?? null;
    usedPlanStepPath = typeof planStepCount === 'number' && planStepCount > 0;
    abortAt = wf?.abortedAt ?? null;
    verificationStatus = outcome.snapshot?.verification?.status
      ?? wf?.reviewReport?.overallStatus
      ?? null;
    repairAttempts = Array.isArray((outcome.snapshot as any)?.repair?.attempts)
      ? (outcome.snapshot as any).repair.attempts.length
      : (Array.isArray(wf?.repairHistory) ? wf.repairHistory.length : null);

    if (!success) {
      error = outcome.result?.error ?? wf?.abortReason ?? 'execution reported failure';
      status = /ollama|ECONNREFUSED|provider|fetch failed|ETIMEDOUT|500|503|502/i.test(error)
        ? 'INVALID_INFRASTRUCTURE'
        : 'EXECUTION_FAILED';
    }
  } catch (e: any) {
    error = e?.message ?? String(e);
    status = /ollama|ECONNREFUSED|provider|fetch failed|ETIMEDOUT|500|503|502/i.test(error)
      ? 'INVALID_INFRASTRUCTURE'
      : 'EXECUTION_FAILED';
    success = false;
  }

  const logFile = findNewestLog(input.workspace, startedMs, input.sessionId);
  let logText = '';
  if (logFile && fs.existsSync(logFile)) {
    logText = fs.readFileSync(logFile, 'utf8');
    const destLog = path.join(input.auditRunDir, 'pipeline.log');
    fs.copyFileSync(logFile, destLog);
  }

  usedSparrowFallback = detectSparrowFallback(logText, abortAt);
  const metrics = parseToolMetrics(logText);
  const injectionSeen = detectKnowledgeInjection(logText);

  let knowledgeInjection: RunEvidence['knowledgeInjection'] =
    input.mode === 'off' ? 'disabled' : (injectionSeen ? 'proven' : 'unproven');

  const knowledge: Record<string, unknown> = input.mode === 'off'
    ? { knowledgeMode: 'off', knowledgeInjection: 'disabled' }
    : {
        knowledgeMode: 'on',
        knowledgeInjection,
        injectionLogMatched: injectionSeen,
        querySeed: null,
        relatedFiles: null,
        structuralFiles: null,
        semanticCount: null,
        experientialCount: null,
        freshness: null,
        claimCertainty: null,
        injectedContextSize: null,
        truncation: null,
      };

  // Enrich ON knowledge from log payloads when present
  if (input.mode === 'on' && injectionSeen) {
    const relatedMatch = logText.match(/relatedFiles"?\s*[:=]\s*\[([^\]]*)\]/);
    if (relatedMatch) {
      knowledge.relatedFiles = relatedMatch[1]
        .split(',')
        .map(s => s.replace(/["'\s]/g, ''))
        .filter(Boolean);
    }
    const filesMatch = logText.match(/injected bounded fused knowledge \((\d+) related files\)/i);
    if (filesMatch) {
      knowledge.relatedFileCount = Number(filesMatch[1]);
    }
  }

  if (usedSparrowFallback || !usedPlanStepPath) {
    status = 'INVALID_PLAN_PATH';
  }

  if (input.mode === 'on' && knowledgeInjection !== 'proven' && status === 'VALID') {
    status = 'INVALID_KNOWLEDGE_EVIDENCE';
  }

  if (input.mode === 'off' && injectionSeen) {
    status = 'INVALID_INFRASTRUCTURE';
    error = (error ? error + '; ' : '') + 'Knowledge OFF run emitted knowledge injection log';
  }

  const evidence: RunEvidence = {
    knowledgeMode: input.mode,
    knowledgeInjection,
    status,
    success,
    error,
    planStepCount,
    usedPlanStepPath,
    usedSparrowFallback,
    verificationStatus,
    repairAttempts,
    logFile: logFile ? path.relative(input.workspace, logFile).replace(/\\/g, '/') : null,
    metrics,
    knowledge,
    taskId,
    runId,
    sessionId: input.sessionId,
  };

  writeJson(path.join(input.auditRunDir, 'run.json'), evidence);
  return evidence;
}

function formatReport(input: {
  taskId: string;
  task: string;
  workspace: string;
  baselineHead: string | null;
  off: RunEvidence;
  on: RunEvidence;
  restoration: Record<string, unknown>;
}): string {
  const lines: string[] = [];
  lines.push('# Phase 6 Milestone 1 — Task A report');
  lines.push('');
  lines.push('This report lists **observable** A/B differences for a single controlled run.');
  lines.push('It does **not** conclude that Knowledge generally improves performance.');
  lines.push('');
  lines.push(`- taskId: \`${input.taskId}\``);
  lines.push(`- task: \`${input.task}\``);
  lines.push(`- workspace: \`${input.workspace}\``);
  lines.push(`- baselineHead: \`${input.baselineHead ?? 'null'}\``);
  lines.push('');
  lines.push('## Validity');
  lines.push('');
  lines.push(`- OFF status: **${input.off.status}**`);
  lines.push(`- ON status: **${input.on.status}**`);
  lines.push(`- OFF knowledgeInjection: \`${input.off.knowledgeInjection}\``);
  lines.push(`- ON knowledgeInjection: \`${input.on.knowledgeInjection}\``);
  lines.push(`- OFF planSteps: \`${input.off.planStepCount}\` planPath=${input.off.usedPlanStepPath}`);
  lines.push(`- ON planSteps: \`${input.on.planStepCount}\` planPath=${input.on.usedPlanStepPath}`);
  lines.push('');
  lines.push('## Exploration metrics');
  lines.push('');
  lines.push('| Metric | OFF | ON |');
  lines.push('|--------|-----|----|');
  const keys: (keyof ToolMetrics)[] = [
    'search_files', 'list_directory', 'grep', 'read_file',
    'explorationToolCalls', 'totalToolCalls', 'mutationOperations', 'repeatedFileReads',
  ];
  for (const k of keys) {
    lines.push(`| ${k} | ${input.off.metrics[k] as any} | ${input.on.metrics[k] as any} |`);
  }
  lines.push(`| uniqueFilesRead count | ${input.off.metrics.uniqueFilesRead.length} | ${input.on.metrics.uniqueFilesRead.length} |`);
  lines.push('');
  lines.push('## Observable deltas (this run only)');
  lines.push('');
  for (const k of ['search_files', 'list_directory', 'grep', 'read_file', 'explorationToolCalls', 'mutationOperations'] as const) {
    const d = (input.on.metrics[k] as number) - (input.off.metrics[k] as number);
    if (d === 0) {
      lines.push(`- ${k}: unchanged (${input.off.metrics[k]})`);
    } else if (d < 0) {
      lines.push(`- ON used ${-d} fewer \`${k}\` calls than OFF in this run (${input.off.metrics[k]} → ${input.on.metrics[k]}).`);
    } else {
      lines.push(`- ON used ${d} more \`${k}\` calls than OFF in this run (${input.off.metrics[k]} → ${input.on.metrics[k]}).`);
    }
  }
  lines.push('');
  lines.push('## Outcomes');
  lines.push('');
  lines.push(`- OFF success: ${input.off.success} error=${input.off.error ?? 'null'}`);
  lines.push(`- ON success: ${input.on.success} error=${input.on.error ?? 'null'}`);
  lines.push('');
  lines.push('## Restoration');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(input.restoration, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- See `cli-limitation.md` for interactive CLI Enter/newline constraint.');
  lines.push('- Zero exploration on both sides is a valid observation for this small task.');
  lines.push('- Do not generalize from a single A/B pair.');
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { workspace, auditDir, taskId } = parseArgs(process.argv.slice(2));
  const task = PHASE6_TASKS[taskId];
  if (!task) {
    throw new Error(`INVALID_INPUT: unknown taskId=${taskId}`);
  }

  try {
    assertOneLineTask(task);
  } catch (e: any) {
    const taskDir = path.join(auditDir, `task-${taskId}`);
    writeJson(path.join(taskDir, 'result.json'), {
      taskId,
      task,
      status: 'INVALID_INPUT',
      error: e.message,
    });
    throw e;
  }

  const taskDir = path.join(auditDir, `task-${taskId}`);
  const beforeDir = path.join(taskDir, 'before');
  const offDir = path.join(taskDir, 'off');
  const onDir = path.join(taskDir, 'on');
  const knowledgeSnap = path.join(beforeDir, 'knowledge-snapshot');
  ensureDir(taskDir);
  ensureDir(beforeDir);
  ensureDir(offDir);
  ensureDir(onDir);

  const baselineHead = currentHead(workspace);
  const baselineStatus = gitStatusPorcelain(workspace);
  writeJson(path.join(beforeDir, 'git.json'), {
    baselineHead,
    statusPorcelain: baselineStatus,
  });
  snapshotKnowledge(workspace, knowledgeSnap);
  writeJson(path.join(beforeDir, 'knowledge-meta.json'), {
    graphPresent: fs.existsSync(aiPath(workspace, KNOWLEDGE_GRAPH)),
    syncPresent: fs.existsSync(aiPath(workspace, KNOWLEDGE_SYNC)),
  });

  console.log(`[phase6] Task ${taskId} OFF…`);
  const off = await runOnce({
    workspace,
    task,
    mode: 'off',
    auditRunDir: offDir,
    sessionId: `phase6-${taskId}-off`,
  });

  console.log(`[phase6] Restoring workspace after OFF…`);
  let restoreAfterOffOk = true;
  let restoreAfterOffError: string | null = null;
  try {
    restoreWorkspaceFiles(workspace, baselineHead);
    restoreKnowledge(workspace, knowledgeSnap);
  } catch (e: any) {
    restoreAfterOffOk = false;
    restoreAfterOffError = e.message ?? String(e);
  }

  console.log(`[phase6] Task ${taskId} ON…`);
  const on = await runOnce({
    workspace,
    task,
    mode: 'on',
    auditRunDir: onDir,
    sessionId: `phase6-${taskId}-on`,
  });

  console.log(`[phase6] Restoring workspace after ON…`);
  let restoreAfterOnOk = true;
  let restoreAfterOnError: string | null = null;
  try {
    restoreWorkspaceFiles(workspace, baselineHead);
    restoreKnowledge(workspace, knowledgeSnap);
  } catch (e: any) {
    restoreAfterOnOk = false;
    restoreAfterOnError = e.message ?? String(e);
  }

  const restoration = {
    afterOff: { ok: restoreAfterOffOk, error: restoreAfterOffError },
    afterOn: { ok: restoreAfterOnOk, error: restoreAfterOnError },
    knowledgeSnapshotRestored: true,
  };

  const bothValid = off.status === 'VALID' && on.status === 'VALID'
    && restoreAfterOffOk && restoreAfterOnOk;

  const result = {
    taskId,
    task,
    workspace,
    baselineHead,
    timestamp: new Date().toISOString(),
    validity: {
      experimentValid: bothValid,
      off: off.status,
      on: on.status,
    },
    off,
    on,
    restoration,
    evidenceReferences: {
      offRun: 'off/run.json',
      onRun: 'on/run.json',
      offLog: 'off/pipeline.log',
      onLog: 'on/pipeline.log',
      cliLimitation: '../cli-limitation.md',
    },
    observableDeltas: {
      search_files: on.metrics.search_files - off.metrics.search_files,
      list_directory: on.metrics.list_directory - off.metrics.list_directory,
      grep: on.metrics.grep - off.metrics.grep,
      read_file: on.metrics.read_file - off.metrics.read_file,
      explorationToolCalls: on.metrics.explorationToolCalls - off.metrics.explorationToolCalls,
      mutationOperations: on.metrics.mutationOperations - off.metrics.mutationOperations,
      repeatedFileReads: on.metrics.repeatedFileReads - off.metrics.repeatedFileReads,
    },
    conclusion:
      'Milestone 1 observes a single controlled A/B pair. '
      + 'Do not conclude general Knowledge effectiveness from this run alone.',
  };

  writeJson(path.join(taskDir, 'result.json'), result);
  fs.writeFileSync(
    path.join(taskDir, 'report.md'),
    formatReport({ taskId, task, workspace, baselineHead, off, on, restoration }),
  );

  console.log(JSON.stringify({
    experimentValid: bothValid,
    off: off.status,
    on: on.status,
    deltas: result.observableDeltas,
  }, null, 2));

  if (!restoreAfterOffOk || !restoreAfterOnOk) {
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
