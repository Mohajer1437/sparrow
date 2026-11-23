import { ContextObject } from '../domain/context';
import { PromptDocument } from '../domain/prompt-document';
import { Role } from './role';
import { Message } from '../domain/message';

export interface PromptBuilder {
  buildPrompt(
    context: ContextObject,
    role: Role,
    history?: ReadonlyArray<Readonly<Message>>
  ): Promise<PromptDocument>;
}
