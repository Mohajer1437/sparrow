import { SessionManager } from '../session/session-manager';
import { sanitizeToolArguments } from './argument-sanitizer';
import { ToolPolicy } from '../../contracts/tool-policy';
import { ToolExecutionContext } from '../../domain/tool-policy';
import { ToolRegistry } from '../../contracts/tool-registry';
import { ToolCall, ToolResult } from '../../domain/tool';
import { ExecutionContract } from '../../domain/pre-execution/contract';
import { ExecutionLogger } from '../observability/execution-logger';
import { ExecutionMode, READ_ONLY_BLOCK_REASON, evaluateToolAgainstMode } from '../../domain/execution-mode';
import { MutationGuard, MutationGuardContext } from '../execution/mutation/mutation-guard';
import {
  MutationLedger,
  MutationUnitResult,
  buildMutationLedger,
} from '../../domain/execution/mutation-safety';

/**
 * ToolExecutor is responsible for executing a sequence of ToolCalls
 * using the tools registered in the ToolRegistry.
 * 
 * Execution Rules:
 * - Executes tool calls sequentially in order
 * - Continues execution even if individual tools fail
 * - Returns ToolResult with isError=true for failed tools
 * - Does not retry or apply timeouts
 * 
 * The executor only throws if the registry itself cannot operate,
 * not for individual tool failures.
 */
export class ToolExecutor {
  /**
   * R2.2: the single mutation safety boundary. Every mutating tool call is
   * wrapped by the same guard here rather than each tool carrying its own
   * checks, so there is one policy and one place that can rollback.
   */
  private readonly mutationGuard = new MutationGuard();
  private readonly mutationUnits: MutationUnitResult[] = [];

  constructor(
    private readonly registry: ToolRegistry,
    private readonly sessionManager?: SessionManager,
    private readonly policy?: ToolPolicy,
    private readonly workspacePath?: string
  ) {}

  /** R2.23: run-level mutation evidence accumulated since the last drain. */
  drainMutationLedger(): MutationLedger {
    const ledger = buildMutationLedger(this.mutationUnits);
    this.mutationUnits.length = 0;
    return ledger;
  }

  /** Non-destructive view of the same evidence. */
  peekMutationLedger(): MutationLedger {
    return buildMutationLedger(this.mutationUnits);
  }

  async execute(
    toolCalls: ReadonlyArray<ToolCall>,
    sessionId?: string,
    contract?: ExecutionContract,
    executionMode: ExecutionMode = 'STANDARD',
  ): Promise<ReadonlyArray<ToolResult>> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const startTime = performance.now();
      ExecutionLogger.log('TOOL', '-', '-', `Executing tool: ${toolCall.name}`, { args: toolCall.arguments?.substring(0, 200) });
      const tool = this.registry.get(toolCall.name);
      
