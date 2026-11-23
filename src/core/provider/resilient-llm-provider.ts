/**
 * ResilientLlmProvider — retries the SAME ModelRequest across ordered
 * provider candidates on availability-class failures only.
 *
 * Does not recreate Tasks, Plans, or tool executions.
 *
 * AbortSignal ownership:
 * - `request.signal` is the CALLER cancellation signal only.
 * - Each provider attempt receives a FRESH signal linked to the caller
 *   (and optionally a fresh per-attempt timeout).
 * - An attempt timeout must not leave later candidates with an already-
 *   aborted signal (AC-08).
 * - If the caller cancels, failover must stop immediately.
 */

import type { LlmProvider } from '../../contracts/llm-provider';
import type { ModelRequest, ModelResponse } from '../../contracts/provider';
import {
  ProviderExhaustedError,
  ProviderFailoverAttempt,
} from '../../domain/errors/provider-errors';
import {
  ProviderHealthOptions,
  ProviderHealthResult,
} from '../../domain/provider-health';
import { isProviderHealthCheckable } from '../../contracts/provider-health';
import { ExecutionLogger } from '../observability/execution-logger';
import {
  classifyProviderFailure,
  isFailoverCandidate,
  safeProviderFailureReason,
} from './provider-failover-policy';

export interface ResilientProviderCandidate {
  readonly name: string;
  readonly provider: LlmProvider;
}

export interface ResilientLlmProviderOptions {
  readonly candidates: ReadonlyArray<ResilientProviderCandidate>;
  /** Preferred starting provider name (must exist in candidates). */
  readonly preferredName?: string;
  /** Optional sink for user-visible failover lines (CLI wires console). */
  readonly onFailoverMessage?: (message: string) => void;
  /**
   * Optional per-attempt timeout (ms). Each candidate gets a fresh timeout
   * lifecycle; a timeout on A does not abort B's attempt signal.
   * Caller cancellation (`request.signal`) remains separate and stops failover.
   */
  readonly attemptTimeoutMs?: number;
}

export class ResilientLlmProvider implements LlmProvider {
  private readonly candidates: ResilientProviderCandidate[];
  private preferredName: string;
  /** Session-scoped: providers that failed a failover-candidate error. */
  private readonly sessionUnavailable = new Set<string>();
  private readonly onFailoverMessage?: (message: string) => void;
  private readonly attemptTimeoutMs?: number;

  constructor(options: ResilientLlmProviderOptions) {
    if (!options.candidates.length) {
      throw new Error('ResilientLlmProvider requires at least one candidate');
    }
    this.candidates = [...options.candidates];
    this.preferredName =
      options.preferredName && this.candidates.some((c) => c.name === options.preferredName)
        ? options.preferredName
        : this.candidates[0].name;
    this.onFailoverMessage = options.onFailoverMessage;
    this.attemptTimeoutMs =
      typeof options.attemptTimeoutMs === 'number' && options.attemptTimeoutMs > 0
        ? options.attemptTimeoutMs
        : undefined;
  }

  getPreferredName(): string {
    return this.preferredName;
  }

  getOrderedCandidateNames(): ReadonlyArray<string> {
    return this.orderedCandidates().map((c) => c.name);
  }

