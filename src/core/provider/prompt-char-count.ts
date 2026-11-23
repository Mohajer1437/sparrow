import { Message } from '../../domain/message';

/**
 * Deterministic prompt size for PROVIDER_META.promptChars (provider-agnostic).
 *
 * Rule: sum of textual message content lengths across all messages.
 * - string content → content.length
 * - multipart content → sum of part.text.length for type === 'text'
 * Does NOT include: tool definitions, tool_call argument JSON, response tokens,
 * or non-text content parts.
 */
export function countPromptChars(messages: ReadonlyArray<Readonly<Message>>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          total += part.text.length;
        }
      }
    }
  }
  return total;
}
