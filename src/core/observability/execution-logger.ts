import * as fs from 'fs';
import * as path from 'path';
import {
  CorrelationContext,
  LEGACY_UNKNOWN_RUN_ID,
  UNKNOWN_IDENTIFIER,
  buildEventId,
} from '../../domain/correlation';
import { PIPELINE_EVENT_SCHEMA_VERSION } from '../../domain/pipeline-event';

/**
 * Advanced Pipeline Logger (R6).
 * Logs every phase of the execution pipeline to .ai/logs/pipeline/
 * Stamped with authoritative first-class correlation identifiers:
 * - taskId
 * - runId
 * - sessionId
 * - attemptId
 * - seq (deterministic per-run monotonic sequence)
 * - eventId (unique stable event identifier)
 *
 * Invariants:
 * - NEVER influences execution decisions.
 * - NEVER breaks execution on failure.
 * - NEVER silently replaces run correlation context mid-run.
 */
export class ExecutionLogger {
  private static logDir: string | null = null;
  private static enabled = true;
  private static sessionId: string | null = null;
  private static context: CorrelationContext | null = null;
  private static currentLogFile: string | null = null;
  private static readonly runSeqCounters = new Map<string, number>();
  /** Monotonic provider HTTP attempt counter per run (Phase 6 PROVIDER_META.requestSeq). */
  private static readonly providerRequestSeqCounters = new Map<string, number>();

  static init(workspacePath: string, sessionId?: string): void {
    try {
      const dir = path.join(workspacePath, '.ai', 'logs', 'pipeline');
      fs.mkdirSync(dir, { recursive: true });
      ExecutionLogger.logDir = dir;
      ExecutionLogger.sessionId = sessionId ?? null;
      ExecutionLogger.context = null;
      ExecutionLogger.currentLogFile = null;
      ExecutionLogger.runSeqCounters.clear();
      ExecutionLogger.providerRequestSeqCounters.clear();
      ExecutionLogger.enabled = true;
    } catch {
      ExecutionLogger.enabled = false;
    }
  }

  /**
   * Set authoritative run correlation context for the current execution (R6.4).
   * Holds taskId, runId, sessionId, and optional attemptId.
   */
  static setContext(context: CorrelationContext | null): void {
    ExecutionLogger.context = context ? Object.freeze({ ...context }) : null;
    if (context?.sessionId) {
      ExecutionLogger.sessionId = context.sessionId;
    }
  }

  static getContext(): CorrelationContext | null {
    return ExecutionLogger.context;
  }

  /** Update the current attempt inside an active run context (e.g. during repair). */
  static setAttemptId(attemptId: string | undefined): void {
    if (ExecutionLogger.context) {
      ExecutionLogger.context = Object.freeze({
        ...ExecutionLogger.context,
        attemptId: attemptId || undefined,
      });
    }
  }

  /** Legacy adapter method; preserved for backward compatibility without breaking R6 invariants (R6.5). */
  static setSession(sessionId: string): void {
    ExecutionLogger.sessionId = sessionId;
    if (ExecutionLogger.context) {
      // If a first-class correlation context already exists, preserve its original sessionId mid-run (R6.5).
      if (!ExecutionLogger.context.sessionId || ExecutionLogger.context.sessionId === 'session-unknown') {
        ExecutionLogger.context = Object.freeze({
          ...ExecutionLogger.context,
          sessionId,
        });
      }
    }
  }

  static getSessionId(): string | null {
    return ExecutionLogger.context?.sessionId ?? ExecutionLogger.sessionId;
  }

  static getRunId(): string | null {
    return ExecutionLogger.context?.runId ?? null;
  }

  static getTaskId(): string | null {
    return ExecutionLogger.context?.taskId ?? null;
  }

  static getAttemptId(): string | null {
    return ExecutionLogger.context?.attemptId ?? null;
  }

