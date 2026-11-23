import { ContextObject } from './context';
import { Role } from '../contracts/role';
import { ProviderId } from './provider-id';
import { Message } from './message';
import { ToolDefinition } from '../contracts/provider';
import { ExecutionContract } from './pre-execution/contract';

export interface ExecutionRequest {
  readonly sessionId?: string;
  readonly context: ContextObject;
  readonly role: Role;
  readonly providerId: ProviderId;
  readonly model: string;
  readonly history?: ReadonlyArray<Readonly<Message>>;
  readonly tools?: ReadonlyArray<Readonly<ToolDefinition>>;
  readonly signal?: AbortSignal;
  readonly memoryEnabled?: boolean;
  /** Stage 7: ExecutionContract policy boundary */
  readonly contract?: ExecutionContract;
  /** R1.20: READ_ONLY blocks mutation tools regardless of what the model asks for. */
  readonly executionMode?: import('./execution-mode').ExecutionMode;
}
