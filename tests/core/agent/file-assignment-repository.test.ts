import { FileAssignmentRepository } from '../../../src/core/agent/file-assignment-repository';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { RoleAssignment } from '../../../src/domain/role-assignment';

describe('FileAssignmentRepository', () => {
  let repository: FileAssignmentRepository;
  let mockRuntimeRepository: jest.Mocked<RuntimeRepository>;

  const mockAssignments: RoleAssignment[] = [
    {
      roleId: 'coder',
      modelId: 'qwen3-32b',
      providerId: 'ollama',
      assignedAt: '2026-01-01T00:00:00.000Z',
      source: 'default',
    },
  ];

  beforeEach(() => {
    mockRuntimeRepository = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn().mockResolvedValue(undefined),
    } as any;

    repository = new FileAssignmentRepository(mockRuntimeRepository);
  });

  it('saves assignments to file', async () => {
    await repository.save(mockAssignments);

    expect(mockRuntimeRepository.writeFile).toHaveBeenCalledWith(
      'config/role-assignments.json',
      expect.stringContaining('"roleId": "coder"')
    );
  });

  it('loads assignments from file', async () => {
    mockRuntimeRepository.exists.mockResolvedValue(true);
    mockRuntimeRepository.readFile.mockResolvedValue(
      JSON.stringify({ assignments: mockAssignments })
    );

    const loaded = await repository.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].roleId).toBe('coder');
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it('returns empty array when file does not exist', async () => {
    mockRuntimeRepository.exists.mockResolvedValue(false);

    const loaded = await repository.load();

    expect(loaded).toEqual([]);
    expect(mockRuntimeRepository.readFile).not.toHaveBeenCalled();
  });

  it('handles corrupted file gracefully', async () => {
    mockRuntimeRepository.exists.mockResolvedValue(true);
    mockRuntimeRepository.readFile.mockResolvedValue('invalid json {{{');

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const loaded = await repository.load();

    expect(loaded).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('returns immutable results', async () => {
    mockRuntimeRepository.exists.mockResolvedValue(true);
    mockRuntimeRepository.readFile.mockResolvedValue(
      JSON.stringify({ assignments: mockAssignments })
    );

    const loaded = await repository.load();

    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded[0])).toBe(true);
  });
});
