import { workspaceCommand } from '../../src/cli/commands/workspace';
import { GlobalConfiguration } from '../../src/core/configuration/global-configuration';

jest.mock('../../src/core/configuration/global-configuration');

describe('workspaceCommand', () => {
  let mockGetCurrentWorkspace: jest.Mock;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentWorkspace = jest.fn();
    (GlobalConfiguration as jest.MockedClass<typeof GlobalConfiguration>).mockImplementation(() => ({
      getCurrentWorkspace: mockGetCurrentWorkspace,
      setCurrentWorkspace: jest.fn(),
      getKnownWorkspaces: jest.fn()
    } as any));

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should display current workspace when selected', async () => {
    mockGetCurrentWorkspace.mockResolvedValue('/path/to/ERP');
    
    await workspaceCommand();
    
    expect(consoleLogSpy).toHaveBeenCalledWith('✓ Current Workspace');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ERP'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('/path/to/ERP'));
  });

  it('should display message when no workspace is selected', async () => {
    mockGetCurrentWorkspace.mockResolvedValue(null);
    
    await workspaceCommand();
    
    expect(consoleLogSpy).toHaveBeenCalledWith('No workspace selected.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Use: agent use <path>');
  });
});
