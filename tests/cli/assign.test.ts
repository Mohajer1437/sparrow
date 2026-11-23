import { assignCommand } from '../../src/cli/commands/assign';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('assign command', () => {
  let mockService: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');

    mockService = {
      listAssignments: jest.fn().mockResolvedValue([
        { roleId: 'coder', modelId: 'qwen3-32b', providerId: 'ollama', source: 'default' },
      ]),
      updateAssignment: jest.fn().mockResolvedValue({
        roleId: 'coder', modelId: 'gpt-4o', providerId: 'openai', source: 'user',
      }),
      resetAssignments: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined),
    };

    MockAppFactory.mockImplementation(() => ({
      createRoleAssignmentService: () => mockService,
      discoverOllamaModels: jest.fn().mockResolvedValue(0),
      createModelRegistry: jest.fn().mockReturnValue({ list: jest.fn().mockReturnValue([{ id: 'gpt-4o' }]) }),
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

  it('lists assignments', async () => {
    await assignCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ROLE ASSIGNMENTS (1)'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('coder'));
  });

  it('updates assignment successfully', async () => {
    await assignCommand(['set', 'coder', 'gpt-4o']);
    expect(mockService.updateAssignment).toHaveBeenCalledWith('coder', 'gpt-4o');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Assignment updated'));
  });

  it('rejects invalid role', async () => {
    mockService.updateAssignment.mockRejectedValue(new Error('Role not found: unknown'));
    await assignCommand(['set', 'unknown', 'gpt-4o']);
    expect(consoleErrorSpy).toHaveBeenCalledWith('✗ Role not found: unknown');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects invalid model', async () => {
    mockService.updateAssignment.mockRejectedValue(new Error('Model not found in registry: bad'));
    await assignCommand(['set', 'coder', 'bad']);
    expect(consoleErrorSpy).toHaveBeenCalledWith('✗ Model not found in registry: bad');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('resets assignments', async () => {
    await assignCommand(['reset']);
    expect(mockService.resetAssignments).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Assignments reset to defaults'));
  });

  it('exits with code 2 on missing set arguments', async () => {
    await assignCommand(['set', 'coder']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });
});
