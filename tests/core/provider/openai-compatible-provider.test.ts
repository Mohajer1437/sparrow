import {
  OpenAICompatibleProvider,
  resolveOpenAICompatibleChatUrl,
} from '../../../src/core/provider/openai-compatible-provider';
import { ModelRequest } from '../../../src/contracts/provider';
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderModelNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../../../src/domain/errors/provider-errors';

describe('resolveOpenAICompatibleChatUrl', () => {
  it('appends /chat/completions to API roots', () => {
    expect(resolveOpenAICompatibleChatUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
    expect(resolveOpenAICompatibleChatUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('does not double-append when URL already targets chat completions', () => {
    expect(
      resolveOpenAICompatibleChatUrl('https://example.com/v1/chat/completions'),
    ).toBe('https://example.com/v1/chat/completions');
  });
});

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-key',
    });
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createRequest = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
    model: 'vendor/model',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
    ...overrides,
  });

  it('creates a correct OpenAI-compatible request body and URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'vendor/model',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    });

    await provider.generate(createRequest({
      temperature: 0.2,
      maxTokens: 128,
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'vendor/model',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      stream: false,
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }],
      temperature: 0.2,
      max_tokens: 128,
    });
  });

  it('sends Bearer Authorization header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: {},
      }),
    });

    await provider.generate(createRequest());
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('maps tool calls from OpenAI response shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const res = await provider.generate(createRequest());
    expect(res.toolCalls).toEqual([{
      id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"a.ts"}',
    }]);
    expect(res.usage?.totalTokens).toBe(15);
  });

  it('maps 401 to ProviderAuthenticationError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    await expect(provider.generate(createRequest())).rejects.toBeInstanceOf(ProviderAuthenticationError);
  });

  it('maps 404 to ProviderModelNotFoundError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'no model',
    });
    await expect(provider.generate(createRequest())).rejects.toBeInstanceOf(ProviderModelNotFoundError);
  });

  it('maps 429 to ProviderRateLimitError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'slow down',
    });
    await expect(provider.generate(createRequest())).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('maps network failure to ProviderUnavailableError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(provider.generate(createRequest())).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('maps other HTTP errors to ProviderError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });
    await expect(provider.generate(createRequest())).rejects.toBeInstanceOf(ProviderError);
  });
});
