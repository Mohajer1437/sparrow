import { DefaultAgentOrchestrator } from '../../../src/core/agent/default-agent-orchestrator';
import { InMemoryRoleRegistry } from '../../../src/core/agent/in-memory-role-registry';
import { InMemoryRoleAssignmentRegistry } from '../../../src/core/agent/in-memory-role-assignment-registry';
import { WorkflowOrchestrator, WorkflowResult } from '../../../src/contracts/workflow-orchestrator';
import { ModelRegistry } from '../../../src/contracts/model-registry';
import { ProviderRegistry } from '../../../src/contracts/provider-registry';
import { RoleConfiguration } from '../../../src/domain/role-configuration';
import { ModelDescriptor } from '../../../src/domain/model-registry';

describe('DefaultAgentOrchestrator', () => {
  let roleRegistry: InMemoryRoleRegistry;
  let roleAssignmentRegistry: InMemoryRoleAssignmentRegistry;
  let mockModelRegistry: jest.Mocked<ModelRegistry>;
  let mockProviderRegistry: jest.Mocked<ProviderRegistry>;
  let mockWorkflowOrchestrator: jest.Mocked<WorkflowOrchestrator>;
  let orchestrator: DefaultAgentOrchestrator;

  const mockRole: RoleConfiguration = {
    id: 'coder',
    name: 'Coder',
    providerId: 'ollama',
    modelId: 'qwen3-32b',
    promptTemplate: 'Test prompt',
    contextScope: 'full',
  };

  const mockModel: ModelDescriptor = {
    id: 'qwen3-32b',
    providerId: 'ollama',
    displayName: 'Qwen 3 32B',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    isLocal: true,
    availability: 'available',
    tags: ['coding'],
    metadata: {},
  };

  const mockWorkflowResult: WorkflowResult = {
    sessionId: 'sess-1',
    success: true,
    plan: null,
    impactReport: null,
    reviewReport: null,
    patchResult: null,
    reflection: null,
  };

  beforeEach(() => {
    roleRegistry = new InMemoryRoleRegistry();
    roleRegistry.register(mockRole);

    roleAssignmentRegistry = new InMemoryRoleAssignmentRegistry();

    mockModelRegistry = {
      get: jest.fn().mockReturnValue(mockModel),
      list: jest.fn().mockReturnValue([mockModel]),
      find: jest.fn().mockReturnValue([mockModel]),
      isAvailable: jest.fn().mockReturnValue(true),
      register: jest.fn(),
    } as any;

    mockProviderRegistry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({}),
      list: jest.fn().mockReturnValue(['ollama']),
    } as any;

    mockWorkflowOrchestrator = {
      execute: jest.fn().mockResolvedValue(mockWorkflowResult),
    } as any;

    orchestrator = new DefaultAgentOrchestrator(
      roleRegistry,
      roleAssignmentRegistry,
      mockModelRegistry,
      mockProviderRegistry,
      mockWorkflowOrchestrator
    );
  });

  it('executes successfully with valid role (fallback to RoleConfiguration)', async () => {
    const result = await orchestrator.execute({ roleId: 'coder', task: 'fix bug' });

    expect(result.success).toBe(true);
    expect(result.roleId).toBe('coder');
    expect(result.workflowResult).toEqual(mockWorkflowResult);
    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'fix bug',
        providerId: 'ollama',
        modelId: 'qwen3-32b',
        memoryContext: 'Test prompt',
      })
    );
  });

  it('uses RoleAssignment when available', async () => {
    roleAssignmentRegistry.assign({
      roleId: 'coder',
      modelId: 'gpt-4o',
      providerId: 'openai',
      assignedAt: new Date().toISOString(),
    });

    mockModelRegistry.get.mockReturnValue({
      ...mockModel,
      id: 'gpt-4o',
      providerId: 'openai',
    });

    const result = await orchestrator.execute({ roleId: 'coder', task: 'fix bug' });

    expect(result.success).toBe(true);
    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-4o',
      })
    );
  });

  it('returns error for invalid role', async () => {
    const result = await orchestrator.execute({ roleId: 'unknown', task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Role not found');
    expect(mockWorkflowOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('returns error when model not found in registry', async () => {
    mockModelRegistry.get.mockReturnValue(undefined);

    const result = await orchestrator.execute({ roleId: 'coder', task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Model not found');
    expect(mockWorkflowOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('returns error when model is not available', async () => {
    mockModelRegistry.get.mockReturnValue({
      ...mockModel,
      availability: 'deprecated',
    });

    const result = await orchestrator.execute({ roleId: 'coder', task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Model not available');
    expect(mockWorkflowOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('returns error when provider not found', async () => {
    mockProviderRegistry.has.mockReturnValue(false);

    const result = await orchestrator.execute({ roleId: 'coder', task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Provider not found');
    expect(mockWorkflowOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('handles workflow execution failure gracefully', async () => {
    mockWorkflowOrchestrator.execute.mockRejectedValue(new Error('Workflow failed'));

    const result = await orchestrator.execute({ roleId: 'coder', task: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Workflow failed');
  });

  it('passes role configuration correctly to workflow', async () => {
    await orchestrator.execute({ 
      roleId: 'coder', 
      task: 'implement feature',
      targetFiles: ['src/a.ts']
    });

    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'implement feature',
        targetFiles: ['src/a.ts'],
        providerId: 'ollama',
        modelId: 'qwen3-32b',
      })
    );
  });

  it('returns a V&V failure contract to the planner and retries repair', async () => {
    const { DefaultQualityPolicy } = require('../../../src/core/vv/default-quality-policy');
    const failureContract = {
      id: 'fail-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'STANDARD' as const,
      summary: '1 verification check(s) failed',
      failedChecks: [],
      acceptanceCriteria: ['Page loads'],
      repairInstructions: 'Fix the failing check',
      attempt: 1,
    };
    mockWorkflowOrchestrator.execute
      .mockResolvedValueOnce({
        ...mockWorkflowResult,
        success: false,
        abortReason: 'V&V failed: 1 verification check(s) failed',
        failureContract,
      })
      .mockResolvedValueOnce({
        ...mockWorkflowResult,
        success: true,
      });

    const repairing = new DefaultAgentOrchestrator(
      roleRegistry,
      roleAssignmentRegistry,
      mockModelRegistry,
      mockProviderRegistry,
      mockWorkflowOrchestrator,
      new DefaultQualityPolicy('STANDARD'),
    );

    const result = await repairing.execute({ roleId: 'coder', task: 'fix the footer' });

    expect(result.success).toBe(true);
    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledTimes(2);
    expect(mockWorkflowOrchestrator.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        repairAttempt: 1,
        failureContract,
      }),
    );
  });

  it('stops with REPAIR_LIMIT_REACHED and does not retry forever', async () => {
    const { DefaultQualityPolicy } = require('../../../src/core/vv/default-quality-policy');
    const failureContract = {
      id: 'fail-1',
      createdAt: new Date().toISOString(),
      qualityProfile: 'MVP' as const,
      summary: '1 verification check(s) failed',
      failedChecks: [],
      acceptanceCriteria: ['Page loads'],
      repairInstructions: 'Fix the failing check',
      attempt: 1,
    };
    mockWorkflowOrchestrator.execute.mockResolvedValue({
      ...mockWorkflowResult,
      success: false,
      abortReason: 'V&V failed: 1 verification check(s) failed',
      failureContract,
    });

    const repairing = new DefaultAgentOrchestrator(
      roleRegistry,
      roleAssignmentRegistry,
      mockModelRegistry,
      mockProviderRegistry,
      mockWorkflowOrchestrator,
      new DefaultQualityPolicy('MVP'),
    );

    const result = await repairing.execute({ roleId: 'coder', task: 'fix the footer' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('REPAIR_LIMIT_REACHED');
    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry when repair scope cannot be established', async () => {
    const { DefaultQualityPolicy } = require('../../../src/core/vv/default-quality-policy');
    mockWorkflowOrchestrator.execute.mockResolvedValue({
      ...mockWorkflowResult,
      success: false,
      abortReason: 'NEEDS_CONTEXT',
      repairOutcome: 'NEEDS_CONTEXT',
      failureContract: {
        id: 'fail-1',
        createdAt: new Date().toISOString(),
        qualityProfile: 'STANDARD' as const,
        summary: '1 verification check(s) failed',
        failedChecks: [],
        acceptanceCriteria: [],
        repairInstructions: 'unknown',
        attempt: 1,
      },
    });

    const repairing = new DefaultAgentOrchestrator(
      roleRegistry,
      roleAssignmentRegistry,
      mockModelRegistry,
      mockProviderRegistry,
      mockWorkflowOrchestrator,
      new DefaultQualityPolicy('STANDARD'),
    );

    const result = await repairing.execute({ roleId: 'coder', task: 'fix unknown failure' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('NEEDS_CONTEXT');
    expect(mockWorkflowOrchestrator.execute).toHaveBeenCalledTimes(1);
  });
});
