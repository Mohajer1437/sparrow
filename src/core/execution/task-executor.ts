import { SessionManager } from '../session/session-manager';
import { ReflectionEngine } from '../../contracts/reflection-engine';
import { PromptBuilder } from '../../contracts/prompt';
import { ProviderRegistry } from '../../contracts/provider-registry';
import { ModelRequest, ModelResponse } from '../../contracts/provider';
import { ProviderError, ProviderExhaustedError } from '../../domain/errors/provider-errors';
import { ExecutionRequest } from '../../domain/execution-request';
import { ToolExecutor } from '../tool/tool-executor';
import { Message } from '../../domain/message';
import { WorkspaceMemory } from '../../contracts/workspace-memory';
import { MemoryContextBuilder } from '../../contracts/memory-context-builder';
import { ExecutionLogger } from '../observability/execution-logger';
import { createHash } from 'crypto';

export class TaskExecutor {
  constructor(
    private readonly promptBuilder: PromptBuilder,
    private readonly providerRegistry: ProviderRegistry,
    private readonly toolExecutor: ToolExecutor,
    private readonly workspaceMemory?: WorkspaceMemory,
    private readonly memoryContextBuilder?: MemoryContextBuilder
  ,
    private readonly sessionManager?: SessionManager,
    private readonly reflectionEngine?: ReflectionEngine
  ) {}

  /** R2.23: forwards the tool executor's mutation evidence to the workflow. */
  drainMutationLedger() {
    return this.toolExecutor.drainMutationLedger();
  }

  peekMutationLedger() {
    return this.toolExecutor.peekMutationLedger();
  }