      if (!tool) {
        const durationMs = performance.now() - startTime;
        this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool not found: ${toolCall.name}`, {
          toolName: toolCall.name,
          durationMs,
          success: false,
          error: 'Tool not found'
        });
        results.push({ toolCallId: toolCall.id, content: `Tool not found: ${toolCall.name}`, isError: true });
        continue;
      }

      // R1.20: mode enforcement runs before any policy so a missing or
      // permissive ToolPolicy can never open a hole in READ_ONLY.
      const modeDecision = evaluateToolAgainstMode(executionMode, toolCall.name);
      if (!modeDecision.allowed) {
        const durationMs = performance.now() - startTime;
        this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool blocked by execution mode: ${toolCall.name}`, {
          toolName: toolCall.name,
          durationMs,
          success: false,
          error: modeDecision.reason,
          executionMode,
        });
        ExecutionLogger.log('EXECUTION_MODE', '-', '-', `BLOCKED ${toolCall.name}`, {
          executionMode,
          toolName: toolCall.name,
          reason: READ_ONLY_BLOCK_REASON,
        });
        results.push({ toolCallId: toolCall.id, content: `${modeDecision.reason}`, isError: true });
        continue;
      }

      // Policy check
      if (this.policy) {
        const policyContext: ToolExecutionContext = {
          toolName: toolCall.name,
          arguments: JSON.parse(toolCall.arguments || '{}'),
          sessionId,
          executionMode,
        };
        
        const decision = this.policy.evaluate(policyContext);
        
        if (decision.permission === 'DENY') {
          const durationMs = performance.now() - startTime;
          const reason = decision.evidence.map(e => e.reason).join('; ');
          this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool denied by policy: ${toolCall.name}`, {
            toolName: toolCall.name,
            durationMs,
            success: false,
            error: `Policy denied: ${reason}`,
            policyEvidence: decision.evidence
          });
          results.push({ toolCallId: toolCall.id, content: `Tool execution denied by policy: ${reason}`, isError: true });
          continue;
        }
        
        if (decision.permission === 'REQUIRE_CONFIRMATION') {
          const durationMs = performance.now() - startTime;
          const reason = decision.evidence.map(e => e.reason).join('; ');
          this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool requires confirmation: ${toolCall.name}`, {
            toolName: toolCall.name,
            durationMs,
            success: false,
            error: `Requires confirmation: ${reason}`,
            policyEvidence: decision.evidence
          });
          results.push({ toolCallId: toolCall.id, content: `Tool requires confirmation: ${reason}`, isError: true });
          continue;
        }
      }

      // Stage 7: Contract-based policy enforcement
      if (contract) {
        const rawArgs = JSON.parse(toolCall.arguments || '{}');
        const targetPath = rawArgs.path || rawArgs.filePath || '';
        const mutationTools = ['write_file', 'create_file', 'delete_file', 'apply_patch'];
        const mutationTargets: string[] = [];
        if (targetPath) mutationTargets.push(String(targetPath));
        if (Array.isArray(rawArgs.operations)) {
          for (const operation of rawArgs.operations) {
            if (operation && typeof operation.path === 'string') {
              mutationTargets.push(operation.path);
            }
          }
        }

        // Scope enforcement for mutation tools
        if (mutationTools.includes(toolCall.name) && mutationTargets.length > 0 && contract.filesInScope.length > 0) {
          const outOfScope = mutationTargets.filter(candidate => {
            const normalizedPath = candidate.replace(/\\/g, '/');
            return !contract.filesInScope.some(scopePath => {
              const normalizedScope = scopePath.replace(/\\/g, '/');
              return normalizedPath === normalizedScope
                || normalizedPath.startsWith(normalizedScope + '/')
                || normalizedScope.startsWith(normalizedPath + '/')
                || normalizedPath.endsWith('/' + normalizedScope)
                || normalizedScope.endsWith('/' + normalizedPath);
            });
          });

          if (outOfScope.length > 0) {
            const durationMs = performance.now() - startTime;
            const reason = `Contract scope violation: ${outOfScope.join(', ')} is not in contract filesInScope`;
            this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool denied by contract scope: ${toolCall.name}`, {
              toolName: toolCall.name,
              durationMs,
              success: false,
              error: reason,
              contractId: contract.id,
              filesInScope: contract.filesInScope
            });
            results.push({ toolCallId: toolCall.id, content: `Tool execution denied by contract scope: ${reason}`, isError: true });
            continue;
          }
        }

        // Forbidden actions enforcement
        if (contract.forbiddenActions.length > 0) {
          const toolAction = toolCall.name;
          const isForbidden = contract.forbiddenActions.some(action =>
            action.toLowerCase().includes(toolAction.toLowerCase()) ||
            toolAction.toLowerCase().includes(action.toLowerCase().split(' ')[0])
          );

          if (isForbidden) {
            const durationMs = performance.now() - startTime;
            const reason = `Contract forbidden action: ${toolCall.name}`;
            this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool denied by contract forbidden action: ${toolCall.name}`, {
              toolName: toolCall.name,
              durationMs,
              success: false,
              error: reason,
              contractId: contract.id,
              forbiddenActions: contract.forbiddenActions
            });
            results.push({ toolCallId: toolCall.id, content: `Tool execution denied by contract forbidden action: ${reason}`, isError: true });
            continue;
          }
        }
      }

      try {
        // A.2: Parse and sanitize arguments inside try-catch
        const rawArgs = JSON.parse(toolCall.arguments || '{}');
        const sanitizedArgs = this.workspacePath
          ? sanitizeToolArguments(rawArgs, this.workspacePath)
          : rawArgs;

        // Fix A: Provide authoritative runtime sessionId to tools
        const effectiveArgs = sessionId
          ? { ...sanitizedArgs, sessionId }
          : sanitizedArgs;

        const guardContext = this.buildMutationContext(sessionId, contract, executionMode);
        const guarded = guardContext
          && MutationGuard.describesFileMutation(toolCall.name, effectiveArgs as Record<string, unknown>);

        let result: ToolResult;
        if (guarded) {
          const outcome = await this.mutationGuard.guard(
            { toolName: toolCall.name, args: effectiveArgs as Record<string, unknown>, context: guardContext! },
            async () => {
              const toolResult = await tool.execute(effectiveArgs);
              return { failed: Boolean(toolResult.isError), toolResult };
            },
          );
          this.mutationUnits.push(outcome.unit);
          result = this.describeGuardedMutation(toolCall.name, outcome.unit, outcome.toolOutcome?.toolResult);
        } else {
          result = await tool.execute(effectiveArgs);
        }

        const durationMs = performance.now() - startTime;

        this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool executed: ${toolCall.name}`, {
          toolName: toolCall.name,
          durationMs,
          success: !result.isError,
          metadata: result.isError ? { error: result.content } : {}
        });

        results.push({ toolCallId: toolCall.id, content: result.content, isError: result.isError });
        ExecutionLogger.log('TOOL', '-', '-', `Tool ${toolCall.name} completed in ${durationMs.toFixed(0)}ms`, { success: !result.isError });
      } catch (error: any) {
        const durationMs = performance.now() - startTime;
        this.sessionManager?.recordEvent(sessionId ?? '', 'TOOL_EXECUTED', `Tool failed: ${toolCall.name}`, {
          toolName: toolCall.name,
          durationMs,
          success: false,
          error: error.message
        });
        results.push({ toolCallId: toolCall.id, content: `Tool execution failed: ${error.message}`, isError: true });
      }
    }

    return results;
  }

  /**
   * The guard needs a real workspace root to resolve targets and to restore
   * bytes. Without one there is nothing to protect, so callers that construct
   * a bare executor over in-memory tools keep their existing behaviour.
   */
  private buildMutationContext(
    sessionId: string | undefined,
    contract: ExecutionContract | undefined,
    executionMode: ExecutionMode,
  ): MutationGuardContext | undefined {
    if (!this.workspacePath) return undefined;
    const todoScope = (sessionId ? this.sessionManager?.getExpectedFiles(sessionId) : undefined) ?? [];
    const expectedMarkers = (sessionId ? this.sessionManager?.getExpectedChangeMarkers?.(sessionId) : undefined) ?? [];
    return {
      workspaceRoot: this.workspacePath,
      executionMode,
      todoScope,
      contractScope: contract?.filesInScope ?? [],
      expectedMarkers,
    };
  }

  /**
   * R2.19: the tool's own prose is kept, but the mutation status and the
   * reason it was refused are what the agent and the repair planner see.
   */
  private describeGuardedMutation(
    toolName: string,
    unit: MutationUnitResult,
    toolResult: ToolResult | undefined,
  ): ToolResult {
    if (unit.status === 'APPLIED') {
      const warnings = unit.findings.filter(finding => finding.code === 'DIFF_SUSPICIOUS');
      const base = toolResult?.content ?? `Mutation applied by ${toolName}`;
      return {
        toolCallId: '',
        content: warnings.length === 0
          ? base
          : `${base}\n\nMUTATION_WARNING (SUSPICIOUS_MUTATION): ${warnings.map(w => w.detail).join('; ')}`,
        isError: false,
      };
    }

    const reasons = unit.findings.length > 0
      ? unit.findings.map(finding => `${finding.code}: ${finding.detail}`).join('\n')
      : (toolResult?.content ?? 'mutation refused by the executor mutation safety policy');
    const restored = unit.results.filter(result => result.rolledBack);
    const rollbackNote = restored.length === 0
      ? unit.blockedBeforeWrite ? '\nNo file was modified.' : ''
      : `\nRolled back: ${restored.map(result => `${result.path} (${result.rollbackVerified ? 'restored' : 'ROLLBACK_FAILED'})`).join(', ')}`;

    ExecutionLogger.log('MUTATION', '-', '-', `${unit.status} ${toolName}`, {
      status: unit.status,
      blockedBeforeWrite: unit.blockedBeforeWrite,
      paths: unit.results.map(result => result.path),
      findings: unit.findings,
    });

    return {
      toolCallId: '',
      content: `MUTATION_${unit.status}: ${toolName} was not applied.\n${reasons}${rollbackNote}`,
      isError: true,
    };
  }
}
