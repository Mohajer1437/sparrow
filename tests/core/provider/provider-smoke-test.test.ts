import {
  ProviderAuthenticationError,
  ProviderUnavailableError,
} from '../../../src/domain/errors/provider-errors';
import { PROVIDER_SMOKE_PROMPT } from '../../../src/domain/provider-smoke-test';
import {
  classifyProviderSmokeFailure,
  runProviderSmokeTest,
} from '../../../src/core/provider/provider-smoke-test';
import { OllamaProvider } from '../../../src/core/provider/ollama-provider';
import { OpenAICompatibleProvider } from '../../../src/core/provider/openai-compatible-provider';
import { LlmProvider, ModelRequest, ModelResponse } from '../../../src/contracts/llm-provider';

describe('Provider completion smoke test', () => {
  const context = {
    providerType: 'fake',
    endpoint: 'http://example.test',
    model: 'test-model',
  };

  describe('runProviderSmokeTest (registry boundary / fake provider)', () => {
    it('reports success for a non-empty completion', async () => {
      let callCount = 0;
      const provider: LlmProvider = {
        async generate(): Promise<ModelResponse> {
          callCount += 1;
          return { content: 'OK' };
        },
      };
      const result = await runProviderSmokeTest(provider, context);

      expect(result.success).toBe(true);
      expect(result.providerType).toBe('fake');
      expect(result.endpoint).toBe('http://example.test');
      expect(result.model).toBe('test-model');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.responsePreview).toBe('OK');
      expect(result.failureCategory).toBeUndefined();
      expect(callCount).toBe(1);
    });

    it('sends the deterministic smoke prompt', async () => {
      let captured: ModelRequest | undefined;
      const provider: LlmProvider = {
        async generate(request: ModelRequest): Promise<ModelResponse> {
          captured = request;
          return { content: 'OK' };
        },
      };

      await runProviderSmokeTest(provider, context);

      expect(captured?.messages).toEqual([
        { role: 'user', content: PROVIDER_SMOKE_PROMPT },
      ]);
      expect(PROVIDER_SMOKE_PROMPT).toBe('Reply exactly with: OK');
    });

    it('reports empty_response when content is blank', async () => {
      const provider: LlmProvider = {
        async generate(): Promise<ModelResponse> {
          return { content: '   ' };
        },
      };
      const result = await runProviderSmokeTest(provider, context);
      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('empty_response');
    });

    it('classifies unauthorized failures', async () => {
      const provider: LlmProvider = {
        async generate(): Promise<ModelResponse> {
          throw new ProviderAuthenticationError('bad key');
        },
      };
      const result = await runProviderSmokeTest(provider, context);
      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('authentication');
      expect(result.message).toContain('bad key');
    });

    it('classifies unreachable failures', async () => {
      const provider: LlmProvider = {
        async generate(): Promise<ModelResponse> {
          throw new ProviderUnavailableError('ECONNREFUSED');
        },
      };
      const result = await runProviderSmokeTest(provider, context);
      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('unavailable');
    });
  });

  describe('classifyProviderSmokeFailure', () => {
    it('maps known provider errors', () => {
      expect(classifyProviderSmokeFailure(new ProviderAuthenticationError('x'))).toBe(
        'authentication',
      );
      expect(classifyProviderSmokeFailure(new ProviderUnavailableError('x'))).toBe(
        'unavailable',
      );
      expect(classifyProviderSmokeFailure(new Error('other'))).toBe('unknown');
    });
  });

  describe('OllamaProvider via smoke runner', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('succeeds on healthy chat completion', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: { content: 'OK' } }),
      });

      const provider = new OllamaProvider('http://localhost:11434');
      const result = await runProviderSmokeTest(provider, {
        providerType: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5:3b',
      });

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].content).toBe(PROVIDER_SMOKE_PROMPT);
    });

    it('maps unauthorized chat responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      });

      const provider = new OllamaProvider('http://localhost:11434');
      const result = await runProviderSmokeTest(provider, {
        providerType: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5:3b',
      });

      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('authentication');
    });

    it('maps unreachable endpoints', async () => {
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const provider = new OllamaProvider('http://localhost:11434');
      const result = await runProviderSmokeTest(provider, {
        providerType: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5:3b',
      });
      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('unavailable');
    });
  });

  describe('OpenAICompatibleProvider via smoke runner', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('succeeds on healthy chat completion', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      });

      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
      });
      const result = await runProviderSmokeTest(provider, {
        providerType: 'openai-compatible',
        endpoint: 'https://openrouter.ai/api/v1',
        model: 'vendor/model',
      });

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain('/chat/completions');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
    });

    it('maps unauthorized chat responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      });

      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-bad',
      });
      const result = await runProviderSmokeTest(provider, {
        providerType: 'openai-compatible',
        endpoint: 'https://openrouter.ai/api/v1',
        model: 'vendor/model',
      });

      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('authentication');
    });

    it('maps unreachable endpoints', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
      });
      const result = await runProviderSmokeTest(provider, {
        providerType: 'openai-compatible',
        endpoint: 'https://openrouter.ai/api/v1',
        model: 'vendor/model',
      });
      expect(result.success).toBe(false);
      expect(result.failureCategory).toBe('unavailable');
    });
  });
});