  async execute(request: ExecutionRequest): Promise<ModelResponse> {
    try {
      if (request.sessionId) {
      await this.sessionManager?.recordEvent(request.sessionId, 'STEP_STARTED', 'Task execution started', { model: request.model });
    }
    const enrichedContext = await this.enrichContextWithMemory(request);
    ExecutionLogger.log('EXECUTION', request.role?.getName?.() ?? 'coder', request.model, `Building prompt for task`);

    const promptDoc = await this.promptBuilder.buildPrompt(
      enrichedContext,
      request.role,
      request.history
    );
    const _sysMsg = promptDoc.messages.find(m => m.role === 'system');
    const _userMsg = promptDoc.messages.find(m => m.role === 'user');
    const _sysStr = typeof _sysMsg?.content === 'string' ? _sysMsg.content : JSON.stringify(_sysMsg?.content ?? '');
    const _userStr = typeof _userMsg?.content === 'string' ? _userMsg.content : JSON.stringify(_userMsg?.content ?? '');
    ExecutionLogger.logPrompt(request.role?.getName?.() ?? 'coder', request.model, _sysStr, _userStr);

    const provider = this.providerRegistry.get(request.providerId);
    if (!provider) {
      throw new ProviderError(`Provider not found: ${request.providerId}`);
    }

    let messages: Message[] = [...promptDoc.messages];
    let iterations = 0;
    const MAX_ITERATIONS = 50;
    const MAX_PROVIDER_RETRIES = 3;
    const RETRY_BASE_DELAY_MS = 2000;
    let lastToolCallsJson = '';
    const consecutiveIdenticalCalls = new Map<string, number>();

    while (true) {
      if (iterations >= MAX_ITERATIONS) {
        throw new ProviderError(`Tool execution loop exceeded maximum iterations (${MAX_ITERATIONS})`);
      }

      // Retry with exponential backoff on provider errors
      let response: ModelResponse | null = null;
      let lastProviderError = '';
      for (let retryAttempt = 0; retryAttempt <= MAX_PROVIDER_RETRIES; retryAttempt++) {
        try {
          const modelRequest: ModelRequest = {
            messages,
            model: request.model,
            tools: request.tools,
            signal: request.signal,
            observability: {
              stage: 'executor',
              retryAttempt,
            },
          };
          response = await provider.generate(modelRequest);
          break;
        } catch (providerError: any) {
          lastProviderError = providerError.message || String(providerError);
          // Failover cascade already exhausted all candidates — do not re-cascade.
          if (providerError instanceof ProviderExhaustedError) {
            ExecutionLogger.log('EXECUTION', 'coder', request.model,
              `Provider exhausted (no further retries): ${lastProviderError}`,
              { iteration: iterations + 1, retryAttempt });
            throw providerError;
          }
          const isRetryable = lastProviderError.includes('500') ||
            lastProviderError.includes('502') ||
            lastProviderError.includes('503') ||
            lastProviderError.includes('504') ||
            lastProviderError.includes('timeout') ||
            lastProviderError.includes('ECONNRESET') ||
            lastProviderError.includes('ECONNREFUSED') ||
            lastProviderError.includes('Internal Server Error') ||
            lastProviderError.includes('fetch failed');

          if (!isRetryable || retryAttempt >= MAX_PROVIDER_RETRIES) {
            ExecutionLogger.log('EXECUTION', 'coder', request.model,
              `Provider error (non-retryable or max retries): ${lastProviderError}`,
              { iteration: iterations + 1, retryAttempt });
            throw providerError;
          }

          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, retryAttempt);
          ExecutionLogger.log('EXECUTION', 'coder', request.model,
            `Provider error, retrying in ${delayMs}ms (attempt ${retryAttempt + 1}/${MAX_PROVIDER_RETRIES}): ${lastProviderError}`,
            { iteration: iterations + 1, retryAttempt, delayMs });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      if (!response) {
        throw new ProviderError(`Provider failed after ${MAX_PROVIDER_RETRIES} retries: ${lastProviderError}`);
      }

      ExecutionLogger.logResponse(request.role?.getName?.() ?? 'coder', request.model, response.content, response.toolCalls?.length ?? 0);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (request.sessionId) {
        await this.sessionManager?.recordEvent(request.sessionId, 'STEP_COMPLETED', 'Task execution completed successfully');
      }
      return response;
      }

      // Compare name+arguments only (id changes every call due to fallback parsing)
      const currentToolCallsKey = (response.toolCalls || [])
        .map((tc: any) => tc.name + ':' + tc.arguments)
        .join('|');
      
      // Track consecutive identical tool calls with nudge mechanism
      const LOOP_THRESHOLD = 4;      // Fallback: throw after 4 consecutive identical calls
      const NUDGE_THRESHOLD = 2;     // Nudge LLM after 2 consecutive identical calls
      const HARD_STOP_THRESHOLD = 4; // Hard stop after this many identical calls
      
      // ENHANCED: Semantic loop detection (same call + same result = redundant)
      const SEMANTIC_LOOP_THRESHOLD = 2; // Fail if same call+result twice
      
      // ENHANCED: Progress tracking (detect busy-work loops)
      const PROGRESS_TOOLS = new Set([
        'write_file', 'apply_patch', 'create_file', 'delete_file',
        'modify_file', 'update_file', 'append_file'
      ]);
      const MAX_ITERATIONS_WITHOUT_PROGRESS = 8;
      
      // ENHANCED: Track previous tool results for semantic detection
      let lastToolResultsHash = '';
      let iterationsWithoutProgress = 0;
      
      /** Compute stable hash of tool results (order-independent for args) */
      const hashToolResults = (results: ReadonlyArray<any>): string => {
        try {
          const normalized = results.map(r => ({
            id: r.toolCallId,
            isError: r.isError,
            // Truncate to avoid huge hashes; first 2000 chars is enough
            content: (r.content || '').substring(0, 2000),
          }));
          return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').substring(0, 16);
        } catch {
          return '';
        }
      };
      
      const identicalCallCount = consecutiveIdenticalCalls.get(currentToolCallsKey) || 0;
      const newCount = identicalCallCount + 1;
      
      if (newCount >= LOOP_THRESHOLD) {
        ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
          'Infinite tool loop detected: ' + newCount + ' consecutive identical calls',
          { toolCallKey: currentToolCallsKey, threshold: LOOP_THRESHOLD }
        );
        throw new ProviderError(
          'Infinite tool loop detected: "' + currentToolCallsKey + '" called ' + newCount + ' times consecutively'
        );
      }
      
      // ENHANCED: Semantic redundancy detection
      // (Same tool+args called again AND previous result was identical → agent is stuck)
      // This is checked AFTER tool execution (below), not here.
      
      // Update counter: increment if same, reset others
      if (currentToolCallsKey === lastToolCallsJson) {
        consecutiveIdenticalCalls.set(currentToolCallsKey, newCount);
        
        if (newCount === NUDGE_THRESHOLD) {
          // NUDGE: Tell LLM to try something different
          ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
            'Identical tool call repeated (' + newCount + 'x) - sending nudge to LLM',
            { toolCallKey: currentToolCallsKey.substring(0, 60) }
          );
          messages.push({
            role: 'system',
            content: 'WARNING: You are repeating the same tool call. Please try a DIFFERENT tool, explore different paths, or provide your final answer. Do not repeat the same tool call again.'
          });
        } else if (newCount === 3) {
          // STRONGER NUDGE: Last chance before throw
          ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
            'Identical tool call repeated (' + newCount + 'x) - sending final warning',
            { toolCallKey: currentToolCallsKey.substring(0, 60) }
          );
          messages.push({
            role: 'system',
            content: 'CRITICAL WARNING: You have called the same tool 3 times. If you repeat it one more time, execution will fail. Please use a completely different approach or provide your final answer NOW.'
          });
        } else if (newCount >= HARD_STOP_THRESHOLD) {
          // HARD STOP: Too many identical calls, fail immediately
          ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
            'HARD STOP: Tool "' + currentToolCallsKey.substring(0, 60) + '" called ' + newCount + ' times — terminating step',
            { toolCallKey: currentToolCallsKey.substring(0, 60), count: newCount }
          );
          throw new ProviderError(
            'HARD_STOP_TOOL_LOOP: Tool "' + currentToolCallsKey.substring(0, 80) + '" called ' + newCount + ' times identically. Step terminated. Please break down the task into smaller steps or try a different approach.'
          );
        }
      } else {
        // Different tool call - reset this counter
        consecutiveIdenticalCalls.set(currentToolCallsKey, 1);
      }
      lastToolCallsJson = currentToolCallsKey;

      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls
      });

      const toolResults = await this.toolExecutor.execute(response.toolCalls, request.sessionId, request.contract, request.executionMode ?? 'STANDARD');

      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.content
        });
      }

      // ENHANCED: Semantic redundancy detection (same call + same result = stuck)
      const currentResultsHash = hashToolResults(toolResults);
      if (currentToolCallsKey === lastToolCallsJson && currentResultsHash === lastToolResultsHash && newCount >= SEMANTIC_LOOP_THRESHOLD) {
        ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
          'SEMANTIC_LOOP: Same tool call returned identical result ' + newCount + ' times — agent is stuck, terminating',
          { toolCallKey: currentToolCallsKey.substring(0, 60), resultHash: currentResultsHash }
        );
        throw new ProviderError(
          'SEMANTIC_LOOP_DETECTED: Tool "' + currentToolCallsKey.substring(0, 60) + '" produced identical results ' + newCount + ' times. The previous action did not change the state — please check if the task is already done or use a different approach. Do not repeat the same tool call expecting different results.'
        );
      }
      lastToolResultsHash = currentResultsHash;

      // ENHANCED: Progress tracking (detect busy-work)
      const hasProgressTool = (response.toolCalls || []).some((tc: any) => PROGRESS_TOOLS.has(tc.name));
      if (hasProgressTool) {
        iterationsWithoutProgress = 0;
      } else {
        iterationsWithoutProgress++;
        if (iterationsWithoutProgress === MAX_ITERATIONS_WITHOUT_PROGRESS) {
          ExecutionLogger.log('TASK_EXECUTOR', '-', '-',
            'PROGRESS_WARNING: ' + iterationsWithoutProgress + ' tool calls without any write/modify operation — sending nudge',
            { toolCallKey: currentToolCallsKey.substring(0, 60) }
          );
          messages.push({
            role: 'system',
            content: 'WARNING: You have made ' + iterationsWithoutProgress + ' tool calls without any write/modify/create/apply_patch operation. If your task requires changing files, please make the change now. If your task is already complete or only requires reading, provide your final answer instead of making more read-only calls.'
          });
        }
      }

      iterations++;
    }
    } finally {
      await this.performReflection(request.sessionId);
    }
  }

  private async performReflection(sessionId?: string): Promise<void> {
    if (!sessionId || !this.sessionManager || !this.reflectionEngine) return;
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (session) {
        const reflection = this.reflectionEngine.generate(session);
        await this.sessionManager.recordReflection(sessionId, reflection);
      }
    } catch (err: any) {
      console.warn(`[TaskExecutor] Reflection phase failed: ${err.message}`);
    }
  }

  private async enrichContextWithMemory(request: ExecutionRequest): Promise<typeof request.context> {
    if (request.memoryEnabled === false) {
      return request.context;
    }

    if (!this.workspaceMemory || !this.memoryContextBuilder) {
      return request.context;
    }

    try {
      const knowledge = await this.workspaceMemory.load();

      if (knowledge.isEmpty) {
        return request.context;
      }

      const memoryContext = this.memoryContextBuilder.build(knowledge);

      if (!memoryContext || memoryContext.length === 0) {
        return request.context;
      }

      return {
        ...request.context,
        knowledge: [
          ...(request.context.knowledge || []),
          {
            id: 'workspace-memory',
            content: memoryContext,
            filePath: 'memory://workspace',
          },
        ],
      };
    } catch (error: any) {
      console.warn(
        `[TaskExecutor] Warning: Memory loading failed, continuing without memory. ` +
        `Error: ${error.message}`
      );
      return request.context;
    }
  }
}
