import { JsonConfiguration } from '../../src/core/configuration/json-configuration';
import { RuntimeRepository } from '../../src/contracts/runtime-repository';

describe('JsonConfiguration', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let config: JsonConfiguration;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn(),
      listFiles: jest.fn(),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
    };
    config = new JsonConfiguration(mockRuntime);
  });

  it('should initialize and load config', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    await config.initialize();
    
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({ version: '0.1.0', paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' } }));
    mockRuntime.exists.mockResolvedValue(true);
    
    const loaded = await config.load();
    expect(loaded.version).toBe('0.1.0');
  });

  it('should get and set values', async () => {
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({ version: '0.1.0', paths: { manifestDir: 'manifest', rulesDir: 'rules', knowledgeDir: 'knowledge', memoryDir: 'memory' } }));
    mockRuntime.exists.mockResolvedValue(true);
    await config.load();
    
    await config.set('defaultModel', 'llama3');
    expect(config.get('defaultModel')).toBe('llama3');
    expect(mockRuntime.writeFile).toHaveBeenCalled();
  });
});
