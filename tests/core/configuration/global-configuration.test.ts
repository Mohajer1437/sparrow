import { GlobalConfiguration } from '../../../src/core/configuration/global-configuration';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('os');

describe('GlobalConfiguration', () => {
  const mockHomedir = '/mock/home';
  const mockConfigPath = path.join(mockHomedir, '.sparrow', 'config.json');

  beforeEach(() => {
    jest.clearAllMocks();
    (os.homedir as jest.Mock).mockReturnValue(mockHomedir);
  });

  it('should return null when no workspace is selected', async () => {
    (fs.readFile as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
    const config = new GlobalConfiguration();
    const result = await config.getCurrentWorkspace();
    expect(result).toBeNull();
  });

  it('should save and load persisted workspace', async () => {
    const config = new GlobalConfiguration();
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
    
    await config.setCurrentWorkspace('/path/to/workspace');
    
    expect(fs.writeFile).toHaveBeenCalledWith(
      mockConfigPath,
      expect.stringContaining('/path/to/workspace'),
      'utf-8'
    );

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ 
      currentWorkspace: '/path/to/workspace',
      knownWorkspaces: ['/path/to/workspace']
    }));
    const result = await config.getCurrentWorkspace();
    expect(result).toBe('/path/to/workspace');
  });

  it('should maintain backward compatibility with old config format', async () => {
    const config = new GlobalConfiguration();
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ 
      currentWorkspace: '/old/workspace' 
    }));
    
    const result = await config.getCurrentWorkspace();
    expect(result).toBe('/old/workspace');
    
    const known = await config.getKnownWorkspaces();
    expect(known).toEqual([]);
  });

  it('should add to knownWorkspaces when setting current workspace', async () => {
    const config = new GlobalConfiguration();
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ 
      currentWorkspace: null, 
      knownWorkspaces: ['/workspace1'] 
    }));
    
    await config.setCurrentWorkspace('/workspace2');
    
    const writtenData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[0][1]);
    expect(writtenData.knownWorkspaces).toContain('/workspace1');
    expect(writtenData.knownWorkspaces).toContain('/workspace2');
  });

  it('should handle Windows paths correctly', async () => {
    const winPath = 'D:\\ERP\\Project';
    (os.homedir as jest.Mock).mockReturnValue('C:\\Users\\Test');
    
    const config = new GlobalConfiguration();
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
    
    await config.setCurrentWorkspace(winPath);
    
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join('C:\\Users\\Test', '.sparrow', 'config.json'),
      expect.stringContaining('D:\\\\ERP\\\\Project'),
      'utf-8'
    );
  });
});
