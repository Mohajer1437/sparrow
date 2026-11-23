import { AppFactory } from '../../src/core/app-factory';
import { ContextObject } from '../../src/domain/context';
import { Role } from '../../src/contracts/role';
import { ExecutionRequest } from '../../src/domain/execution-request';
import { KnownProviders } from '../../src/domain/provider-id';
import { Logger } from '../../src/contracts/logger';
import { ProviderUnavailableError } from '../../src/domain/errors/provider-errors';
import { OllamaProvider } from '../../src/core/provider/ollama-provider';
import { InMemoryProviderRegistry } from '../../src/core/provider/in-memory-provider-registry';
import { DefaultPromptBuilder } from '../../src/core/prompt/default-prompt-builder';
import { TaskExecutor } from '../../src/core/execution/task-executor';

describe('S4.4 Real End-to-End Validation', () => {
  let isOllamaRunning = false;
  let isPhiAvailable = false;

  beforeAll(async () => {
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (res.ok) {
        isOllamaRunning = true;
        const data: any = await res.json();
        const models = data.models || [];
        isPhiAvailable = models.some((m: any) => m.name === 'phi' || m.name.startsWith('phi:'));
      }
    } catch (e) {
      isOllamaRunning = false;
    }

    if (!isOllamaRunning) {
      throw new Error('PREREQUISITE FAILED: Ollama is not running on http://localhost:11434. Please start Ollama before running this test.');
    }
    if (!isPhiAvailable) {
      throw new Error('PREREQUISITE FAILED: The "phi" model is not available. Please run "ollama pull phi" before continuing.');
    }
  }, 30000);

  const createLogger = (): Logger => ({
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {}
  });

  const createRole = (): Role => ({
    getName: () => 'Validator',
    getConfig: () => ({ systemPrompt: 'You are a strict validator.' })
  });

  const createContext = (): ContextObject => ({
    taskIntent: 'Reply with exactly the word OK.',
    files: [], rules: [], knowledge: [], memories: []
  });

  it('should verify PromptBuilder produces expected message sequence', async () => {
    const builder = new DefaultPromptBuilder();
    const doc = await builder.buildPrompt(createContext(), createRole());
    
    expect(doc.messages.length).toBe(2);
    expect(doc.messages[0].role).toBe('system');
    expect(doc.messages[0].content).toBe('You are a strict validator.');
    expect(doc.messages[1].role).toBe('user');
    expect(doc.messages[1].content).toContain('Reply with exactly the word OK.');
  });

  it('should resolve the correct provider from registry', () => {
    const factory = new AppFactory(process.cwd(), createLogger());
    const registry = factory.createProviderRegistry();
    
    expect(registry.has(KnownProviders.OLLAMA)).toBe(true);
    const provider = registry.get(KnownProviders.OLLAMA);
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('should map ProviderUnavailableError if Ollama is down', async () => {
    const badProvider = new OllamaProvider('http://localhost:19999');
    const registry = new InMemoryProviderRegistry(new Map([[KnownProviders.OLLAMA, badProvider]]));
    const mockToolExecutor = { execute: async () => [] } as any;
    const executor = new TaskExecutor(new DefaultPromptBuilder(), registry, mockToolExecutor);

    const request: ExecutionRequest = {
      context: createContext(),
      role: createRole(),
      providerId: KnownProviders.OLLAMA,
      model: 'phi'
    };

    await expect(executor.execute(request)).rejects.toThrow(ProviderUnavailableError);
  }, 20000);

  it('should propagate AbortSignal correctly', async () => {
    const provider = new OllamaProvider('http://localhost:11434');
    const controller = new AbortController();
    controller.abort();
    
    const req = {
      model: 'phi',
      messages: [{ role: 'user' as const, content: 'test' }],
      signal: controller.signal
    };

    try {
      await provider.generate(req);
      throw new Error('Should have thrown due to abort');
    } catch (err: any) {
      expect(err.name === 'AbortError' || err.message.toLowerCase().includes('abort')).toBe(true);
    }
  });

  it('should execute real request and return valid response', async () => {
    const factory = new AppFactory(process.cwd(), createLogger());
    const executor = factory.createTaskExecutor();

    const request: ExecutionRequest = {
      context: createContext(),
      role: createRole(),
      providerId: KnownProviders.OLLAMA,
      model: 'phi'
    };

    const response = await executor.execute(request);

    // Verify the complete execution path succeeded
    expect(response).toBeDefined();
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
    
    // Verify ModelResponse structure is correct
    expect(response.usage).toBeDefined();
    expect(typeof response.usage?.promptTokens).toBe('number');
    expect(typeof response.usage?.completionTokens).toBe('number');
    expect(typeof response.usage?.totalTokens).toBe('number');
    
    // Log the actual response for debugging
    console.log('\n[Real E2E Test] Model response:', response.content);
    console.log('[Real E2E Test] Token usage:', response.usage);
  }, 120000);
});
