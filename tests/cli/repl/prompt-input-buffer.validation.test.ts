/**
 * Focused behavioral validation for PromptInputBuffer + REPL SIGINT wiring.
 * Does not modify production code — validation-only coverage of scenarios 1–6.
 */
import {
  DEFAULT_PROMPT_DEBOUNCE_MS,
  PromptInputBuffer,
  isImmediateCliInput,
} from '../../../src/cli/repl/prompt-input-buffer';
import { replCommand } from '../../../src/cli/repl/repl';
import * as readline from 'readline';
import { AppFactory } from '../../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../../src/cli/workspace-resolver';

describe('PromptInputBuffer behavioral validation', () => {
  let committed: string[];
  let commitCount: number;
  let buffer: PromptInputBuffer;

  beforeEach(() => {
    jest.useFakeTimers();
    committed = [];
    commitCount = 0;
    buffer = new PromptInputBuffer({
      debounceMs: DEFAULT_PROMPT_DEBOUNCE_MS,
      onCommit: (prompt) => {
        commitCount += 1;
        committed.push(prompt);
      },
    });
  });

  afterEach(() => {
    buffer.cancel();
    jest.useRealTimers();
  });

  describe('1. single-line prompt', () => {
    it('executes exactly once after debounce timeout', async () => {
      expect(buffer.push('Add includeHidden to ListDirectoryTool')).toEqual({ kind: 'buffered' });
      expect(commitCount).toBe(0);

      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS - 1);
      expect(commitCount).toBe(0);

      jest.advanceTimersByTime(1);
      expect(commitCount).toBe(1);
      expect(committed).toEqual(['Add includeHidden to ListDirectoryTool']);
      await Promise.resolve();
      expect(buffer.hasPending()).toBe(false);
    });
  });

  describe('2. true multiline prompt', () => {
    it('becomes one execution with newlines and no partial commits', () => {
      buffer.push('line 1');
      expect(commitCount).toBe(0);
      buffer.push('line 2');
      expect(commitCount).toBe(0);
      buffer.push('line 3');
      expect(commitCount).toBe(0);

      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);

      expect(commitCount).toBe(1);
      expect(committed[0]).toBe('line 1\nline 2\nline 3');
      expect(committed[0].includes('\n')).toBe(true);
      expect(committed[0].split('\n')).toEqual(['line 1', 'line 2', 'line 3']);
    });
  });

  describe('3. rapid consecutive input burst', () => {
    it('merges all lines within the window into a single prompt', () => {
      const bursts = ['alpha', 'beta', 'gamma', 'delta'];
      for (const line of bursts) {
        buffer.push(line);
        jest.advanceTimersByTime(200); // still inside 1000ms window
      }

      expect(commitCount).toBe(0);
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
      expect(commitCount).toBe(1);
      expect(committed).toEqual(['alpha\nbeta\ngamma\ndelta']);
    });
  });

  describe('4. slow multiline input', () => {
    it('executes first line independently, then second as a new prompt', async () => {
      buffer.push('first independent prompt');
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS + 50);
      expect(committed).toEqual(['first independent prompt']);
      expect(commitCount).toBe(1);
      await Promise.resolve();

      buffer.push('second independent prompt');
      expect(commitCount).toBe(1);
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
      expect(commitCount).toBe(2);
      expect(committed).toEqual([
        'first independent prompt',
        'second independent prompt',
      ]);
    });
  });

  describe('5. CLI command bypass', () => {
    it('executes /help, /model, /exit immediately and never commits them', () => {
      for (const cmd of ['/help', '/model', '/exit']) {
        expect(isImmediateCliInput(cmd)).toBe(true);
        expect(buffer.push(cmd)).toEqual({ kind: 'immediate', text: cmd });
      }
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
      expect(committed).toEqual([]);
      expect(commitCount).toBe(0);
    });

    it('cancels pending prompt buffer when a command arrives', () => {
      buffer.push('draft that must not execute');
      buffer.push('more draft');
      expect(buffer.hasPending()).toBe(true);

      expect(buffer.push('/help')).toEqual({ kind: 'immediate', text: '/help' });
      expect(buffer.hasPending()).toBe(false);
      expect(buffer.peek()).toBe('');

      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS * 2);
      expect(committed).toEqual([]);
    });
  });

  describe('6. Ctrl+C / cancel behavior (buffer)', () => {
    it('clears pending buffer without executing', () => {
      buffer.push('pending text');
      buffer.push('more pending');
      buffer.cancel();

      expect(buffer.hasPending()).toBe(false);
      expect(buffer.peek()).toBe('');
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS * 2);
      expect(committed).toEqual([]);
    });

    it('cancel with empty buffer is a no-op', () => {
      expect(buffer.hasPending()).toBe(false);
      buffer.cancel();
      expect(buffer.hasPending()).toBe(false);
      jest.advanceTimersByTime(DEFAULT_PROMPT_DEBOUNCE_MS);
      expect(committed).toEqual([]);
    });
  });
});

jest.mock('../../../src/core/app-factory');
jest.mock('../../../src/cli/workspace-resolver');
jest.mock('readline');

describe('6. Ctrl+C REPL SIGINT wiring', () => {
  let mockRl: any;
  let lineHandler: (line: string) => Promise<void>;
  let closeHandler: () => void;
  let sigintHandler: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    mockRl = {
      prompt: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'line') lineHandler = cb;
        if (event === 'close') closeHandler = cb;
        if (event === 'SIGINT') sigintHandler = cb;
      }),
      close: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
    };

    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
    (resolveWorkspaceRoot as jest.Mock).mockResolvedValue('/test/workspace');

    (AppFactory as jest.MockedClass<typeof AppFactory>).mockImplementation(() => ({
      createConfiguration: () => ({ load: jest.fn().mockResolvedValue({}) }),
      createConversationOrchestrator: () => ({
        handleTurn: jest.fn().mockResolvedValue({ content: 'AI Response' }),
      }),
      createSession: () => ({
        start: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      }),
      createToolDefinitions: jest.fn().mockReturnValue([]),
      createRoleAssignmentService: () => ({
        reload: jest.fn().mockResolvedValue(undefined),
        getAssignment: jest.fn().mockResolvedValue(undefined),
      }),
    } as any));
  });

  it('SIGINT with pending buffer cancels input and does not close REPL', async () => {
    const replPromise = replCommand();
    await new Promise((r) => setTimeout(r, 50));

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await lineHandler('buffered but cancelled');
    // Still inside debounce window
    sigintHandler();

    expect(logSpy).toHaveBeenCalledWith('\n(input cancelled)');
    expect(mockRl.close).not.toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();

    // Ensure cancelled text does not execute after timeout
    await new Promise((r) => setTimeout(r, 1100));
    expect(logSpy).not.toHaveBeenCalledWith('AI Response');

    logSpy.mockRestore();
    closeHandler();
    await replPromise;
  });

  it('SIGINT without pending buffer closes REPL (prior exit behavior)', async () => {
    const replPromise = replCommand();
    await new Promise((r) => setTimeout(r, 50));

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    sigintHandler();

    expect(logSpy).toHaveBeenCalledWith('\nGoodbye!');
    expect(mockRl.close).toHaveBeenCalled();

    logSpy.mockRestore();
    closeHandler();
    await replPromise;
  });
});
