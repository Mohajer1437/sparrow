/**
 * CLI-layer debounce buffer for multiline prompts.
 *
 * Readline delivers one line per ENTER. This component waits `debounceMs`
 * after each line and merges subsequent lines into one prompt before the
 * caller executes. Slash / known CLI commands bypass the buffer.
 *
 * Does not touch Planner, Executor, or TaskExecutionService.
 */

import { parseCommand } from './command-parser';

export const DEFAULT_PROMPT_DEBOUNCE_MS = 1000;

export type PromptInputBufferTimers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

export type PromptInputBufferOptions = {
  readonly debounceMs?: number;
  /** Invoked once when the debounce window expires with a non-empty prompt. */
  readonly onCommit: (prompt: string) => void | Promise<void>;
  /** Override command detection (defaults to parseCommand type !== 'ask'). */
  readonly isImmediateCommand?: (line: string) => boolean;
  readonly timers?: PromptInputBufferTimers;
};

export type PushResult =
  | { readonly kind: 'immediate'; readonly text: string }
  | { readonly kind: 'buffered' }
  | { readonly kind: 'ignored' };

/** True for slash / known CLI commands; false for free-text ask prompts. */
export function isImmediateCliInput(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return parseCommand(line).type !== 'ask';
}

export class PromptInputBuffer {
  private readonly debounceMs: number;
  private readonly onCommit: (prompt: string) => void | Promise<void>;
  private readonly isImmediateCommand: (line: string) => boolean;
  private readonly timers: PromptInputBufferTimers;

  private parts: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private committing = false;

  constructor(options: PromptInputBufferOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_PROMPT_DEBOUNCE_MS;
    this.onCommit = options.onCommit;
    this.isImmediateCommand = options.isImmediateCommand ?? isImmediateCliInput;
    this.timers = options.timers ?? { setTimeout, clearTimeout };
  }

  /** Whether a debounce window is open or a commit is in flight. */
  hasPending(): boolean {
    return this.parts.length > 0 || this.timer !== null || this.committing;
  }

  /** Current buffered text (joined with newlines), or empty string. */
  peek(): string {
    return this.parts.join('\n');
  }

  /**
   * Accept one readline line.
   * - immediate: caller should run executeInput(text) now (commands)
   * - buffered: waiting for debounce; onCommit will fire later
   * - ignored: empty line with nothing pending
   */
  push(line: string): PushResult {
    if (this.isImmediateCommand(line)) {
      this.cancel();
      return { kind: 'immediate', text: line };
    }

    const isBlank = line.trim().length === 0;
    if (isBlank && this.parts.length === 0) {
      return { kind: 'ignored' };
    }

    this.parts.push(line);
    this.armTimer();
    return { kind: 'buffered' };
  }

  /** Discard buffered input and clear the debounce timer (Ctrl+C). */
  cancel(): void {
    this.clearTimer();
    this.parts = [];
  }

  private armTimer(): void {
    this.clearTimer();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.commit();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async commit(): Promise<void> {
    if (this.parts.length === 0) return;
    const prompt = this.parts.join('\n');
    this.parts = [];
    this.committing = true;
    try {
      await this.onCommit(prompt);
    } finally {
      this.committing = false;
    }
  }
}
