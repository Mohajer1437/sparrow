import { Message } from './message';

export interface PromptDocument {
  readonly messages: ReadonlyArray<Readonly<Message>>;
}
