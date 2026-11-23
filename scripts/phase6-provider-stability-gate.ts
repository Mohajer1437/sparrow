/**
 * Phase 6 Provider Stability Gate — observation only.
 *
 * Exercises Sparrow → OllamaProvider → /api/chat with the Phase 6 models.
 * Does NOT run A/B, Knowledge ON, mutations, or change retry/provider config.
 *
 * Usage:
 *   npx tsx scripts/phase6-provider-stability-gate.ts \
 *     --auditDir E:\agentic\knowledge-audit\06-effectiveness\provider-stability
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OllamaProvider, countPromptChars } from '../src/core/provider/ollama-provider';
import { ExecutionLogger } from '../src/core/observability/execution-logger';
import { TaskExecutor } from '../src/core/execution/task-executor';
import { InMemoryProviderRegistry } from '../src/core/provider/in-memory-provider-registry';
import { InMemoryToolRegistry } from '../src/core/tool/in-memory-tool-registry';
import { ToolExecutor } from '../src/core/tool/tool-executor';
import { ReadFileTool } from '../src/core/tools/workspace/read-file-tool';
import { DefaultPromptBuilder } from '../src/core/prompt/default-prompt-builder';
import { LocalWorkspace } from '../src/core/workspace/local-workspace';
import { KnownProviders } from '../src/domain/provider-id';
import { Message } from '../src/domain/message';
import { Tool } from '../src/domain/tool';
import { ModelRequest } from '../src/contracts/provider';
import { ExecutionRequest } from '../src/domain/execution-request';
import { ContextObject } from '../src/domain/context';
import { Role } from '../src/contracts/role';

const PLANNER_MODEL = 'gpt-oss:120b-cloud';
const EXECUTOR_MODEL = 'gpt-oss:20b-cloud';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const REPETITIONS = 5;

interface TraceRow {
  test: string;
  repetition: number;
  timestamp: string;
  requestSeq: number | null;
  stage: string;
  model: string;
  promptChars: number;
  messageCount: number;
  toolCount: number;
  httpStatus: number | null;
  durationMs: number | null;
  retryAttempt: number;
  success: boolean;
  error: string | null;
  note?: string;
}

function parseArgs(argv: string[]): { auditDir: string } {
  let auditDir = 'E:/agentic/knowledge-audit/06-effectiveness/provider-stability';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--auditDir' && argv[i + 1]) {
      auditDir = argv[++i];
    }
  }
  return { auditDir };
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const readFileToolSchema: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file from the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file' },
    },
    required: ['path'],
  },
  async execute() {
    return { toolCallId: '', content: '', isError: false };
  },
};

function extractMetaFromLog(logText: string): Array<Record<string, unknown>> {
  return logText
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
    })
    .filter((e): e is Record<string, unknown> => !!e && e.phase === 'PROVIDER_META');
}

function metaToRow(
  test: string,
  repetition: number,
  m: Record<string, unknown>,
  note?: string,
): TraceRow {
  return {
    test,
    repetition,
    timestamp: String(m.ts ?? m.startedAt ?? ''),
    requestSeq: typeof m.requestSeq === 'number' ? m.requestSeq : null,
    stage: String(m.stage ?? m.role ?? 'unknown'),
    model: String(m.model ?? ''),
    promptChars: typeof m.promptChars === 'number' ? m.promptChars : 0,
    messageCount: typeof m.messageCount === 'number' ? m.messageCount : 0,
    toolCount: typeof m.toolCount === 'number' ? m.toolCount : 0,
    httpStatus: typeof m.httpStatus === 'number' ? m.httpStatus : null,
    durationMs: typeof m.durationMs === 'number' ? m.durationMs : null,
    retryAttempt: typeof m.retryAttempt === 'number' ? m.retryAttempt : 0,
    success: m.success === true,
    error: typeof m.error === 'string' ? m.error : null,
    note,
  };
}

async function callGenerate(
  provider: OllamaProvider,
  request: ModelRequest,
): Promise<{ ok: boolean; error: string | null; toolCalls: number; contentLen: number }> {
  try {
    const res = await provider.generate(request);
    return {
      ok: true,
      error: null,
      toolCalls: res.toolCalls?.length ?? 0,
      contentLen: (res.content ?? '').length,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: String(e?.message ?? e).slice(0, 500),
      toolCalls: 0,
      contentLen: 0,
    };
  }
}

/** Test 1: direct short /api/chat calls (planner + executor models). */
async function test1Direct(
  provider: OllamaProvider,
  auditDir: string,
  rows: TraceRow[],
): Promise<void> {
  const sessionId = 'stability-t1-direct';
  ExecutionLogger.init(auditDir, sessionId);
  ExecutionLogger.setContext({ runId: 'stability-t1', sessionId, taskId: 'stability-t1' });

  for (let rep = 1; rep <= REPETITIONS; rep++) {
    for (const model of [PLANNER_MODEL, EXECUTOR_MODEL]) {
      const stage = model === PLANNER_MODEL ? 'planner' : 'executor';
      await callGenerate(provider, {
        model,
        messages: [
          { role: 'system', content: 'Reply with exactly OK.' },
          { role: 'user', content: `Stability ping ${rep}. Reply OK.` },
        ],
        observability: { stage, retryAttempt: 0 },
      });
    }
  }

  const logFile = ExecutionLogger.getLogFile();
  if (logFile && fs.existsSync(logFile)) {
    const metas = extractMetaFromLog(fs.readFileSync(logFile, 'utf8'));
    for (const m of metas) rows.push(metaToRow('T1_direct', 0, m));
    fs.copyFileSync(logFile, path.join(auditDir, 't1-pipeline.log'));
  }
}

