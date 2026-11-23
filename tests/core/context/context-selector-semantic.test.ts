import { ContextSelector, SelectedContext } from '../../../src/core/context/context-selector';
import { NullSemanticReferenceProvider } from '../../../src/core/context/null-semantic-reference-provider';
import { SemanticReferenceProvider, SemanticReference } from '../../../src/contracts/semantic-reference-provider';
import { ContextRequest } from '../../../src/domain/context';
import { ProjectSnapshot } from '../../../src/domain/snapshot';

describe('ContextSelector with SemanticReferenceProvider', () => {
  const emptySnapshot: ProjectSnapshot = {
    manifest: { name: 'test', version: '1.0.0' },
    rules: [],
    knowledge: [],
    memory: [],
    statistics: { ruleCount: 0, knowledgeCount: 0, memoryCount: 0 },
  };

  const makeRequest = (task: string, snapshot: ProjectSnapshot = emptySnapshot): ContextRequest => ({
    task,
    snapshot,
  });

  describe('without provider (default behavior)', () => {
    it('returns empty files array', async () => {
      const selector = new ContextSelector();
      const result = await selector.select(makeRequest('any task'));

      expect(Array.isArray(result.files)).toBe(true);
      expect(result.files).toHaveLength(0);
    });

    it('still passes through rules/knowledge/memories', async () => {
      const snapshot: ProjectSnapshot = {
        manifest: { name: 'test', version: '1.0.0' },
        rules: [{ id: 'R1', content: 'rule1', filePath: 'rules/r1.md' }],
        knowledge: [{ id: 'K1', content: 'knowledge1', filePath: 'knowledge/k1.md' }],
        memory: [{ scope: 'project', key: 'm1', value: 'v1', filePath: 'memory/m1.json' }],
        statistics: { ruleCount: 1, knowledgeCount: 1, memoryCount: 1 },
      };
      const selector = new ContextSelector();
      const result = await selector.select(makeRequest('task', snapshot));

      expect(result.rules).toHaveLength(1);
      expect(result.knowledge).toHaveLength(1);
      expect(result.memories).toHaveLength(1);
      expect(result.files).toHaveLength(0);
    });
  });

  describe('with NullSemanticReferenceProvider', () => {
    it('returns empty files (preserves existing behavior)', async () => {
      const selector = new ContextSelector(new NullSemanticReferenceProvider());
      const result = await selector.select(makeRequest('task'));
      expect(result.files).toHaveLength(0);
    });
  });

  describe('with a working provider', () => {
    it('populates files from provider results', async () => {
      const mockRefs: ReadonlyArray<SemanticReference> = [
        { path: 'src/auth.ts', symbolName: 'AuthService', relevanceScore: 0.95, reason: 'defines auth' },
        { path: 'src/user.ts', symbolName: 'User', relevanceScore: 0.80, reason: 'referenced by auth' },
      ];
      const mockProvider: SemanticReferenceProvider = {
        isAvailable: async () => true,
        findRelevantFiles: async () => mockRefs,
      };

      const selector = new ContextSelector(mockProvider);
      const result = await selector.select(makeRequest('refactor auth'));

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe('src/auth.ts');
      expect(result.files[0].relevanceScore).toBe(0.95);
      expect(result.files[0].content).toBe(''); // Phase 3b will populate
      expect(result.files[1].path).toBe('src/user.ts');
    });

    it('skips files when provider reports unavailable', async () => {
      const mockProvider: SemanticReferenceProvider = {
        isAvailable: async () => false,
        findRelevantFiles: async () => [{ path: 'should-not-appear.ts', relevanceScore: 1, reason: '' }],
      };

      const selector = new ContextSelector(mockProvider);
      const result = await selector.select(makeRequest('task'));
      expect(result.files).toHaveLength(0);
    });

    it('falls back to empty files when provider throws (graceful degradation)', async () => {
      const mockProvider: SemanticReferenceProvider = {
        isAvailable: async () => true,
        findRelevantFiles: async () => { throw new Error('LSP server crashed'); },
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const selector = new ContextSelector(mockProvider);
      const result = await selector.select(makeRequest('task'));

      expect(result.files).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ContextSelector] Semantic provider failed'),
      );

      consoleSpy.mockRestore();
    });
  });
});