  static getLogFile(): string | null {
    if (!ExecutionLogger.logDir) return null;
    if (!ExecutionLogger.currentLogFile) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const session = ExecutionLogger.sessionId ?? 'global';
      ExecutionLogger.currentLogFile = path.join(ExecutionLogger.logDir, `pipeline-${session}-${ts}.log`);
    }
    return ExecutionLogger.currentLogFile;
  }

  private static nextSeq(runId: string): number {
    const current = ExecutionLogger.runSeqCounters.get(runId) ?? 0;
    const next = current + 1;
    ExecutionLogger.runSeqCounters.set(runId, next);
    return next;
  }

  /**
   * Next provider HTTP attempt sequence within the current run.
   * Retries must each receive a distinct requestSeq.
   */
  static nextProviderRequestSeq(): number {
    const runId = ExecutionLogger.getRunId() ?? LEGACY_UNKNOWN_RUN_ID;
    const current = ExecutionLogger.providerRequestSeqCounters.get(runId) ?? 0;
    const next = current + 1;
    ExecutionLogger.providerRequestSeqCounters.set(runId, next);
    return next;
  }

  static log(
    phase: string,
    role: string,
    model: string,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!ExecutionLogger.enabled) return;
    try {
      const ts = new Date().toISOString();
      const ctx = ExecutionLogger.context;

      const runId = (data?.runId as string | undefined)
        ?? ctx?.runId
        ?? LEGACY_UNKNOWN_RUN_ID;

      const taskId = (data?.taskId as string | undefined)
        ?? ctx?.taskId
        ?? UNKNOWN_IDENTIFIER;

      const sessionId = (data?.sessionId as string | undefined)
        ?? ctx?.sessionId
        ?? ExecutionLogger.sessionId
        ?? 'global';

      const attemptId = (data?.attemptId as string | undefined)
        ?? ctx?.attemptId
        ?? undefined;

      const seq = typeof data?.seq === 'number'
        ? data.seq
        : ExecutionLogger.nextSeq(runId);

      const eventId = (data?.eventId as string | undefined)
        ?? buildEventId(runId, seq);

      const entry = {
        schemaVersion: PIPELINE_EVENT_SCHEMA_VERSION,
        eventId,
        seq,
        ts,
        taskId,
        runId,
        sessionId,
        ...(attemptId ? { attemptId } : {}),
        phase,
        role,
        model,
        message,
        ...(data ?? {}),
      };
      const line = JSON.stringify(entry);

      const colors: Record<string, string> = {
        'REPL': '\x1b[36m',
        'AGENT': '\x1b[35m',
        'WORKFLOW': '\x1b[33m',
        'PLANNING': '\x1b[33m',
        'STEP': '\x1b[33m',
        'EXECUTION': '\x1b[32m',
        'PROVIDER': '\x1b[35m',
        'TOOL': '\x1b[34m',
        'IMPACT': '\x1b[36m',
        'REVIEW': '\x1b[31m',
        'PATCH': '\x1b[33m',
        'GIT': '\x1b[32m',
        'CHECKPOINT': '\x1b[36m',
        'RECOVERY': '\x1b[31m',
        'REFLECTION': '\x1b[35m',
        'CONVERSATION': '\x1b[36m',
        'CONTEXT_STRATEGY': '\x1b[36m',
        'CONTEXT_GATHERING': '\x1b[36m',
        'PLANNER_CONTEXT': '\x1b[36m',
        'TODO_PLAN': '\x1b[36m',
        'TODO_BRIDGE': '\x1b[36m',
        'PLANNER_OUTPUT_REJECTED': '\x1b[31m',
        'FAILURE_PRIORITIZATION': '\x1b[31m',
        'REPAIR_CONTEXT': '\x1b[36m',
        'REPAIR_PLAN': '\x1b[33m',
        'REPAIR_ATTEMPT': '\x1b[35m',
        'REPAIR_RESULT': '\x1b[31m',
        'CONFIRMATION': '\x1b[33m',
        'PROVIDER_META': '\x1b[35m',
      };
      const color = colors[phase] ?? '\x1b[0m';
      const attemptTag = attemptId ? ` [${attemptId}]` : '';
      console.log(`${color}[${phase}]\x1b[0m [${role}] [${model}]${attemptTag} ${message}`);

      const logFile = ExecutionLogger.getLogFile();
      if (logFile) {
        // Noise filter: skip verbose PROVIDER prompts/responses in file log.
        // PROVIDER_META is compact correlation metadata and MUST be persisted.
        const noisyPhases = new Set(['PROVIDER']);
        if (!noisyPhases.has(phase)) {
          fs.appendFileSync(logFile, line + '\n');
        }
      }
    } catch {
      // fail-safe: never break execution
    }
  }

  static logPrompt(role: string, model: string, systemPrompt: string, userPrompt: string): void {
    ExecutionLogger.log('PROVIDER', role, model, 'Prompt sent to LLM', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      systemPrompt: systemPrompt.substring(0, 500),
      userPrompt: userPrompt.substring(0, 500),
    });
  }

  static logResponse(role: string, model: string, content: string, toolCallCount: number, tokens?: { prompt?: number; completion?: number; total?: number }): void {
    ExecutionLogger.log('PROVIDER', role, model, `LLM Response: ${toolCallCount} tool calls, ${content.length} chars`, {
      contentPreview: content.substring(0, 300),
      toolCallCount,
      tokens,
    });
  }
}