/**
 * Test 2: tool-result transition.
 * Synthetic Sparrow-shaped multi-turn (deterministic) + live TaskExecutor read_file loops.
 */
async function test2ToolResultTransition(
  provider: OllamaProvider,
  auditDir: string,
  rows: TraceRow[],
): Promise<void> {
  // --- 2a: synthetic multi-turn matching executor→tool→result→executor ---
  const sessionA = 'stability-t2a-synthetic';
  ExecutionLogger.init(auditDir, sessionA);
  ExecutionLogger.setContext({ runId: 'stability-t2a', sessionId: sessionA, taskId: 'stability-t2a' });

  const probeContent = [
    'export function Probe() {',
    '  return <div>probe</div>;',
    '}',
  ].join('\n');

  for (let rep = 1; rep <= REPETITIONS; rep++) {
    // Turn 1: executor with tools (like first executor request)
    const turn1Messages: Message[] = [
      {
        role: 'system',
        content: 'You are a coding agent. Use read_file when you need file contents. Do not modify files.',
      },
      {
        role: 'user',
        content: 'Read probe.txt with read_file, then reply STOP. Do not write files.',
      },
    ];
    const turn1 = await callGenerate(provider, {
      model: EXECUTOR_MODEL,
      messages: turn1Messages,
      tools: [readFileToolSchema],
      observability: { stage: 'executor', retryAttempt: 0 },
    });

    // Turn 2: same shape as after tool result (critical boundary from blocked A/B)
    const toolCallId = `call_stability_${rep}`;
    const turn2Messages: Message[] = [
      ...turn1Messages,
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: toolCallId,
            name: 'read_file',
            arguments: JSON.stringify({ path: 'probe.txt' }),
          },
        ],
      } as Message,
      {
        role: 'tool',
        content: probeContent,
        tool_call_id: toolCallId,
        name: 'read_file',
      } as Message,
      {
        role: 'user',
        content: 'Tool result delivered. Reply STOP with no further tool calls.',
      },
    ];

    const pc = countPromptChars(turn2Messages);
    await callGenerate(provider, {
      model: EXECUTOR_MODEL,
      messages: turn2Messages,
      tools: [readFileToolSchema],
      observability: { stage: 'executor', retryAttempt: 0 },
    });

    // If turn1 failed, still recorded via PROVIDER_META; annotate expected sizes
    void turn1;
    void pc;
  }

  const logA = ExecutionLogger.getLogFile();
  if (logA && fs.existsSync(logA)) {
    const metas = extractMetaFromLog(fs.readFileSync(logA, 'utf8'));
    for (const m of metas) {
      const note = (typeof m.messageCount === 'number' && m.messageCount >= 4)
        ? 'post_tool_result_turn'
        : 'pre_tool_or_other';
      rows.push(metaToRow('T2a_synthetic_transition', 0, m, note));
    }
    fs.copyFileSync(logA, path.join(auditDir, 't2a-pipeline.log'));
  }

  // --- 2b: live TaskExecutor with only read_file (no mutation tools) ---
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-stability-'));
  fs.writeFileSync(path.join(work, 'probe.txt'), probeContent, 'utf8');

  const sessionB = 'stability-t2b-executor';
  ExecutionLogger.init(auditDir, sessionB);
  ExecutionLogger.setContext({ runId: 'stability-t2b', sessionId: sessionB, taskId: 'stability-t2b' });

  const workspace = new LocalWorkspace(work);
  const registry = new InMemoryProviderRegistry(
    new Map([[KnownProviders.OLLAMA, provider]]),
  );
  const toolReg = new InMemoryToolRegistry([new ReadFileTool(workspace)]);
  const toolExecutor = new ToolExecutor(toolReg, undefined, undefined, work);
  const executor = new TaskExecutor(new DefaultPromptBuilder(), registry, toolExecutor);

  const role: Role = {
    getName: () => 'Step Agent',
    getConfig: () => ({
      systemPrompt:
        'You are a coding agent. You may only use read_file. After reading probe.txt, reply with exactly STOP and no further tool calls. Never write or patch files.',
    }),
  };

  for (let rep = 1; rep <= Math.min(3, REPETITIONS); rep++) {
    const context: ContextObject = {
      taskIntent: `Rep ${rep}: Read probe.txt using read_file, then reply STOP. Do not modify any files.`,
      files: [],
      rules: [],
      knowledge: [],
      memories: [],
    };
    const request: ExecutionRequest = {
      providerId: KnownProviders.OLLAMA,
      model: EXECUTOR_MODEL,
      role,
      context,
      tools: [readFileToolSchema],
      sessionId: `${sessionB}-${rep}`,
      executionMode: 'READ_ONLY',
    };
    try {
      await executor.execute(request);
    } catch (e: any) {
      rows.push({
        test: 'T2b_live_executor',
        repetition: rep,
        timestamp: new Date().toISOString(),
        requestSeq: null,
        stage: 'executor',
        model: EXECUTOR_MODEL,
        promptChars: 0,
        messageCount: 0,
        toolCount: 1,
        httpStatus: null,
        durationMs: null,
        retryAttempt: 0,
        success: false,
        error: String(e?.message ?? e).slice(0, 500),
        note: 'executor_threw',
      });
    }
  }

  const logB = ExecutionLogger.getLogFile();
  if (logB && fs.existsSync(logB)) {
    const metas = extractMetaFromLog(fs.readFileSync(logB, 'utf8'));
    for (const m of metas) rows.push(metaToRow('T2b_live_executor', 0, m));
    fs.copyFileSync(logB, path.join(auditDir, 't2b-pipeline.log'));
  }

  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Test 3: modest prompt-size ladder (not huge stress). */
