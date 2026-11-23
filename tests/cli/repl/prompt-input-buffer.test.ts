import {
  DEFAULT_PROMPT_DEBOUNCE_MS,
  PromptInputBuffer,
  isImmediateCliInput,
} from '../../../src/cli/repl/prompt-input-buffer';

describe('isImmediateCliInput', () => {
  it('treats slash commands as immediate', () => {
    expect(isImmediateCliInput('/help')).toBe(true);
    expect(isImmediateCliInput('/exit')).toBe(true);
    expect(isImmediateCliInput('/model list')).toBe(true);
  });

  it('treats free-text prompts as non-immediate', () => {
    expect(isImmediateCliInput('fix the bug')).toBe(false);
    expect(isImmediateCliInput('line one')).toBe(false);
  });

  it('ignores blank lines', () => {
    expect(isImmediateCliInput('')).toBe(false);
    expect(isImmediateCliInput('   ')).toBe(false);
  });
});

describe('PromptInputBuffer', () => {
  let committed: string[];
  let buffer: PromptInputBuffer;

  beforeEach(() => {
    jest.useFakeTimers();
    committed = [];
    buffer = new PromptInputBuffer({
      debounceMs: DEFAULT_PROMPT_DEBOUNCE_MS,
      onCommit: (prompt) => {
        committed.push(prompt);
      },
    });
  });

  afterEach(() => {
    buffer.cancel();
    jest.useRealTimers();
  });

  it('commits a single-line prompt after debounce', async () => {
    expect(buffer.push('fix the flaky test')).toEqual({ kind: 'buffered' });
    expect(committed).toEqual([]);
    expect(buffer.hasPending()).toBe(true);

    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS - 1);
    expect(committed).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(committed).toEqual(['fix the flaky test']);
    await Promise.resolve();
    expect(buffer.hasPending()).toBe(false);
  });

  it('preserves multiline formatting across Enter presses', () => {
    buffer.push('First line');
    buffer.push('Second line');
    buffer.push('');
    buffer.push('Fourth after blank');

    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);

    expect(committed).toEqual(['First line\nSecond line\n\nFourth after blank']);
  });

  it('merges rapid consecutive inputs into one prompt', () => {
    buffer.push('part A');
    jest.advanceTimersByTime(400);
    buffer.push('part B');
    jest.advanceTimersByTime(400);
    buffer.push('part C');

    expect(committed).toEqual([]);
    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
    expect(committed).toEqual(['part A\npart B\npart C']);
  });

  it('bypasses buffering for CLI commands', () => {
    const help = buffer.push('/help');
    expect(help).toEqual({ kind: 'immediate', text: '/help' });
    expect(buffer.hasPending()).toBe(false);

    const model = buffer.push('/model');
    expect(model).toEqual({ kind: 'immediate', text: '/model' });

    const exit = buffer.push('/exit');
    expect(exit).toEqual({ kind: 'immediate', text: '/exit' });

    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
    expect(committed).toEqual([]);
  });

  it('cancels a pending command-interrupted prompt without committing', () => {
    buffer.push('draft prompt');
    expect(buffer.peek()).toBe('draft prompt');

    const cmd = buffer.push('/status');
    expect(cmd).toEqual({ kind: 'immediate', text: '/status' });
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.peek()).toBe('');

    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
    expect(committed).toEqual([]);
  });

  it('cancel() discards buffered input safely (Ctrl+C)', () => {
    buffer.push('line 1');
    buffer.push('line 2');
    expect(buffer.hasPending()).toBe(true);

    buffer.cancel();
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.peek()).toBe('');

    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
    expect(committed).toEqual([]);
  });

  it('ignores leading blank lines when nothing is pending', () => {
    expect(buffer.push('')).toEqual({ kind: 'ignored' });
    expect(buffer.push('   ')).toEqual({ kind: 'ignored' });
    jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
    expect(committed).toEqual([]);
  });

  it('awaits async onCommit before clearing committing state', async () => {
    let resolveCommit!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });

    const asyncBuffer = new PromptInputBuffer({
      debounceMs: 100,
      onCommit: async (prompt) => {
        committed.push(prompt);
        await done;
      },
    });

    asyncBuffer.push('async prompt');
    jest.advanceTimersByTime(100);
    expect(committed).toEqual(['async prompt']);
    expect(asyncBuffer.hasPending()).toBe(true);

    resolveCommit();
    await Promise.resolve();
    await Promise.resolve();
    expect(asyncBuffer.hasPending()).toBe(false);
  });
});
