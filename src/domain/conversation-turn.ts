import { Role } from '../contracts/role';
import { ProviderId } from './provider-id';
import { ToolDefinition } from '../contracts/provider';

/**
 * Represents a single turn in a conversation.
 * Used by ConversationOrchestrator to execute a complete request-response cycle.
 */
export interface ConversationTurn {
  readonly sessionId: string;
  readonly message: string;
  readonly role: Role;
  readonly providerId: ProviderId;
  readonly model: string;
  readonly tools?: ReadonlyArray<Readonly<ToolDefinition>>;
  readonly signal?: AbortSignal;
  readonly planningEnabled?: boolean;
}

/**
 * Represents the response from a completed conversation turn.
 */
export interface ConversationResponse {
  readonly content: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly metadata?: Readonly<Record<string, string>>;
}
