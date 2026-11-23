import { roleCommand } from '../../src/cli/commands/role';
import { AppFactory } from '../../src/core/app-factory';
import { resolveWorkspaceRoot } from '../../src/cli/workspace-resolver';

jest.mock('../../src/cli/workspace-resolver');
jest.mock('../../src/core/app-factory');

const mockResolve = resolveWorkspaceRoot as jest.MockedFunction<typeof resolveWorkspaceRoot>;
const MockAppFactory = AppFactory as jest.MockedClass<typeof AppFactory>;

describe('role command', () => {
  let mockRoleRegistry: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('/fake/workspace');
    
    mockRoleRegistry = {
      list: jest.fn().mockReturnValue([
        { id: 'coder', name: 'Coder', contextScope: 'full', toolPolicy: 'default' },
        { id: 'reviewer', name: 'Reviewer', contextScope: 'limited', toolPolicy: 'read-only' },
      ]),
      get: jest.fn(),
    };

    MockAppFactory.mockImplementation(() => ({
      createRoleRegistry: () => mockRoleRegistry,
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

  it('lists roles', async () => {
    await roleCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ROLES (2)'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('coder'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('reviewer'));
  });

  it('shows existing role', async () => {
    mockRoleRegistry.get.mockReturnValue({
      id: 'coder', name: 'Coder', contextScope: 'full', toolPolicy: 'default',
      promptTemplate: 'You are an expert...'
    });
    await roleCommand(['show', 'coder']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ROLE: coder'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Context Scope: full'));
  });

  it('handles unknown role', async () => {
    mockRoleRegistry.get.mockReturnValue(undefined);
    await roleCommand(['show', 'unknown']);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Role not found: unknown');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 2 on missing show argument', async () => {
    await roleCommand(['show']);
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });
});
