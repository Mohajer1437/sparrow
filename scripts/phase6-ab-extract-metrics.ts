/**
 * One-shot metrics extraction for Phase 6 Task A A/B (observation only).
 */
import * as fs from 'fs';
import * as path from 'path';

function analyze(mode: 'off' | 'on') {
  const logPath = path.join(
    'E:/agentic/knowledge-audit/06-effectiveness/task-A',
    mode,
    'pipeline.log',
  );
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const events = lines
    .map(l => {
      try {
        return JSON.parse(l) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, any>[];

  const meta = events.filter(e => e.phase === 'PROVIDER_META');
  const tools = events.filter(e => e.phase === 'TOOL' && /Executing tool:/.test(e.message || ''));
  const toolNames = tools.map(t => String(t.message || '').replace(/.*Executing tool:\s*/, '').trim());
  const counts: Record<string, number> = {};
  for (const n of toolNames) counts[n] = (counts[n] || 0) + 1;

  const readPaths: string[] = [];
  for (const r of tools.filter(t => /read_file/.test(t.message || ''))) {
    let p: string | null = null;
    if (typeof r.args === 'string') {
      try {
        p = JSON.parse(r.args).path;
      } catch {
        /* ignore */
      }
    } else if (r.args?.path) p = r.args.path;
    if (p) readPaths.push(String(p).replace(/\\/g, '/'));
  }
  const uniqueReads = [...new Set(readPaths)];
  const repeatedReads = Math.max(0, readPaths.length - uniqueReads.length);

  const mutations = events.filter(e => e.phase === 'MUTATION');
  const know = events.filter(e =>
    /Phase5:|Phase3:|before_step|injected bounded|\[KNOWLEDGE\]/i.test(
      `${e.phase || ''} ${e.message || ''}`,
    ),
  );

  const http: Record<string, number> = {};
  for (const m of meta) {
    const s = String(m.httpStatus);
    http[s] = (http[s] || 0) + 1;
  }
  const byStage: Record<string, number> = {};
  for (const m of meta) {
    const s = String(m.stage || 'unknown');
    byStage[s] = (byStage[s] || 0) + 1;
  }

  const planner = meta.filter(m => m.stage === 'planner');
  const executor = meta.filter(m => m.stage === 'executor');
  const execChars = executor.map(m => m.promptChars).filter((n: any) => typeof n === 'number');
  const first = events[0]?.ts;
  const last = events[events.length - 1]?.ts;

  const targetFiles = ['components/TaskCard.tsx', 'components/StatusBadge.tsx', 'types/domain.ts'];
  const unrelatedReads = uniqueReads.filter(
    p => !targetFiles.some(t => p === t || p.endsWith('/' + t) || t.endsWith(p)),
  );

  return {
    mode,
    eventCount: events.length,
    provider: meta.map(m => ({
      seq: m.requestSeq,
      stage: m.stage,
      model: m.model,
      promptChars: m.promptChars,
      messageCount: m.messageCount,
      toolCount: m.toolCount,
      http: m.httpStatus,
      durationMs: m.durationMs,
      retry: m.retryAttempt,
      success: m.success,
      error: m.error || null,
      ts: m.ts || m.startedAt,
    })),
    http,
    byStage,
    toolCounts: counts,
    totalTools: toolNames.length,
    readPaths,
    uniqueReads,
    repeatedReads,
    unrelatedReads,
    mutationMessages: mutations.map(m => ({
      message: m.message,
      status: m.status,
      codes: m.codes,
      paths: m.paths,
    })),
    knowledgeEvents: know.map(k => ({
      phase: k.phase,
      message: k.message,
      relatedFiles: k.relatedFiles,
      freshness: k.freshness,
      ts: k.ts,
    })),
    plannerPromptChars: planner[0]?.promptChars ?? null,
    firstExecutorPromptChars: execChars[0] ?? null,
    maxExecutorPromptChars: execChars.length ? Math.max(...execChars) : null,
    finalExecutorPromptChars: execChars.length ? execChars[execChars.length - 1] : null,
    durationMs: first && last ? Date.parse(last) - Date.parse(first) : null,
    premise: events
      .filter(
        e =>
          e.phase === 'PREMISE' ||
          /Premise|TARGET_NOT_FOUND|MUTATION|APPLIED|ROLLED|K6A/i.test(e.message || ''),
      )
      .map(e => ({ phase: e.phase, message: e.message })),
    workflow: events.filter(e => e.phase === 'WORKFLOW').map(e => e.message),
    step: events.filter(e => e.phase === 'STEP').map(e => e.message),
    verification: events
      .filter(e => /VERIFICATION|TODO_VERIFICATION|REGRESSION/i.test(e.phase || ''))
      .map(e => ({ phase: e.phase, message: e.message })),
  };
}

const off = analyze('off');
const on = analyze('on');
const outDir = 'E:/agentic/knowledge-audit/06-effectiveness/task-A';

fs.writeFileSync(path.join(outDir, 'off/provider-meta.json'), JSON.stringify({ events: off.provider }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'on/provider-meta.json'), JSON.stringify({ events: on.provider }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'off/metrics.json'), JSON.stringify(off, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'on/metrics.json'), JSON.stringify(on, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      offSummary: {
        http: off.http,
        byStage: off.byStage,
        tools: off.toolCounts,
        planner: off.plannerPromptChars,
        exec: [off.firstExecutorPromptChars, off.maxExecutorPromptChars, off.finalExecutorPromptChars],
        dur: off.durationMs,
        knowN: off.knowledgeEvents.length,
        premise: off.premise,
        workflow: off.workflow,
      },
      onSummary: {
        http: on.http,
        byStage: on.byStage,
        tools: on.toolCounts,
        reads: on.readPaths,
        unrelated: on.unrelatedReads,
        planner: on.plannerPromptChars,
        exec: [on.firstExecutorPromptChars, on.maxExecutorPromptChars, on.finalExecutorPromptChars],
        dur: on.durationMs,
        know: on.knowledgeEvents,
        mutations: on.mutationMessages,
        verification: on.verification,
        step: on.step.filter(s => /Injected|Knowledge|Phase|scope|Step/i.test(s)),
      },
    },
    null,
    2,
  ),
);
