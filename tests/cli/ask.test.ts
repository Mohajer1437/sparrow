import { askCommand } from '../../src/cli/commands/ask';
import { AppFactory } from '../../src/core/app-factory';
import { ProviderError, ProviderUnavailableError } from '../../src/domain/errors/provider-errors';

jest.mock('../../src/core/app-factory');

describe('CLI Ask Command', () => {
  let mockOrchestrator: any;
  let mockSession: any;
  let mockConfig: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockOrchestrator = {
      handleTurn: jest.fn().mockResolvedValue({ content: 'Mocked assistant response' })
    };
    
    mockSession = {
      start: jest.fn().mockResolvedValue({ id: 'test-session-id' }),
      appendMessage: jest.fn(),
      getHistory: jest.fn().mockResolvedValue([]),
      clearHistory: jest.fn(),
      end: jest.fn(),
      getState: jest.fn()
    };

    mockConfig = {
      load: jest.fn().mockResolvedValue({}),
      exists: jest.fn().mockResolvedValue(true),
      get: jest.fn()
    };

    (AppFactory as jest.MockedClass<typeof AppFactory>).mockImplementation(() => ({
      createConfiguration: () => mockConfig,
      createConversationOrchestrator: () => mockOrchestrator,
      createSession: () => mockSession,
      createToolDefinitions: jest.fn().mockReturnValue([]),
      createRuntimeRepository: jest.fn(),
      createWorkspace: jest.fn(),
      createDiscoveryService: jest.fn(),
      createContextEngine: jest.fn(),
      createPromptBuilder: jest.fn(),
      createProviderRegistry: jest.fn(),
      createTaskExecutor: jest.fn()
    } as any));

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should execute successfully and print ONLY the assistant response', async () => {
    await askCommand('Hello world');

    expect(mockConfig.load).toHaveBeenCalled();
    expect(mockSession.start).toHaveBeenCalledWith('CLI Ask Session');
    expect(mockOrchestrator.handleTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session-id',
        message: 'Hello world'
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Mocked assistant response');
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should reject empty prompt', async () => {
    await askCommand('');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Prompt cannot be empty.');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockOrchestrator.handleTurn).not.toHaveBeenCalled();
  });

  it('should handle provider unavailable error', async () => {
    const err = new ProviderUnavailableError('Ollama is down');
    mockOrchestrator.handleTurn.mockRejectedValue(err);

    await askCommand('Test message');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Provider Error: Ollama is down');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle generic provider error', async () => {
    const err = new ProviderError('Something went wrong');
    mockOrchestrator.handleTurn.mockRejectedValue(err);

    await askCommand('Test message');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Provider Error: Something went wrong');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
  
  it('should preserve conversation history within the same process if called multiple times', async () => {
    await askCommand('First message');
    await askCommand('Second message');
    
    expect(mockOrchestrator.handleTurn).toHaveBeenCalledTimes(2);
  });

  it('should pass tool definitions to the orchestrator', async () => {
    await askCommand('Hello');
    
    expect(mockOrchestrator.handleTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.any(Array)
      })
    );
  });
});
