import { TaskExecutor } from '../../../src/core/execution/task-executor';
import { PromptBuilder } from '../../../src/contracts/prompt';
import { ProviderRegistry } from '../../../src/contracts/provider-registry';
import { ToolExecutor } from '../../../src/core/tool/tool-executor';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';
import { MemoryContextBuilder } from '../../../src/contracts/memory-context-builder';
import { KnownProviders } from '../../../src/domain/provider-id';
import { WorkspaceKnowledge } from '../../../src/domain/workspace-knowledge';

describe('TaskExecutor', () => {
  let mockPromptBuilder: jest.Mocked<PromptBuilder>;
  let mockProviderRegistry: jest.Mocked<ProviderRegistry>;
  let mockToolExecutor: jest.Mocked<ToolExecutor>;
  let mockWorkspaceMemory: jest.Mocked<WorkspaceMemory>;
  let mockMemoryContextBuilder: jest.Mocked<MemoryContextBuilder>;

  const createRequest = (overrides: any = {}) => ({
    context: {
      taskIntent: 'Test task',
      rules: [],
      knowledge: [],
      memories: [],
      files: [],
    },
    role: { getName: () => 'test', getConfig: () => ({ systemPrompt: '' }) },
    providerId: KnownProviders.OLLAMA,
    model: 'test-model',
    ...overrides,
  });

  const mockProvider = {
    generate: jest.fn().mockResolvedValue({ content: 'response', toolCalls: [] }),
  };

  beforeEach(() => {
    mockPromptBuilder = {
      buildPrompt: jest.fn().mockResolvedValue({ messages: [] }),
    } as any;

    mockProviderRegistry = {
      get: jest.fn().mockReturnValue(mockProvider),
    } as any;

    mockToolExecutor = {
      execute: jest.fn().mockResolvedValue([]),
    } as any;

    mockWorkspaceMemory = {
      load: jest.fn().mockResolvedValue({
        architecturalMap: null,
        codebaseMap: null,
        knowledgeBase: null,
        loadedAt: new Date().toISOString(),
        isEmpty: true,
      }),
      hasKnowledge: jest.fn().mockResolvedValue(false),
      getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
    } as any;

    mockMemoryContextBuilder = {
      build: jest.fn().mockReturnValue(''),
    } as any;

    mockProvider.generate.mockClear();
    mockPromptBuilder.buildPrompt.mockClear();
  });

  describe('basic execution', () => {
    it('executes without memory dependencies', async () => {
      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor
      );

      const result = await executor.execute(createRequest());
      expect(result.content).toBe('response');
    });

    it('calls provider and returns response', async () => {
      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      await executor.execute(createRequest());
      expect(mockProvider.generate).toHaveBeenCalled();
    });
  });

  describe('memory integration (R2.2)', () => {
    it('loads workspace memory when available', async () => {
      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      await executor.execute(createRequest());
      expect(mockWorkspaceMemory.load).toHaveBeenCalled();
    });

    it('injects memory context into prompt when knowledge exists', async () => {
      const mockKnowledge: WorkspaceKnowledge = {
        architecturalMap: {
          meta: { project_name: 'test', architecture_style: 'Clean', generated_at: '2026-01-01' },
          system_overview: { description: 'Test project', core_modules: ['Core'] },
          module_map: [],
        },
        codebaseMap: null,
        knowledgeBase: null,
        loadedAt: new Date().toISOString(),
        isEmpty: false,
      };

      mockWorkspaceMemory.load.mockResolvedValue(mockKnowledge);
      mockMemoryContextBuilder.build.mockReturnValue('PROJECT CONTEXT:\n\nArchitecture: Clean');

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      await executor.execute(createRequest());

      expect(mockMemoryContextBuilder.build).toHaveBeenCalledWith(mockKnowledge);

      const promptCall = mockPromptBuilder.buildPrompt.mock.calls[0];
      const context = promptCall[0];
      expect(context.knowledge).toBeDefined();
      expect(context.knowledge.length).toBeGreaterThan(0);
      expect(context.knowledge.some((k: any) => k.id === 'workspace-memory')).toBe(true);

      const memoryItem = context.knowledge.find((k: any) => k.id === 'workspace-memory');
      expect(memoryItem).toBeDefined();
      expect(memoryItem!.content).toContain('PROJECT CONTEXT');
    });

    it('does not inject memory when knowledge is empty', async () => {
      mockWorkspaceMemory.load.mockResolvedValue({
        architecturalMap: null,
        codebaseMap: null,
        knowledgeBase: null,
        loadedAt: new Date().toISOString(),
        isEmpty: true,
      });

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      await executor.execute(createRequest());

      expect(mockMemoryContextBuilder.build).not.toHaveBeenCalled();
    });

    it('skips memory when memoryEnabled is false', async () => {
      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      await executor.execute(createRequest({ memoryEnabled: false }));

      expect(mockWorkspaceMemory.load).not.toHaveBeenCalled();
    });

    it('continues without memory when memory loading fails', async () => {
      mockWorkspaceMemory.load.mockRejectedValue(new Error('Disk failure'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      const result = await executor.execute(createRequest());

      expect(result.content).toBe('response');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Memory loading failed')
      );

      warnSpy.mockRestore();
    });

    it('continues without memory when context builder throws', async () => {
      mockWorkspaceMemory.load.mockResolvedValue({
        architecturalMap: {
          meta: { project_name: 'x', architecture_style: 'X', generated_at: '' },
          system_overview: { description: '', core_modules: [] },
          module_map: [],
        },
        codebaseMap: null,
        knowledgeBase: null,
        loadedAt: '',
        isEmpty: false,
      });
      mockMemoryContextBuilder.build.mockImplementation(() => {
        throw new Error('Builder failed');
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor,
        mockWorkspaceMemory,
        mockMemoryContextBuilder
      );

      const result = await executor.execute(createRequest());

      expect(result.content).toBe('response');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('does not crash when memory dependencies are missing', async () => {
      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor
      );

      const result = await executor.execute(createRequest());
      expect(result.content).toBe('response');
    });
  });

  describe('Tool Loop', () => {
    it('aborts after 50 iterations', async () => {
      let iterationCounter = 0;
      mockProvider.generate.mockImplementation(async () => {
        iterationCounter++;
        return {
          content: '',
          toolCalls: [{
            id: `call_${iterationCounter}`,
            name: 'test',
            arguments: JSON.stringify({ n: iterationCounter })
          }],
        };
      });

      mockToolExecutor.execute.mockImplementation(async (calls) => {
        return (calls as readonly any[]).map((c: any) => ({
          toolCallId: c.id,
          content: 'result',
          isError: false,
        }));
      });

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor
      );

      await expect(executor.execute(createRequest())).rejects.toThrow(
        'Tool execution loop exceeded maximum iterations (50)'
      );
      expect(mockProvider.generate).toHaveBeenCalledTimes(50);
    });

    it('terminates on identical tool calls', async () => {
      const toolCall = { id: '1', name: 'test', arguments: '{}' };

      mockProvider.generate.mockResolvedValue({
        content: '',
        toolCalls: [toolCall],
      });

      mockToolExecutor.execute.mockResolvedValue([{
        toolCallId: '1',
        content: 'result',
        isError: false,
      }]);

      const executor = new TaskExecutor(
        mockPromptBuilder,
        mockProviderRegistry,
        mockToolExecutor
      );

      await expect(executor.execute(createRequest())).rejects.toThrow(
        'Infinite tool loop detected'
      );
    });
  });
});
