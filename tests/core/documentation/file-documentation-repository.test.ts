import { FileDocumentationRepository } from '../../../src/core/documentation/file-documentation-repository';
import { RuntimeRepository } from '../../../src/contracts/runtime-repository';
import { DocumentationState } from '../../../src/domain/architecture-documentation';

describe('FileDocumentationRepository', () => {
  let mockRuntime: jest.Mocked<RuntimeRepository>;
  let repo: FileDocumentationRepository;

  beforeEach(() => {
    mockRuntime = {
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn().mockResolvedValue(undefined),
      appendFeedbackCandidates: jest.fn(),
    } as any;
    repo = new FileDocumentationRepository(mockRuntime);
  });

  it('returns null when documentation does not exist', async () => {
    mockRuntime.exists.mockResolvedValue(false);
    expect(await repo.load()).toBeNull();
  });

  it('loads documentation state', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      components: [{ id: 'c1', name: 'Test', layer: 'core', responsibility: 'Test', dependencies: [], dependents: [], lifecycle: 'active', milestone: 'R1', filePath: 'src/test.ts', testPaths: [] }],
      decisions: [],
      mappings: [],
      generatedAt: '2026-01-01',
      version: '1.0.0',
    }));

    const state = await repo.load();
    expect(state).not.toBeNull();
    expect(state!.components).toHaveLength(1);
    expect(state!.components[0].name).toBe('Test');
  });

  it('saves documentation state', async () => {
    const state: DocumentationState = Object.freeze({
      components: Object.freeze([]),
      decisions: Object.freeze([]),
      mappings: Object.freeze([]),
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    });

    await repo.save(state);
    expect(mockRuntime.mkdir).toHaveBeenCalledWith('documentation');
    expect(mockRuntime.writeFile).toHaveBeenCalledWith('documentation/state.json', expect.any(String));
  });

  it('checks existence', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    expect(await repo.exists()).toBe(true);
  });

  it('handles corrupted JSON gracefully', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue('invalid json');
    expect(await repo.load()).toBeNull();
  });

  it('returns immutable state', async () => {
    mockRuntime.exists.mockResolvedValue(true);
    mockRuntime.readFile.mockResolvedValue(JSON.stringify({
      components: [], decisions: [], mappings: [],
      generatedAt: '2026-01-01', version: '1.0.0',
    }));
    const state = await repo.load();
    expect(Object.isFrozen(state)).toBe(true);
  });
});