async function test3PromptSize(
  provider: OllamaProvider,
  auditDir: string,
  rows: TraceRow[],
): Promise<void> {
  const sessionId = 'stability-t3-promptsize';
  ExecutionLogger.init(auditDir, sessionId);
  ExecutionLogger.setContext({ runId: 'stability-t3', sessionId, taskId: 'stability-t3' });

  // Approximate sizes near the failed A/B turn (~5955) without inventing megabyte prompts.
  const sizes = [
    { label: 'small', pad: 200 },
    { label: 'mid', pad: 2000 },
    { label: 'near_fail_window', pad: 4500 },
  ];

  for (const s of sizes) {
    for (let rep = 1; rep <= 3; rep++) {
      const filler = 'x'.repeat(s.pad);
      const toolCallId = `call_size_${s.label}_${rep}`;
      const messages: Message[] = [
        { role: 'system', content: 'Reply STOP.' },
        { role: 'user', content: `After tool result, reply STOP. Context marker=${s.label}` },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: toolCallId,
            name: 'read_file',
            arguments: JSON.stringify({ path: 'probe.txt' }),
          }],
        } as Message,
        {
          role: 'tool',
          content: filler,
          tool_call_id: toolCallId,
          name: 'read_file',
        } as Message,
      ];
      await callGenerate(provider, {
        model: EXECUTOR_MODEL,
        messages,
        tools: [readFileToolSchema],
        observability: { stage: 'executor', retryAttempt: 0 },
      });
    }
  }

  const logFile = ExecutionLogger.getLogFile();
  if (logFile && fs.existsSync(logFile)) {
    const metas = extractMetaFromLog(fs.readFileSync(logFile, 'utf8'));
    for (const m of metas) rows.push(metaToRow('T3_prompt_size', 0, m));
    fs.copyFileSync(logFile, path.join(auditDir, 't3-pipeline.log'));
  }
}

