import { Message } from '../domain/message';
import { ToolCall } from '../domain/tool';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Lightweight stage label for PROVIDER_META correlation (not sent to the model API). */
export type ProviderCallStage =
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'verification'
  | 'repair'
  | 'unknown';

/**
 * Observability-only fields for provider HTTP attempts.
 * Must never be serialized into the upstream model request body.
 */
export interface ProviderCallObservability {
  readonly stage?: ProviderCallStage;
  /** Existing caller retry counter (0 = first attempt). */
  readonly retryAttempt?: number;
}

export interface ModelRequest {
  readonly messages: ReadonlyArray<Readonly<Message>>;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<Readonly<ToolDefinition>>;
  readonly signal?: AbortSignal;
  /** Not part of the model API payload — used only for PROVIDER_META logging. */
  readonly observability?: ProviderCallObservability;
}

export interface ModelResponse {
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<Readonly<ToolCall>>;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface Provider {
  generate(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Optional non-completion health probe (tags/models endpoints).
   * Must not call chat completion APIs or consume model tokens.
   */
  checkHealth?(
    options?: import('../domain/provider-health').ProviderHealthOptions,
  ): Promise<import('../domain/provider-health').ProviderHealthResult>;
}
