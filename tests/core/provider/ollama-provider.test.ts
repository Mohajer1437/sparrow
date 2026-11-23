import { OllamaProvider } from '../../../src/core/provider/ollama-provider';
import { ModelRequest } from '../../../src/contracts/provider';
import {
  ProviderError,
  ProviderAuthenticationError,
  ProviderUnavailableError,
  ProviderInvalidResponseError,
  ProviderModelNotFoundError,
} from '../../../src/domain/errors/provider-errors';

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434');
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createRequest = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
    model: 'llama3',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' }
    ],
    ...overrides
  });

  it('should return successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'llama3',
        message: { role: 'assistant', content: 'Hi there!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5
      })
    });

    const res = await provider.generate(createRequest());
    expect(res.content).toBe('Hi there!');
    expect(res.usage?.promptTokens).toBe(10);
    expect(res.usage?.completionTokens).toBe(5);
    expect(res.usage?.totalTokens).toBe(15);
  });

  it('should handle multipart text content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: 'assistant', content: 'OK' },
        done: true,
        prompt_eval_count: 0,
        eval_count: 0
      })
    });

    const req = createRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Part 1 ' }, { type: 'text', text: 'Part 2' }] }
      ]
    });

    await provider.generate(req);
    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(calledBody.messages[0].content).toBe('Part 1 Part 2');
  });

  it('should throw ProviderAuthenticationError on 401', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    });

    await expect(provider.generate(createRequest())).rejects.toThrow(ProviderAuthenticationError);
  });

  it('should throw ProviderModelNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found'
    });

    await expect(provider.generate(createRequest())).rejects.toThrow(ProviderModelNotFoundError);
  });

  it('should throw ProviderUnavailableError on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(provider.generate(createRequest())).rejects.toThrow(ProviderUnavailableError);
  });

  it('should bubble up AbortError on cancellation', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(provider.generate(createRequest())).rejects.toThrow('Aborted');
  });

  it('should throw ProviderInvalidResponseError on invalid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); }
    });

    await expect(provider.generate(createRequest())).rejects.toThrow(ProviderInvalidResponseError);
  });

  it('should throw ProviderInvalidResponseError when message is missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ done: true })
    });

    await expect(provider.generate(createRequest())).rejects.toThrow(ProviderInvalidResponseError);
  });

  it('should pass temperature and maxTokens in options', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: 'OK' }, done: true, prompt_eval_count: 0, eval_count: 0 })
    });

    await provider.generate(createRequest({ temperature: 0.5, maxTokens: 100 }));
    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(calledBody.options.temperature).toBe(0.5);
    expect(calledBody.options.num_predict).toBe(100);
  });
});
