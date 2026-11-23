import { NullSemanticReferenceProvider } from '../../../src/core/context/null-semantic-reference-provider';
import { ProjectSnapshot } from '../../../src/domain/snapshot';

describe('NullSemanticReferenceProvider', () => {
  const provider = new NullSemanticReferenceProvider();

  const emptySnapshot: ProjectSnapshot = {
    manifest: { name: 'test', version: '1.0.0' },
    rules: [],
    knowledge: [],
    memory: [],
    statistics: { ruleCount: 0, knowledgeCount: 0, memoryCount: 0 },
  };

  it('reports isAvailable() = false', async () => {
    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });

  it('findRelevantFiles returns empty frozen array', async () => {
    const refs = await provider.findRelevantFiles('any task', emptySnapshot);
    expect(Array.isArray(refs)).toBe(true);
    expect(refs).toHaveLength(0);
    expect(Object.isFrozen(refs)).toBe(true);
  });

  it('returns empty array regardless of task content', async () => {
    const complexTask = 'Refactor the entire authentication system with JWT and refresh tokens';
    const refs = await provider.findRelevantFiles(complexTask, emptySnapshot);
    expect(refs).toHaveLength(0);
  });
});
