import { useCommand } from '../../src/cli/commands/use';
import { GlobalConfiguration } from '../../src/core/configuration/global-configuration';
import * as fs from 'fs/promises';

jest.mock('../../src/core/configuration/global-configuration');
jest.mock('fs/promises');

describe('useCommand', () => {
  let mockSetCurrentWorkspace: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetCurrentWorkspace = jest.fn().mockResolvedValue(undefined);
    (GlobalConfiguration as jest.MockedClass<typeof GlobalConfiguration>).mockImplementation(() => ({
      setCurrentWorkspace: mockSetCurrentWorkspace,
      getCurrentWorkspace: jest.fn()
    } as any));

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should select a valid existing directory', async () => {
    (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => true });
    
    await useCommand('/valid/path');
    
    expect(mockSetCurrentWorkspace).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('✓ Workspace selected');
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should reject non-existing path', async () => {
    const err: any = new Error('ENOENT');
    err.code = 'ENOENT';
    (fs.stat as jest.Mock).mockRejectedValue(err);
    
    await useCommand('/does/not/exist');
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockSetCurrentWorkspace).not.toHaveBeenCalled();
  });

  it('should reject invalid path (file instead of directory)', async () => {
    (fs.stat as jest.Mock).mockResolvedValue({ isDirectory: () => false });
    
    await useCommand('/path/to/file.txt');
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not a directory'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should reject empty path', async () => {
    await useCommand('');
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be empty'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
