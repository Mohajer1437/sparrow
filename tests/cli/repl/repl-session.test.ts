import { ReplSession } from '../../../src/cli/repl/repl-session';
import { AppFactory } from '../../../src/core/app-factory';

jest.mock('../../../src/core/app-factory');

describe('ReplSession', () => {
  it('should initialize and ask questions', async () => {
    const mockOrchestrator = {
      handleTurn: jest.fn().mockResolvedValue({ content: 'Mocked response' })
    };
    const mockSession = {
      start: jest.fn().mockResolvedValue({ id: 'test-session' })
    };
    const mockConfig = {
      load: jest.fn().mockResolvedValue({})
    };

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

    const factory = new AppFactory('/test', {} as any);
    const session = new ReplSession(factory, '/test', 'qwen2.5:3b');
    
    await session.initialize();
    const response = await session.ask('Hello');
    
    expect(response).toBe('Mocked response');
    expect(mockOrchestrator.handleTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Hello', model: 'qwen2.5:3b' })
    );
  });
});
