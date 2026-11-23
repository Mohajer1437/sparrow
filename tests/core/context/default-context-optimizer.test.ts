import { DefaultContextOptimizer } from '../../../src/core/context/default-context-optimizer';
import { ContextObject, ContextFile } from '../../../src/domain/context';
import { ProjectRule } from '../../../src/domain/rule';
import { KnowledgeItem } from '../../../src/domain/knowledge';
import { ProjectMemoryEntry } from '../../../src/domain/memory';
import { OptimizationOptions } from '../../../src/domain/context-optimization';

describe('DefaultContextOptimizer', () => {
  let optimizer: DefaultContextOptimizer;

  const createMockContext = (overrides: Partial<ContextObject> = {}): ContextObject => ({
    taskIntent: 'Test task',
    files: [
      { path: 'src/core/a.ts', content: 'A'.repeat(1000) },
      { path: 'src/core/b.ts', content: 'B'.repeat(1000) },
    ] as ContextFile[],
    rules: [
      { id: 'R1', content: 'Do not expose secrets', filePath: '.ai/rules.md' },
    ] as ProjectRule[],
    knowledge: [
      { id: 'K1', content: 'Architecture: Clean', filePath: '.ai/knowledge.md' },
    ] as KnowledgeItem[],
    memories: [
      { key: 'M1', value: 'Previous attempt failed', scope: 'experience', filePath: '.ai/memory.md' },
    ] as ProjectMemoryEntry[],
    metadata: {},
    ...overrides,
  });

  beforeEach(() => {
    optimizer = new DefaultContextOptimizer();
  });

  it('keeps critical rules when context is oversized', async () => {
    const context = createMockContext({
      rules: [{ id: 'R1', content: 'CRITICAL RULE', filePath: '.ai/rules.md' }],
      memories: [{ key: 'M1', value: 'X'.repeat(10000), scope: 'experience', filePath: '.ai/memory.md' }],
    });

    const options: OptimizationOptions = { maxContextChars: 2000 };
    const result = await optimizer.optimize(context, options);

    expect(result.optimizedContext.rules.length).toBe(1);
    expect(result.optimizedContext.rules[0].id).toBe('R1');
    expect(result.optimizedContext.memories.length).toBe(0);
    expect(result.removedItems.some(i => i.includes('M1'))).toBe(true);
  });

  it('removes low priority items first', async () => {
    const context = createMockContext({
      memories: [{ key: 'M1', value: 'Low priority memory', scope: 'experience', filePath: '.ai/memory.md' }],
      files: [{ path: 'src/other.ts', content: 'Medium priority file' }],
    });

    const options: OptimizationOptions = { maxContextChars: 150 };
    const result = await optimizer.optimize(context, options);

    expect(result.optimizedContext.rules.length).toBe(1);
    expect(result.optimizedContext.memories.length).toBe(0);
  });

  it('removes duplicate context entries', async () => {
    const context = createMockContext({
      rules: [
        { id: 'R1', content: 'Rule 1', filePath: '.ai/rules.md' },
        { id: 'R1', content: 'Rule 1', filePath: '.ai/rules.md' },
      ] as ProjectRule[],
    });

    const result = await optimizer.optimize(context);
    expect(result.optimizedContext.rules.length).toBe(1);
  });

  it('respects maxContextChars', async () => {
    const context = createMockContext({
      files: [
        { path: 'src/a.ts', content: 'A'.repeat(5000) },
        { path: 'src/b.ts', content: 'B'.repeat(5000) },
      ] as ContextFile[],
    });

    const options: OptimizationOptions = { maxContextChars: 6000 };
    const result = await optimizer.optimize(context, options);

    expect(result.optimizedSize).toBeLessThanOrEqual(6000);
    expect(result.optimizedContext.files.length).toBe(1);
  });

  it('keeps affected files over unrelated files', async () => {
    const context = createMockContext({
      files: [
        { path: 'src/affected.ts', content: 'A'.repeat(1000) },
        { path: 'src/unrelated.ts', content: 'B'.repeat(1000) },
      ] as ContextFile[],
    });

    const options: OptimizationOptions = { 
      maxContextChars: 1500,
      affectedFiles: ['src/affected.ts']
    };
    const result = await optimizer.optimize(context, options);

    expect(result.optimizedContext.files.length).toBe(1);
    expect(result.optimizedContext.files[0].path).toBe('src/affected.ts');
  });

  it('works without optimizer integration (optional behavior)', async () => {
    const emptyContext = createMockContext({
      rules: [], knowledge: [], files: [], memories: []
    });
    
    const result = await optimizer.optimize(emptyContext);
    expect(result.optimizedSize).toBe(0);
    expect(result.optimizedContext.files).toEqual([]);
    expect(result.optimizationReason).toContain('within limits');
  });
});
