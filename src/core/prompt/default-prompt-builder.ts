import { PromptBuilder } from '../../contracts/prompt';
import { ContextObject } from '../../domain/context';
import { PromptDocument } from '../../domain/prompt-document';
import { Role } from '../../contracts/role';
import { Message } from '../../domain/message';

export class DefaultPromptBuilder implements PromptBuilder {
  async buildPrompt(
    context: ContextObject,
    role: Role,
    history?: ReadonlyArray<Readonly<Message>>
  ): Promise<PromptDocument> {
    const messages: Message[] = [];

    // 1. System message
    const systemPrompt = role.getConfig().systemPrompt;
    if (systemPrompt && systemPrompt.trim().length > 0) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // 2. History
    const hasHistory = history && history.length > 0;
    if (hasHistory) {
      for (const msg of history) {
        messages.push(msg);
      }
    }

    // 3. Current context as user message
    const userContent = this.formatContext(context);
    
    // Append user message if there is actual context, 
    // or if we are in a multi-turn conversation (has history).
    if (userContent.trim().length > 0 || hasHistory) {
      messages.push({
        role: 'user',
        content: userContent
      });
    }

    // Return deeply immutable PromptDocument
    return Object.freeze({
      messages: Object.freeze(messages.map(m => Object.freeze({ ...m })))
    });
  }

  private formatContext(context: ContextObject): string {
    const parts: string[] = [];

    if (context.taskIntent && context.taskIntent.trim().length > 0) {
      parts.push(`# Task\n${context.taskIntent}`);
    }

    if (context.rules && context.rules.length > 0) {
      parts.push(`# Rules\n${context.rules.map(r => `- ${r.content}`).join('\n')}`);
    }

    if (context.knowledge && context.knowledge.length > 0) {
      parts.push(`# Knowledge\n${context.knowledge.map(k => `- ${k.content}`).join('\n')}`);
    }

    if (context.memories && context.memories.length > 0) {
      const memStr = context.memories.map(m => {
        const val = typeof m.value === 'string' ? m.value : JSON.stringify(m.value);
        return `- ${m.key}: ${val}`;
      }).join('\n');
      parts.push(`# Memories\n${memStr}`);
    }

    if (context.files && context.files.length > 0) {
      const filesStr = context.files.map(f => `## ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      parts.push(`# Files\n${filesStr}`);
    }

    return parts.join('\n\n');
  }
}
