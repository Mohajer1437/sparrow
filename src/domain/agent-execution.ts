import { CorrelationContext } from './correlation';
import { ConfirmationRequest } from './confirmation';
import { ExecutionMode } from './execution-mode';
import { PatchRequest } from './patch';

export interface AgentExecutionRequest {
  readonly roleId: string;
  readonly task: string;
  readonly targetFiles?: ReadonlyArray<string>;
  readonly patchRequest?: PatchRequest;
  /** R1.18: explicit execution mode chosen by the interface, not the model. */
  readonly executionMode?: ExecutionMode;
  /** R5: optional confirmation request id to resume or validate */
  readonly confirmationRequestId?: string;
  /** R5: optional interactive confirmation callback for CLI/REPL */
  readonly onConfirmationRequested?: (request: ConfirmationRequest) => Promise<boolean>;
  /** R6: authoritative run correlation context */
  readonly correlationContext?: CorrelationContext;
  readonly taskId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
}

export interface AgentExecutionResult {
  readonly roleId: string;
  readonly success: boolean;
  readonly workflowResult: unknown;
  readonly error?: string;
  readonly correlationContext?: CorrelationContext;
  readonly runId?: string;
}