function classify(rows: TraceRow[]): 'STABLE' | 'UNSTABLE' | 'INCONCLUSIVE' {
  const httpRows = rows.filter(r => r.httpStatus !== null);
  if (httpRows.length < 5) return 'INCONCLUSIVE';
  const failures = httpRows.filter(r => r.httpStatus !== 200 || !r.success);
  const postTool = httpRows.filter(r => r.note === 'post_tool_result_turn' || (r.messageCount ?? 0) >= 4);
  if (failures.length > 0) return 'UNSTABLE';
  if (postTool.length === 0) return 'INCONCLUSIVE';
  return 'STABLE';
}

async function main(): Promise<void> {
  const { auditDir } = parseArgs(process.argv.slice(2));
  ensureDir(auditDir);
  const startedAt = new Date().toISOString();
  const rows: TraceRow[] = [];
  const provider = new OllamaProvider(OLLAMA_URL);

  // Preflight
  let tagsOk = false;
  let tagsError: string | null = null;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    tagsOk = r.ok;
    if (!r.ok) tagsError = `tags HTTP ${r.status}`;
  } catch (e: any) {
    tagsError = String(e?.message ?? e);
  }

  writeJson(path.join(auditDir, 'preflight.json'), {
    startedAt,
    ollamaUrl: OLLAMA_URL,
    plannerModel: PLANNER_MODEL,
    executorModel: EXECUTOR_MODEL,
    tagsOk,
    tagsError,
    repetitions: REPETITIONS,
  });

  if (!tagsOk) {
    writeJson(path.join(auditDir, 'result.json'), {
      classification: 'INCONCLUSIVE',
      gate: 'A/B REMAINS BLOCKED',
      reason: `Ollama /api/tags unreachable: ${tagsError}`,
    });
    console.error('INCONCLUSIVE: Ollama unavailable');
    process.exitCode = 2;
    return;
  }

  console.log('[stability] T1 direct…');
  await test1Direct(provider, auditDir, rows);
  console.log('[stability] T2 tool-result transition…');
  await test2ToolResultTransition(provider, auditDir, rows);
  console.log('[stability] T3 prompt-size…');
  await test3PromptSize(provider, auditDir, rows);

  const classification = classify(rows);
  const failures = rows.filter(r => r.httpStatus !== null && (r.httpStatus !== 200 || !r.success));
  const postToolRows = rows.filter(r =>
    r.note === 'post_tool_result_turn' || (r.test.startsWith('T2') && (r.messageCount ?? 0) >= 4),
  );
  const postToolFailures = postToolRows.filter(r => r.httpStatus !== 200 || !r.success);

  const bySize = [...rows]
    .filter(r => r.test === 'T3_prompt_size' && r.httpStatus !== null)
    .sort((a, b) => a.promptChars - b.promptChars)
    .map(r => ({ promptChars: r.promptChars, httpStatus: r.httpStatus, durationMs: r.durationMs, success: r.success }));

  const result = {
    startedAt,
    endedAt: new Date().toISOString(),
    classification,
    gate: classification === 'STABLE' ? 'A/B MAY PROCEED' : 'A/B REMAINS BLOCKED',
    totals: {
      requests: rows.filter(r => r.httpStatus !== null).length,
      http200: rows.filter(r => r.httpStatus === 200).length,
      httpNon200: rows.filter(r => r.httpStatus !== null && r.httpStatus !== 200).length,
      postToolRequests: postToolRows.length,
      postToolFailures: postToolFailures.length,
    },
    failures,
    promptSizeLadder: bySize,
  };

  writeJson(path.join(auditDir, 'provider-trace.json'), rows);
  writeJson(path.join(auditDir, 'result.json'), result);

  const md: string[] = [];
  md.push('# Phase 6 Provider Stability Gate');
  md.push('');
  md.push(`Classification: **${classification}**`);
  md.push(`Gate: **${result.gate}**`);
  md.push('');
  md.push('## Provider Trace');
  md.push('');
  md.push('| Seq | Test | Stage | Model | Prompt chars | Tools | HTTP | Duration | Retry | Note |');
  md.push('| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of rows.filter(x => x.httpStatus !== null)) {
    md.push(
      `| ${r.requestSeq ?? ''} | ${r.test} | ${r.stage} | ${r.model} | ${r.promptChars} | ${r.toolCount} | ${r.httpStatus} | ${r.durationMs ?? ''} | ${r.retryAttempt} | ${r.note ?? ''} |`,
    );
  }
  md.push('');
  md.push(`Failures: ${failures.length}`);
  fs.writeFileSync(path.join(auditDir, 'report.md'), md.join('\n') + '\n');

  console.log(JSON.stringify({
    classification,
    gate: result.gate,
    totals: result.totals,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
