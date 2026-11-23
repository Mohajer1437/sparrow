import { DefaultRoleAssignmentService } from '../../../src/core/agent/default-role-assignment-service';
import { RoleAssignmentRegistry } from '../../../src/contracts/role-assignment-registry';
import { RoleRegistry } from '../../../src/contracts/role-registry';
import { ModelRegistry } from '../../../src/contracts/model-registry';
import { ProviderRegistry } from '../../../src/contracts/provider-registry';
import { AssignmentRepository } from '../../../src/contracts/assignment-repository';
import { RoleAssignment } from '../../../src/domain/role-assignment';
import { InMemoryRoleAssignmentRegistry } from '../../../src/core/agent/in-memory-role-assignment-registry';

describe('DefaultRoleAssignmentService', () => {
  let service: DefaultRoleAssignmentService;
  let roleRegistry: jest.Mocked<RoleRegistry>;
  let roleAssignmentRegistry: InMemoryRoleAssignmentRegistry;
  let modelRegistry: jest.Mocked<ModelRegistry>;
  let providerRegistry: jest.Mocked<ProviderRegistry>;
  let assignmentRepository: jest.Mocked<AssignmentRepository>;

  const mockModel = {
    id: 'qwen3-32b',
    providerId: 'ollama',
    displayName: 'Qwen 3 32B',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    isLocal: true,
    availability: 'available' as const,
    tags: ['coding'],
    metadata: {},
  };

  beforeEach(() => {
    roleRegistry = {
      get: jest.fn().mockReturnValue({ id: 'coder', name: 'Coder', contextScope: 'full' }),
      list: jest.fn().mockReturnValue([]),
      register: jest.fn(),
    } as any;

    roleAssignmentRegistry = new InMemoryRoleAssignmentRegistry();

    modelRegistry = {
      get: jest.fn().mockReturnValue(mockModel),
      list: jest.fn().mockReturnValue([mockModel]),
      find: jest.fn().mockReturnValue([mockModel]),
      isAvailable: jest.fn().mockReturnValue(true),
      register: jest.fn(),
    } as any;

    providerRegistry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({}),
      list: jest.fn().mockReturnValue(['ollama']),
    } as any;

    assignmentRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(false),
    } as any;

    service = new DefaultRoleAssignmentService(
      roleRegistry,
      roleAssignmentRegistry,
      modelRegistry,
      providerRegistry,
      assignmentRepository
    );
  });

  it('updates assignment successfully', async () => {
    const result = await service.updateAssignment('coder', 'qwen3-32b');

    expect(result.roleId).toBe('coder');
    expect(result.modelId).toBe('qwen3-32b');
    expect(result.providerId).toBe('ollama');
    expect(result.source).toBe('user');
    expect(result.updatedAt).toBeDefined();
    expect(assignmentRepository.save).toHaveBeenCalled();
  });

  it('rejects invalid role', async () => {
    roleRegistry.get.mockReturnValue(undefined);

    await expect(service.updateAssignment('unknown', 'qwen3-32b'))
      .rejects.toThrow('Role not found: unknown');
  });

  it('rejects invalid model', async () => {
    modelRegistry.get.mockReturnValue(undefined);

    await expect(service.updateAssignment('coder', 'unknown-model'))
      .rejects.toThrow('Model not found in registry: unknown-model');
  });

  it('rejects unavailable model', async () => {
    modelRegistry.get.mockReturnValue({ ...mockModel, availability: 'deprecated' });

    await expect(service.updateAssignment('coder', 'qwen3-32b'))
      .rejects.toThrow('Model not available');
  });

  it('rejects invalid provider', async () => {
    providerRegistry.has.mockReturnValue(false);

    await expect(service.updateAssignment('coder', 'qwen3-32b'))
      .rejects.toThrow('Provider not found');
  });

  it('persists assignment to repository', async () => {
    await service.updateAssignment('coder', 'qwen3-32b');

    expect(assignmentRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'coder', modelId: 'qwen3-32b' })
      ])
    );
  });

  it('loads assignments from repository on reload', async () => {
    const savedAssignment: RoleAssignment = {
      roleId: 'coder',
      modelId: 'gpt-4o',
      providerId: 'openai',
      assignedAt: '2026-01-01T00:00:00.000Z',
      source: 'user',
    };
    assignmentRepository.load.mockResolvedValue([savedAssignment]);

    await service.reload();

    const assignment = roleAssignmentRegistry.get('coder');
    expect(assignment?.modelId).toBe('gpt-4o');
    expect(assignment?.providerId).toBe('openai');
  });

  it('maintains backward compatibility with existing assignments', async () => {
    // Pre-assign a role
    roleAssignmentRegistry.assign({
      roleId: 'coder',
      modelId: 'qwen3-32b',
      providerId: 'ollama',
      assignedAt: '2026-01-01T00:00:00.000Z',
    });

    // Update it
    const result = await service.updateAssignment('coder', 'qwen3-32b');

    expect(result.roleId).toBe('coder');
    expect(result.updatedAt).toBeDefined();
    expect(result.metadata?.previousModel).toBe('qwen3-32b');
  });
});
