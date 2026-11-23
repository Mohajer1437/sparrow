import { SelfHealingExecutor, SelfHealingResult } from '../../../src/core/execution/self-healing-executor';
import { TaskExecutor } from '../../../src/core/execution/task-executor';
import { KnowledgeFeedbackEngine } from '../../../src/contracts/knowledge-feedback-engine';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { MicroTask } from '../../../src/domain/micro-task';
import { SelfHealingConfig } from '../../../src/domain/self-healing-config';
import { KnownProviders } from '../../../src/domain/provider-id';

describe('SelfHealingExecutor', () => {
  let selfHealingExecutor: SelfHealingExecutor;
  let mockTaskExecutor: jest.Mocked<TaskExecutor>;
  let mockKnowledgeFeedbackEngine: jest.Mocked<KnowledgeFeedbackEngine>;
  let mockRuntimeRepository: jest.Mocked<RuntimeRepository>;

  const defaultConfig: SelfHealingConfig = {
    enabled: true,
    maxHealingAttempts: 3,
    tempKnowledgeDir: 'knowledge/temp',
    mergeOnSuccess: true,
  };

  const mockTask: MicroTask = {
    id: 'task-123',
    title: 'Test Task',
    description: 'Test task description',
    targetFiles: [],
    dependencies: [],
    expectedOutput: '',
    verificationSteps: [],
    rollbackStrategy: '',
    complexity: 'simple',
    riskLevel: 'low',
    reasoningRequired: 'none',
    difficultyScore: 1,
    requiredContext: {
      files: [],
      symbols: [],
      previousTaskOutputs: [],
    },
  };

  beforeEach(() => {
    mockTaskExecutor = {} as any;
    mockKnowledgeFeedbackEngine = {} as any;
    mockRuntimeRepository = {
      exists: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
    } as any;

    selfHealingExecutor = new SelfHealingExecutor(
      mockTaskExecutor,
      mockKnowledgeFeedbackEngine,
      mockRuntimeRepository,
    );
  });

  describe('executeWithHealing', () => {
    it('should succeed on first attempt when task executes successfully', async () => {
      const executeTask = jest.fn().mockResolvedValue(undefined);

      const result = await selfHealingExecutor.executeWithHealing(
        'session-123',
        mockTask,
        defaultConfig,
        'qwen2.5-coder:7b',
        KnownProviders.OLLAMA,
        executeTask,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.escalated).toBe(false);
      expect(executeTask).toHaveBeenCalledTimes(1);
    });

    it('should retry up to maxHealingAttempts when task fails', async () => {
      const executeTask = jest.fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValueOnce(undefined);

      mockRuntimeRepository.exists.mockResolvedValue(false);
      mockRuntimeRepository.writeFile.mockResolvedValue(undefined);

      const result = await selfHealingExecutor.executeWithHealing(
        'session-123',
        mockTask,
        defaultConfig,
        'qwen2.5-coder:7b',
        KnownProviders.OLLAMA,
        executeTask,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.escalated).toBe(false);
      expect(executeTask).toHaveBeenCalledTimes(3);
    });

    it('should fail after maxHealingAttempts when all attempts fail', async () => {
      const executeTask = jest.fn()
        .mockRejectedValue(new Error('All attempts failed'));

      mockRuntimeRepository.exists.mockResolvedValue(false);
      mockRuntimeRepository.writeFile.mockResolvedValue(undefined);

      const result = await selfHealingExecutor.executeWithHealing(
        'session-123',
        mockTask,
        defaultConfig,
        'qwen2.5-coder:7b',
        KnownProviders.OLLAMA,
        executeTask,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.finalError).toBe('All attempts failed');
    });

    it('should escalate to stronger model when configured and base model fails', async () => {
      const configWithEscalation: SelfHealingConfig = {
        ...defaultConfig,
        escalationModelId: 'qwen2.5-coder:32b',
        escalationProviderId: 'ollama',
      };

      const executeTask = jest.fn()
        .mockRejectedValueOnce(new Error('Base model attempt 1'))
        .mockRejectedValueOnce(new Error('Base model attempt 2'))
        .mockRejectedValueOnce(new Error('Base model attempt 3'))
        .mockResolvedValueOnce(undefined);

      mockRuntimeRepository.exists.mockResolvedValue(false);
      mockRuntimeRepository.writeFile.mockResolvedValue(undefined);

      const result = await selfHealingExecutor.executeWithHealing(
        'session-123',
        mockTask,
        configWithEscalation,
        'qwen2.5-coder:7b',
        KnownProviders.OLLAMA,
        executeTask,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(4);
      expect(result.escalated).toBe(true);
      expect(executeTask).toHaveBeenCalledTimes(4);
    });

    it('should skip healing when config.enabled is false', async () => {
      const disabledConfig: SelfHealingConfig = {
        ...defaultConfig,
        enabled: false,
      };

      const executeTask = jest.fn().mockRejectedValue(new Error('Task failed'));

      const result = await selfHealingExecutor.executeWithHealing(
        'session-123',
        mockTask,
        disabledConfig,
        'qwen2.5-coder:7b',
        KnownProviders.OLLAMA,
        executeTask,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(executeTask).toHaveBeenCalledTimes(1);
    });
  });
});
