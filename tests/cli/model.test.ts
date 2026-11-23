import { modelCommand } from '../../src/cli/commands/model';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('model command', () => {
  let mockModelRegistry: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const mockModels = [
    {
      id: 'qwen3-32b', providerId: 'ollama', displayName: 'Qwen 3 32B',
      contextWindow: 32768, maxOutputTokens: 8192, supportsTools: true,
      supportsVision: false, supportsThinking: true, isLocal: true,
      availability: 'available', tags: ['coding'], metadata: {}
    },
    {
      id: 'gpt-4o', providerId: 'openai', displayName: 'GPT-4o',
      contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true,
      supportsVision: true, supportsThinking: false, isLocal: false,
      availability: 'available', tags: ['general'], metadata: {}
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');

    mockModelRegistry = {
      list: jest.fn().mockReturnValue(mockModels),
      find: jest.fn().mockReturnValue([mockModels[0]]),
      get: jest.fn(),
    };

    MockAppFactory.mockImplementation(() => ({
      createModelRegistry: () => mockModelRegistry,
      discoverOllamaModels: jest.fn().mockResolvedValue(0),
    }) as any);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('lists all models', async () => {
    await modelCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ALL MODELS (2)'));
  });

  it('filters local models', async () => {
    await modelCommand(['list', '--local']);
    expect(mockModelRegistry.find).toHaveBeenCalledWith({ isLocal: true });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('LOCAL MODELS (1)'));
  });

  it('shows model details', async () => {
    mockModelRegistry.get.mockReturnValue(mockModels[0]);
    await modelCommand(['show', 'qwen3-32b']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('MODEL: qwen3-32b'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Provider:     ollama'));
  });

  it('handles unknown model', async () => {
    mockModelRegistry.get.mockReturnValue(undefined);
    await modelCommand(['show', 'unknown']);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Model not found: unknown');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
