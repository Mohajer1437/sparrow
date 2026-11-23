import { ToolCall } from './tool';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export type MessageContentPart = TextPart;

export interface Message {
  readonly role: MessageRole;
  readonly content: string | ReadonlyArray<Readonly<MessageContentPart>>;
  readonly tool_calls?: ReadonlyArray<Readonly<ToolCall>>;
  readonly tool_call_id?: string;
  readonly name?: string;
}
