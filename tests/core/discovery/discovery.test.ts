import { ProjectDiscoveryService } from '../../../src/core/discovery/project-discovery-service';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { Configuration, PlatformConfig } from '../../../src/contracts/configuration';
import { ManifestLoader } from '../../../src/core/discovery/manifest-loader';
import { RuleLoader } from '../../../src/core/discovery/rule-loader';
import { KnowledgeLoader } from '../../../src/core/discovery/knowledge-loader';
import { MemoryLoader } from '../../../src/core/discovery/memory-loader';
import { Logger } from '../../../src/contracts/logger';

describe('ProjectDiscoveryService', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let mockConfig: jest.Mocked<Configuration>;
  let mockLogger: jest.Mocked<Logger>;
  let service: ProjectDiscoveryService;

  const mockPaths = {
    manifestDir: 'manifest',
    rulesDir: 'rules',
    knowledgeDir: 'knowledge',
    memoryDir: 'memory'
  };

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      exists: jest.fn(),
      listFiles: jest.fn(),
      mkdir: jest.fn(),
      appendFeedbackCandidates: jest.fn(),
    };

    mockConfig = {
      load: jest.fn(),
      get: jest.fn((key: keyof PlatformConfig) => {
        if (key === 'paths') return mockPaths as any;
        return undefined;
      }),
      set: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    const manifestLoader = new ManifestLoader(mockRuntime, mockConfig, mockLogger);
    const ruleLoader = new RuleLoader(mockRuntime, mockConfig);
    const knowledgeLoader = new KnowledgeLoader(mockRuntime, mockConfig);
    const memoryLoader = new MemoryLoader(mockRuntime, mockConfig);

    service = new ProjectDiscoveryService(
      manifestLoader,
      ruleLoader,
      knowledgeLoader,
      memoryLoader
    );
  });

  it('should throw if manifest is missing', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    await expect(service.discover()).rejects.toThrow('Missing required file');
  });

  it('should load valid project snapshot', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockImplementation(async (path: string) => {
      if (path.includes('manifest.json')) return JSON.stringify({ name: 'Test', version: '1.0.0', description: 'desc' });
      if (path.includes('m1.json')) return JSON.stringify({ key: 'k', value: 'v' });
      return 'content';
    });
    mockRuntime.listFiles.mockImplementation(async (dir: string) => {
      if (dir === mockPaths.rulesDir) return ['rules/r1.md'];
      if (dir === mockPaths.knowledgeDir) return ['knowledge/k1.md'];
      if (dir === mockPaths.memoryDir) return ['memory/m1.json'];
      return [];
    });

    const snapshot = await service.discover();
    expect(snapshot.manifest.name).toBe('Test');
    expect(snapshot.statistics.ruleCount).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rules)).toBe(true);
  });

  it('should throw on invalid JSON in manifest', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('invalid json');
    await expect(service.discover()).rejects.toThrow('Invalid JSON');
  });
});
