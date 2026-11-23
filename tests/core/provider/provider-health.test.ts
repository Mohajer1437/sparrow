import { OllamaProvider } from '../../../src/core/provider/ollama-provider';
import {
  OpenAICompatibleProvider,
  resolveOpenAICompatibleModelsUrl,
} from '../../../src/core/provider/openai-compatible-provider';

describe('Provider health probes', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('OllamaProvider.checkHealth', () => {
    const provider = new OllamaProvider('http://localhost:11434');

    it('reports healthy when /api/tags succeeds', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }),
      });

      const result = await provider.checkHealth({ model: 'qwen2.5:3b' });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.status).toBe('healthy');
      expect(result.providerType).toBe('ollama');
      expect(result.endpoint).toBe('http://localhost:11434/api/tags');
      expect(result.authentication).toBe('not_required');
      expect(result.configuredModel).toBe('qwen2.5:3b');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      // Must not call chat completion
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('/api/chat');
    });

    it('reports unauthorized on 401', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      const result = await provider.checkHealth();
      expect(result.status).toBe('unauthorized');
      expect(result.authentication).toBe('failed');
    });

    it('reports unavailable when endpoint is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const result = await provider.checkHealth();
      expect(result.status).toBe('unavailable');
      expect(result.message).toContain('fetch failed');
    });
  });

  describe('OpenAICompatibleProvider.checkHealth', () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    });

    it('reports healthy when /models succeeds with Bearer auth', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'vendor/model' }] }),
      });

      const result = await provider.checkHealth({ model: 'vendor/model' });

      expect(resolveOpenAICompatibleModelsUrl('https://openrouter.ai/api/v1')).toBe(
        'https://openrouter.ai/api/v1/models',
      );
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/models');
      expect(init.headers.Authorization).toBe('Bearer sk-test');
      expect(result.status).toBe('healthy');
      expect(result.authentication).toBe('ok');
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('chat/completions');
    });

    it('reports unauthorized on 403', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
      const result = await provider.checkHealth();
      expect(result.status).toBe('unauthorized');
      expect(result.authentication).toBe('failed');
    });

    it('reports unavailable when models endpoint cannot be reached', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await provider.checkHealth();
      expect(result.status).toBe('unavailable');
    });

    it('strips /chat/completions from base before probing /models', async () => {
      const p = new OpenAICompatibleProvider({
        baseUrl: 'https://example.com/v1/chat/completions',
        apiKey: 'sk',
      });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });
      await p.checkHealth();
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/v1/models');
    });
  });
});
