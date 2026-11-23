import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OllamaProvider, countPromptChars } from '../../../src/core/provider/ollama-provider';
import { ModelRequest } from '../../../src/contracts/provider';
import { ProviderError } from '../../../src/domain/errors/provider-errors';
import { ExecutionLogger } from '../../../src/core/observability/execution-logger';
import { TaskExecutor } from '../../../src/core/execution/task-executor';
import { KnownProviders } from '../../../src/domain/provider-id';

describe('PROVIDER_META instrumentation', () => {
  let provider: OllamaProvider;
  let fetchMock: jest.Mock;
  let tmpDir: string;
  let originalConsoleLog: typeof console.log;

  const createRequest = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
    model: 'gpt-oss:20b-cloud',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ],
    observability: {
      stage: 'executor',
      retryAttempt: 0,
    },
    ...overrides,
  });

  const readPersistedEvents = (): Array<Record<string, unknown>> => {
    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>);
  };

  const readProviderMeta = (): Array<Record<string, unknown>> =>
    readPersistedEvents().filter(e => e.phase === 'PROVIDER_META');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-provider-meta-'));
    originalConsoleLog = console.log;
    console.log = () => undefined;

    ExecutionLogger.init(tmpDir, 'phase6-meta-fixture');
    ExecutionLogger.setContext({
      runId: 'run-meta-fixture',
      sessionId: 'phase6-meta-fixture',
      taskId: 'task-meta',
    });

    provider = new OllamaProvider('http://localhost:11434');
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test A: successful provider request emits persisted PROVIDER_META', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'gpt-oss:20b-cloud',
        message: { role: 'assistant', content: 'Hi there!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    });

    await provider.generate(createRequest({
      tools: [
        { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
        { name: 'write_file', description: 'Write a file', parameters: { type: 'object' } },
      ],
    }));

    const meta = readProviderMeta();
    expect(meta).toHaveLength(1);
    const event = meta[0];
    expect(event.phase).toBe('PROVIDER_META');
    expect(event.httpStatus).toBe(200);
    expect(event.success).toBe(true);
    expect(event.retryAttempt).toBe(0);
    expect(event.isRetry).toBe(false);
    expect(event.requestSeq).toBe(1);
    expect(typeof event.durationMs).toBe('number');
    expect(event.durationMs as number).toBeGreaterThanOrEqual(0);
    expect(event.model).toBe('gpt-oss:20b-cloud');
    expect(event.messageCount).toBe(2);
    expect(event.promptChars).toBe(countPromptChars([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ]));
    expect(event.toolCount).toBe(2);
    expect(event.stage).toBe('executor');
    expect(event.runId).toBe('run-meta-fixture');
    expect(event.sessionId).toBe('phase6-meta-fixture');
    expect(typeof event.startedAt).toBe('string');
    expect(event.error).toBeUndefined();
  });

  it('Test B: HTTP 500 preserves provider error behavior and meta', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"error":"Internal Server Error (ref: test-ref)"}',
    });

    let thrown: unknown;
    try {
      await provider.generate(createRequest());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    expect(String((thrown as Error).message)).toContain('500');
    expect(String((thrown as Error).message)).toContain('test-ref');

    const meta = readProviderMeta();
    expect(meta).toHaveLength(1);
    const event = meta[0];
    expect(event.httpStatus).toBe(500);
    expect(event.success).toBe(false);
    expect(String(event.error)).toContain('test-ref');
    expect(event.phase).toBe('PROVIDER_META');
  });

  it('Test C: retries get distinct requestSeq and existing retryAttempt', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error (ref: r1)',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error (ref: r2)',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error (ref: r3)',
      });

    for (let retryAttempt = 0; retryAttempt <= 2; retryAttempt++) {
      await expect(
        provider.generate(createRequest({
          observability: { stage: 'executor', retryAttempt },
        }))
      ).rejects.toThrow(ProviderError);
    }

    const meta = readProviderMeta();
    expect(meta).toHaveLength(3);
    expect(meta.map(e => ({
      requestSeq: e.requestSeq,
      retryAttempt: e.retryAttempt,
      isRetry: e.isRetry,
    }))).toEqual([
      { requestSeq: 1, retryAttempt: 0, isRetry: false },
      { requestSeq: 2, retryAttempt: 1, isRetry: true },
      { requestSeq: 3, retryAttempt: 2, isRetry: true },
    ]);
  });

  it('Test C2: TaskExecutor passes existing retryAttempt without changing retry policy', async () => {
    const mockProvider = {
      generate: jest.fn()
        .mockRejectedValueOnce(new ProviderError('Ollama API error: 500 Internal Server Error (ref: te)'))
        .mockRejectedValueOnce(new ProviderError('Ollama API error: 500 Internal Server Error (ref: te)'))
        .mockResolvedValueOnce({ content: 'done', toolCalls: [] }),
    };
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });

    const executor = new TaskExecutor(
      { buildPrompt: jest.fn().mockResolvedValue({ messages: [{ role: 'user', content: 'go' }] }) } as any,
      { get: jest.fn().mockReturnValue(mockProvider) } as any,
      { execute: jest.fn().mockResolvedValue([]) } as any,
    );

    await executor.execute({
      context: {
        taskIntent: 'Test task',
        rules: [],
        knowledge: [],
        memories: [],
        files: [],
      },
      role: { getName: () => 'coder', getConfig: () => ({ systemPrompt: '' }) },
      providerId: KnownProviders.OLLAMA,
      model: 'gpt-oss:20b-cloud',
    } as any);

    expect(mockProvider.generate).toHaveBeenCalledTimes(3);
    expect(mockProvider.generate.mock.calls.map((c: any[]) => c[0].observability)).toEqual([
      { stage: 'executor', retryAttempt: 0 },
      { stage: 'executor', retryAttempt: 1 },
      { stage: 'executor', retryAttempt: 2 },
    ]);
    // Payload must not grow a parallel retry counter or alter request body fields.
    for (const call of mockProvider.generate.mock.calls) {
      expect(call[0].model).toBe('gpt-oss:20b-cloud');
      expect(call[0].messages).toEqual([{ role: 'user', content: 'go' }]);
    }
  });

  it('Test D: request size metadata is deterministic', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: { role: 'assistant', content: 'OK' },
        done: true,
        prompt_eval_count: 0,
        eval_count: 0,
      }),
    });

    const messages = [
      { role: 'system' as const, content: 'ABC' }, // 3
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'DE' }, { type: 'text' as const, text: 'F' }] }, // 3
      { role: 'assistant' as const, content: 'GHIJ' }, // 4
    ];
    const tools = [
      { name: 'read_file', description: 'x', parameters: {} },
      { name: 'write_file', description: 'y', parameters: {} },
      { name: 'search_files', description: 'z', parameters: {} },
    ];

    expect(countPromptChars(messages)).toBe(10);

    await provider.generate(createRequest({ messages, tools }));
    const event = readProviderMeta()[0];
    expect(event.messageCount).toBe(3);
    expect(event.promptChars).toBe(10);
    expect(event.toolCount).toBe(3);
  });

  it('Test E: PROVIDER_META does not persist prompt/tool/secret payloads', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: { role: 'assistant', content: 'SECRET_RESPONSE_BODY' },
        done: true,
        prompt_eval_count: 0,
        eval_count: 0,
      }),
    });

    const secretPrompt = 'SUPER_SECRET_PROMPT_CONTENT_DO_NOT_LOG';
    const secretArgs = '{"path":"/etc/passwd","apiKey":"sk-live-secret"}';
    await provider.generate(createRequest({
      messages: [
        { role: 'system', content: secretPrompt },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', name: 'read_file', arguments: secretArgs }],
        },
        { role: 'tool', content: 'TOOL_RESULT_SECRET_PAYLOAD', tool_call_id: 'c1' },
      ],
      tools: [{ name: 'read_file', description: 'Read secrets', parameters: { apiKey: 'sk-live-secret' } }],
    }));

    const logDir = path.join(tmpDir, '.ai', 'logs', 'pipeline');
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    const raw = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    expect(raw).toContain('"phase":"PROVIDER_META"');
    expect(raw).not.toContain(secretPrompt);
    expect(raw).not.toContain(secretArgs);
    expect(raw).not.toContain('TOOL_RESULT_SECRET_PAYLOAD');
    expect(raw).not.toContain('SECRET_RESPONSE_BODY');
    expect(raw).not.toContain('sk-live-secret');
    expect(raw).not.toContain('/etc/passwd');

    // Verbose PROVIDER events remain filtered from disk.
    expect(raw).not.toContain('"phase":"PROVIDER"');
  });

  it('Test F: observability is never sent in the Ollama request body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: { role: 'assistant', content: 'OK' },
        done: true,
        prompt_eval_count: 0,
        eval_count: 0,
      }),
    });

    await provider.generate(createRequest({
      observability: { stage: 'planner', retryAttempt: 0 },
    }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.observability).toBeUndefined();
    expect(body.stage).toBeUndefined();
    expect(body.retryAttempt).toBeUndefined();
    expect(body.requestSeq).toBeUndefined();
    expect(body.model).toBe('gpt-oss:20b-cloud');
    expect(Array.isArray(body.messages)).toBe(true);
  });
});