  async checkHealth(options?: ProviderHealthOptions): Promise<ProviderHealthResult> {
    const preferred = this.candidates.find((c) => c.name === this.preferredName)
      ?? this.candidates[0];
    if (isProviderHealthCheckable(preferred.provider)) {
      return preferred.provider.checkHealth(options);
    }
    return {
      providerType: 'resilient',
      endpoint: preferred.name,
      authentication: 'not_checked',
      latencyMs: 0,
      status: 'unknown',
      message: 'Underlying provider does not implement health checks',
      checkedAt: new Date().toISOString(),
    };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const callerSignal = request.signal;
    throwIfAborted(callerSignal);

    const order = this.orderedCandidates().filter(
      (c) => !this.sessionUnavailable.has(c.name),
    );

    if (order.length === 0) {
      throw new ProviderExhaustedError(
        'All available providers failed. No provider remains available for this operation.',
        [],
      );
    }

    const attempts: ProviderFailoverAttempt[] = [];

    for (let i = 0; i < order.length; i++) {
      throwIfAborted(callerSignal);

      const candidate = order[i];
      const attempt = createAttemptRequest(request, callerSignal, this.attemptTimeoutMs);
      try {
        const response = await candidate.provider.generate(attempt.request);
        // Successful provider becomes preferred for subsequent ops this session
        this.preferredName = candidate.name;
        return response;
      } catch (err: unknown) {
        // Caller cancelled the overall operation — do not treat as provider timeout failover.
        if (callerSignal?.aborted) {
          throw err;
        }

        const category = classifyProviderFailure(err);
        const reason = safeProviderFailureReason(err);
        attempts.push({
          providerName: candidate.name,
          category,
          message: reason,
        });

        ExecutionLogger.log(
          'PROVIDER_FAILED',
          '-',
          '-',
          `provider.failed name=${candidate.name} category=${category}`,
          {
            event: 'provider.failed',
            providerName: candidate.name,
            category,
            message: reason,
          },
        );

        if (!isFailoverCandidate(err)) {
          // Application/request error — do not failover
          throw err;
        }

        this.sessionUnavailable.add(candidate.name);

        const next = order[i + 1];
        if (!next) {
          break;
        }

        const msg =
          `Provider "${candidate.name}" failed: ${reason}. `
          + `Switching to provider "${next.name}".`;
        this.emitFailover(msg, candidate.name, next.name, category);
      } finally {
        attempt.dispose();
      }
    }

    ExecutionLogger.log(
      'PROVIDER_EXHAUSTED',
      '-',
      '-',
      'provider.exhausted',
      {
        event: 'provider.exhausted',
        attempts: attempts.map((a) => ({
          providerName: a.providerName,
          category: a.category,
        })),
      },
    );

    throw new ProviderExhaustedError(
      'All available providers failed. No provider remains available for this operation.',
      attempts,
    );
  }

  private orderedCandidates(): ResilientProviderCandidate[] {
    const preferred = this.candidates.find((c) => c.name === this.preferredName);
    const rest = this.candidates.filter((c) => c.name !== this.preferredName);
    return preferred ? [preferred, ...rest] : [...this.candidates];
  }

  private emitFailover(
    message: string,
    from: string,
    to: string,
    category: string,
  ): void {
    ExecutionLogger.log(
      'PROVIDER_FAILOVER',
      '-',
      '-',
      `provider.failover from=${from} to=${to}`,
      {
        event: 'provider.failover',
        from,
        to,
        category,
        message,
      },
    );
    this.onFailoverMessage?.(message);
  }
}

/**
 * Build a per-attempt ModelRequest: same logical payload, fresh AbortSignal.
 * - Caller abort propagates to the attempt (cancellation).
 * - Optional attempt timeout is independent and does not abort the caller signal.
 */
export function createAttemptRequest(
  request: ModelRequest,
  callerSignal: AbortSignal | undefined,
  attemptTimeoutMs: number | undefined,
): { request: ModelRequest; dispose: () => void } {
  const { signal, dispose } = createAttemptSignal(callerSignal, attemptTimeoutMs);
  return {
    request: {
      messages: request.messages,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      tools: request.tools,
      observability: request.observability,
      signal,
    },
    dispose,
  };
}

function createAttemptSignal(
  callerSignal: AbortSignal | undefined,
  attemptTimeoutMs: number | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const parts: AbortSignal[] = [];
  const disposers: Array<() => void> = [];

  if (callerSignal) {
    // Wrap caller so an attempt-local abort never has to share identity with
    // the caller signal; caller abort still forwards into the attempt.
    const callerBridge = new AbortController();
    if (callerSignal.aborted) {
      callerBridge.abort(callerSignal.reason);
    } else {
      const onAbort = () => callerBridge.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', onAbort, { once: true });
      disposers.push(() => callerSignal.removeEventListener('abort', onAbort));
    }
    parts.push(callerBridge.signal);
  }

  if (attemptTimeoutMs != null && attemptTimeoutMs > 0) {
    // Fresh timeout lifecycle for THIS attempt only.
    parts.push(AbortSignal.timeout(attemptTimeoutMs));
  }

  if (parts.length === 0) {
    return { signal: new AbortController().signal, dispose: () => {} };
  }

  if (parts.length === 1) {
    return {
      signal: parts[0],
      dispose: () => { for (const d of disposers) d(); },
    };
  }

  // Node 20+: combine caller cancel + attempt timeout without poisoning caller.
  return {
    signal: AbortSignal.any(parts),
    dispose: () => { for (const d of disposers) d(); },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const err = new Error(
    reason != null ? String(reason) : 'This operation was aborted',
  );
  err.name = 'AbortError';
  throw err;
}
