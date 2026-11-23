import { replCommand } from '../../../src/cli/repl/repl';
import * as readline from 'readline';
import { AppFactory } from '../../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../../src/cli/workspace-resolver';

jest.mock('../../../src/core/app-factory');
jest.mock('../../../src/cli/workspace-resolver');
jest.mock('readline');

describe('replCommand', () => {
  let mockRl: any;
  let lineHandler: (line: string) => Promise<void>;
  let closeHandler: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRl = {
      prompt: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'line') lineHandler = cb;
        if (event === 'close') closeHandler = cb;
      }),
      close: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn()
    };

    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
    (resolveWorkspaceRoot as jest.Mock).mockResolvedValue('/test/workspace');

    const mockOrchestrator = {
      handleTurn: jest.fn().mockResolvedValue({ content: 'AI Response' })
    };
    const mockSession = {
      start: jest.fn().mockResolvedValue({ id: 'sess-1' })
    };
    const mockConfig = { load: jest.fn().mockResolvedValue({}) };

    (AppFactory as jest.MockedClass<typeof AppFactory>).mockImplementation(() => ({
      createConfiguration: () => mockConfig,
      createConversationOrchestrator: () => mockOrchestrator,
      createSession: () => mockSession,
      createToolDefinitions: jest.fn().mockReturnValue([]),
      createRoleAssignmentService: () => ({
        reload: jest.fn().mockResolvedValue(undefined),
        getAssignment: jest.fn().mockResolvedValue(undefined),
      }),
    } as any));
  });

  it('should start repl and print header', async () => {
    const replPromise = replCommand();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(readline.createInterface).toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();
    
    closeHandler();
    await replPromise;
  });

  it('should execute normal ask after debounce', async () => {
    const replPromise = replCommand();
    await new Promise(resolve => setTimeout(resolve, 50));

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    await lineHandler('hello agent');

    // Free-text prompts are debounced before execution.
    expect(consoleLogSpy).not.toHaveBeenCalledWith('AI Response');
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(consoleLogSpy).toHaveBeenCalledWith('AI Response');
    consoleLogSpy.mockRestore();

    closeHandler();
    await replPromise;
  });

  it('should execute /exit immediately without debounce', async () => {
    const replPromise = replCommand();
    await new Promise(resolve => setTimeout(resolve, 50));

    await lineHandler('/exit');
    expect(mockRl.close).toHaveBeenCalled();

    closeHandler();
    await replPromise;
  });
});
