import { DefaultPromptBuilder } from '../../../src/core/prompt/default-prompt-builder';
import { ContextObject } from '../../../src/domain/context';
import { Role } from '../../../src/contracts/role';
import { Message } from '../../../src/domain/message';

describe('DefaultPromptBuilder', () => {
  let builder: DefaultPromptBuilder;

  beforeEach(() => {
    builder = new DefaultPromptBuilder();
  });

  const createMockRole = (systemPrompt: string): Role => ({
    getName: () => 'TestRole',
    getConfig: () => ({ systemPrompt })
  });

  const createEmptyContext = (): ContextObject => ({
    taskIntent: '',
    files: [],
    rules: [],
    knowledge: [],
    memories: []
  });

  it('should build prompt with only system message when context is empty and no history', async () => {
    const role = createMockRole('You are a helpful assistant.');
    const context = createEmptyContext();

    const doc = await builder.buildPrompt(context, role);

    expect(doc.messages).toHaveLength(1);
    expect(doc.messages[0].role).toBe('system');
    expect(doc.messages[0].content).toBe('You are a helpful assistant.');
  });

  it('should include system and history', async () => {
    const role = createMockRole('System prompt');
    const context = createEmptyContext();
    const history: ReadonlyArray<Readonly<Message>> = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];

    const doc = await builder.buildPrompt(context, role, history);

    // System + 2 history + 1 current context user
    expect(doc.messages).toHaveLength(4); 
    expect(doc.messages[0].role).toBe('system');
    expect(doc.messages[1].role).toBe('user');
    expect(doc.messages[1].content).toBe('Hello');
    expect(doc.messages[2].role).toBe('assistant');
    expect(doc.messages[3].role).toBe('user');
  });

  it('should format current context into final user message', async () => {
    const role = createMockRole('Sys');
    const context: ContextObject = {
      taskIntent: 'Fix the bug',
      rules: [{ id: 'r1', content: 'No bugs allowed', filePath: 'r1.md' }],
      knowledge: [],
      memories: [],
      files: [{ path: 'main.ts', content: 'console.log("bug")', relevanceScore: 1 }]
    };

    const doc = await builder.buildPrompt(context, role);

    expect(doc.messages).toHaveLength(2); // system + user
    const userMsg = doc.messages[1];
    expect(userMsg.role).toBe('user');
    expect(typeof userMsg.content).toBe('string');
    const content = userMsg.content as string;
    expect(content).toContain('# Task');
    expect(content).toContain('Fix the bug');
    expect(content).toContain('# Rules');
    expect(content).toContain('No bugs allowed');
    expect(content).toContain('# Files');
    expect(content).toContain('main.ts');
  });

  it('should handle empty history array correctly', async () => {
    const role = createMockRole('Sys');
    const context = createEmptyContext();

    const doc = await builder.buildPrompt(context, role, []);

    expect(doc.messages).toHaveLength(1); // system only, no user msg because context is empty
  });

  it('should return deeply immutable PromptDocument', async () => {
    const role = createMockRole('Sys');
    const context = createEmptyContext();

    const doc = await builder.buildPrompt(context, role);

    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.messages)).toBe(true);
    expect(Object.isFrozen(doc.messages[0])).toBe(true);

    expect(() => {
      (doc.messages as any).push({ role: 'user', content: 'hack' });
    }).toThrow();
  });

  it('should preserve message ordering: System -> History -> Current User Context', async () => {
    const role = createMockRole('System Prompt');
    const context: ContextObject = {
      taskIntent: 'Current task',
      files: [], rules: [], knowledge: [], memories: []
    };
    const history: ReadonlyArray<Readonly<Message>> = [
      { role: 'user', content: 'History 1' },
      { role: 'assistant', content: 'History 2' }
    ];

    const doc = await builder.buildPrompt(context, role, history);

    expect(doc.messages[0].role).toBe('system');
    expect(doc.messages[0].content).toBe('System Prompt');

    expect(doc.messages[1].role).toBe('user');
    expect(doc.messages[1].content).toBe('History 1');

    expect(doc.messages[2].role).toBe('assistant');
    expect(doc.messages[2].content).toBe('History 2');

    expect(doc.messages[3].role).toBe('user');
    expect((doc.messages[3].content as string)).toContain('Current task');
  });
  
  it('should not mutate input objects', async () => {
    const role = createMockRole('Sys');
    const context: ContextObject = {
      taskIntent: 'Task',
      files: [], rules: [], knowledge: [], memories: []
    };
    const history: Message[] = [
      { role: 'user', content: 'H1' }
    ];
    
    Object.freeze(context);
    Object.freeze(context.files);
    Object.freeze(history);
    Object.freeze(history[0]);

    const doc = await builder.buildPrompt(context, role, history);
    expect(doc).toBeDefined();
  });
});
