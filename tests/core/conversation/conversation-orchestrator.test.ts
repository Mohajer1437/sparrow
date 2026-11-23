import { ConversationOrchestrator } from '../../../src/core/conversation/conversation-orchestrator';
import { ProjectDiscoveryService } from '../../../src/core/discovery/project-discovery-service';
import { ContextEngine } from '../../../src/contracts/context';
import { Session } from '../../../src/contracts/session';
import { TaskExecutor } from '../../../src/core/execution/task-executor';
import { ConversationTurn } from '../../../src/domain/conversation-turn';
import { ProjectSnapshot } from '../../../src/domain/snapshot';
import { Role } from '../../../src/contracts/role';
import { ProviderId } from '../../../src/domain/provider-id';

describe('ConversationOrchestrator', () => {
  let orchestrator: ConversationOrchestrator;
  let mockDiscovery: jest.Mocked<ProjectDiscoveryService>;
  let mockContextEngine: jest.Mocked<ContextEngine>;
  let mockSession: jest.Mocked<Session>;
  let mockTaskExecutor: jest.Mocked<TaskExecutor>;
  let mockRole: Role;

  const createMockSnapshot = (): ProjectSnapshot => ({
    manifest: Object.freeze({ name: 'test', version: '1.0', description: 'desc' }),
    rules: Object.freeze([]),
    knowledge: Object.freeze([]),
    memory: Object.freeze([]),
    statistics: Object.freeze({ ruleCount: 0, knowledgeCount: 0, memoryCount: 0 })
  });

  beforeEach(() => {
    mockDiscovery = {
      discover: jest.fn().mockResolvedValue(createMockSnapshot())
    } as any;

    mockContextEngine = {
      buildContext: jest.fn().mockResolvedValue({
        taskIntent: 'test task',
        files: [],
        rules: [],
        knowledge: [],
        memories: []
      })
    } as any;

    mockSession = {
      start: jest.fn(),
      end: jest.fn(),
      getState: jest.fn(),
      appendMessage: jest.fn().mockResolvedValue(undefined),
      getHistory: jest.fn().mockResolvedValue([]),
      clearHistory: jest.fn()
    };

    mockTaskExecutor = {
      execute: jest.fn().mockResolvedValue({
        content: 'Hello from assistant',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      })
    } as any;

    mockRole = {
      getName: () => 'TestRole',
      getConfig: () => ({ systemPrompt: 'You are helpful.' })
    };

    orchestrator = new ConversationOrchestrator(
      mockDiscovery,
      mockContextEngine,
      mockSession,
      mockTaskExecutor
    );
  });

  const createTurn = (message: string, sessionId: string = 'session-1'): ConversationTurn => ({
    sessionId,
    message,
    role: mockRole,
    providerId: 'ollama' as ProviderId,
    model: 'phi'
  });

  it('should execute first conversation turn correctly', async () => {
    const turn = createTurn('Hello');

    const response = await orchestrator.handleTurn(turn);

    expect(response.content).toBe('Hello from assistant');
    expect(mockDiscovery.discover).toHaveBeenCalledTimes(1);
    expect(mockContextEngine.buildContext).toHaveBeenCalledTimes(1);
    expect(mockSession.appendMessage).toHaveBeenCalledTimes(2);
    expect(mockTaskExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('should append user message before execution', async () => {
    const turn = createTurn('Hello');

    await orchestrator.handleTurn(turn);

    const firstAppendCall = mockSession.appendMessage.mock.calls[0];
    expect(firstAppendCall[0]).toBe('session-1');
    expect(firstAppendCall[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should append assistant message after execution', async () => {
    const turn = createTurn('Hello');

    await orchestrator.handleTurn(turn);

    const secondAppendCall = mockSession.appendMessage.mock.calls[1];
    expect(secondAppendCall[0]).toBe('session-1');
    expect(secondAppendCall[1]).toEqual({ role: 'assistant', content: 'Hello from assistant' });
  });

  it('should pass updated history to TaskExecutor', async () => {
    const turn = createTurn('Hello');

    await orchestrator.handleTurn(turn);

    const executeCall = mockTaskExecutor.execute.mock.calls[0][0];
    expect(executeCall.history).toBeDefined();
  });

  it('should handle multiple conversation turns', async () => {
    let history: any[] = [];
    mockSession.getHistory.mockImplementation(async () => [...history]);
    mockSession.appendMessage.mockImplementation(async (_id, msg) => {
      history.push(msg);
    });

    await orchestrator.handleTurn(createTurn('First message'));
    await orchestrator.handleTurn(createTurn('Second message'));
    await orchestrator.handleTurn(createTurn('Third message'));

    expect(mockTaskExecutor.execute).toHaveBeenCalledTimes(3);
    expect(history.length).toBe(6); // 3 user + 3 assistant messages
  });

  it('should grow history correctly across turns', async () => {
    let history: any[] = [];
    mockSession.getHistory.mockImplementation(async () => [...history]);
    mockSession.appendMessage.mockImplementation(async (_id, msg) => {
      history.push(msg);
    });

    await orchestrator.handleTurn(createTurn('First'));
    expect(history.length).toBe(2); // user + assistant

    await orchestrator.handleTurn(createTurn('Second'));
    expect(history.length).toBe(4); // + user + assistant

    await orchestrator.handleTurn(createTurn('Third'));
    expect(history.length).toBe(6); // + user + assistant
  });

  it('should pass previous messages in following prompts', async () => {
    let history: any[] = [];
    mockSession.getHistory.mockImplementation(async () => [...history]);
    mockSession.appendMessage.mockImplementation(async (_id, msg) => {
      history.push(msg);
    });

    await orchestrator.handleTurn(createTurn('First'));
    await orchestrator.handleTurn(createTurn('Second'));

    // Verify second turn received history from first turn
    const secondExecuteCall = mockTaskExecutor.execute.mock.calls[1][0];
    expect(secondExecuteCall.history?.length).toBe(3); // First user + First assistant + Second user
  });

  it('should store assistant replies in session', async () => {
    let history: any[] = [];
    mockSession.getHistory.mockImplementation(async () => [...history]);
    mockSession.appendMessage.mockImplementation(async (_id, msg) => {
      history.push(msg);
    });

    await orchestrator.handleTurn(createTurn('Hello'));

    const finalHistory = await mockSession.getHistory('session-1');
    expect(finalHistory.length).toBe(2);
    expect(finalHistory[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(finalHistory[1]).toEqual({ role: 'assistant', content: 'Hello from assistant' });
  });

  it('should rebuild context every turn', async () => {
    await orchestrator.handleTurn(createTurn('First'));
    await orchestrator.handleTurn(createTurn('Second'));
    await orchestrator.handleTurn(createTurn('Third'));

    expect(mockDiscovery.discover).toHaveBeenCalledTimes(3);
    expect(mockContextEngine.buildContext).toHaveBeenCalledTimes(3);
  });

  it('should survive multiple requests in same session', async () => {
    let history: any[] = [];
    mockSession.getHistory.mockImplementation(async () => [...history]);
    mockSession.appendMessage.mockImplementation(async (_id, msg) => {
      history.push(msg);
    });

    const sessionId = 'long-session';
    
    for (let i = 0; i < 10; i++) {
      const response = await orchestrator.handleTurn(createTurn(`Message ${i}`, sessionId));
      expect(response.content).toBe('Hello from assistant');
    }

    expect(history.length).toBe(20); // 10 user + 10 assistant
    expect(mockDiscovery.discover).toHaveBeenCalledTimes(10);
  });

  it('should return correct usage statistics', async () => {
    const turn = createTurn('Hello');

    const response = await orchestrator.handleTurn(turn);

    expect(response.usage).toBeDefined();
    expect(response.usage?.promptTokens).toBe(10);
    expect(response.usage?.completionTokens).toBe(5);
    expect(response.usage?.totalTokens).toBe(15);
  });

  it('should pass signal through the execution chain', async () => {
    const controller = new AbortController();
    const turn: ConversationTurn = {
      sessionId: 'session-1',
      message: 'Hello',
      role: mockRole,
      providerId: 'ollama' as ProviderId,
      model: 'phi',
      signal: controller.signal
    };

    await orchestrator.handleTurn(turn);

    const contextCall = mockContextEngine.buildContext.mock.calls[0][0];
    expect(contextCall.signal).toBe(controller.signal);

    const executeCall = mockTaskExecutor.execute.mock.calls[0][0];
    expect(executeCall.signal).toBe(controller.signal);
  });
});
