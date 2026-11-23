import { DefaultContextEngine } from '../../../src/core/context/default-context-engine';
import { ContextSelector } from '../../../src/core/context/context-selector';
import { ContextLimiter } from '../../../src/core/context/context-limiter';
import { ContextBuilder } from '../../../src/core/context/context-builder';
import { ContextFreezer } from '../../../src/core/context/context-freezer';
import { ProjectMemoryPolicy } from '../../../src/core/context/policies/project-memory-policy';
import { ContextRequest, ContextObject } from '../../../src/domain/context';
import { ProjectSnapshot } from '../../../src/domain/snapshot';
import { ContextLimits } from '../../../src/domain/context-limits';

describe('DefaultContextEngine', () => {
  let engine: DefaultContextEngine;
  let limits: ContextLimits;

  beforeEach(() => {
    limits = { rules: 2, knowledge: 2, memory: 2, files: 2 };
    engine = new DefaultContextEngine(
      new ContextSelector(),
      new ProjectMemoryPolicy(),
      new ContextLimiter(limits),
      new ContextBuilder(),
      new ContextFreezer()
    );
  });

  const createSnapshot = (overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot => {
    return Object.freeze({
      manifest: Object.freeze({ name: 'test', version: '1.0', description: 'desc' }),
      rules: Object.freeze([
        Object.freeze({ id: 'r1', content: 'rule 1', filePath: 'r1.md' }),
        Object.freeze({ id: 'r2', content: 'rule 2', filePath: 'r2.md' }),
        Object.freeze({ id: 'r3', content: 'rule 3', filePath: 'r3.md' })
      ]),
      knowledge: Object.freeze([
        Object.freeze({ id: 'k1', content: 'know 1', filePath: 'k1.md' }),
        Object.freeze({ id: 'k2', content: 'know 2', filePath: 'k2.md' }),
        Object.freeze({ id: 'k3', content: 'know 3', filePath: 'k3.md' })
      ]),
      memory: Object.freeze([
        Object.freeze({ key: 'm1', value: 'v1', scope: 'project', filePath: 'm1.json' }),
        Object.freeze({ key: 'm2', value: 'v2', scope: 'working', filePath: 'm2.json' }),
        Object.freeze({ key: 'm3', value: 'v3', scope: 'project', filePath: 'm3.json' }),
        Object.freeze({ key: 'm4', value: 'v4', scope: 'experience', filePath: 'm4.json' })
      ]),
      statistics: Object.freeze({ ruleCount: 3, knowledgeCount: 3, memoryCount: 4 }),
      ...overrides
    });
  };

  it('should produce deterministic output', async () => {
    const req: ContextRequest = { task: 'test task', snapshot: createSnapshot() };
    const res1 = await engine.buildContext(req);
    const res2 = await engine.buildContext(req);
    
    expect(res1.taskIntent).toBe(res2.taskIntent);
    expect(res1.rules.length).toBe(res2.rules.length);
    expect(res1.memories.length).toBe(res2.memories.length);
  });

  it('should deeply freeze the output', async () => {
    const req: ContextRequest = { task: 'test task', snapshot: createSnapshot() };
    const res = await engine.buildContext(req);
    
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.rules)).toBe(true);
    expect(Object.isFrozen(res.rules[0])).toBe(true);
    expect(Object.isFrozen(res.memories)).toBe(true);
    expect(Object.isFrozen(res.memories[0])).toBe(true);
    expect(Object.isFrozen(res.files)).toBe(true);
  });

  it('should apply memory policy (only project scope)', async () => {
    const req: ContextRequest = { task: 'test task', snapshot: createSnapshot() };
    engine = new DefaultContextEngine(
      new ContextSelector(),
      new ProjectMemoryPolicy(),
      new ContextLimiter({ rules: 10, knowledge: 10, memory: 10, files: 10 }),
      new ContextBuilder(),
      new ContextFreezer()
    );
    
    const res = await engine.buildContext(req);
    expect(res.memories.length).toBe(2);
    expect(res.memories.every(m => m.scope === 'project')).toBe(true);
  });

  it('should enforce limits', async () => {
    const req: ContextRequest = { task: 'test task', snapshot: createSnapshot() };
    const res = await engine.buildContext(req);
    
    expect(res.rules.length).toBe(2);
    expect(res.knowledge.length).toBe(2);
    expect(res.memories.length).toBe(2); 
    expect(res.files.length).toBe(0);
  });

  it('should have empty files array', async () => {
    const req: ContextRequest = { task: 'test task', snapshot: createSnapshot() };
    const res = await engine.buildContext(req);
    expect(res.files).toEqual([]);
  });

  it('builder should not freeze objects', () => {
    const builder = new ContextBuilder();
    const req: ContextRequest = { task: 'test', snapshot: createSnapshot() };
    const selected = { rules: [], knowledge: [], memories: [], files: [] };
    const built = builder.build(req, selected);
    expect(Object.isFrozen(built)).toBe(false);
  });

  it('freezer should freeze objects deeply', () => {
    const freezer = new ContextFreezer();
    const req: ContextRequest = { task: 'test', snapshot: createSnapshot() };
    const selected = { rules: [], knowledge: [], memories: [], files: [] };
    const builder = new ContextBuilder();
    const built = builder.build(req, selected);
    
    const frozen = freezer.freeze(built);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.rules)).toBe(true);
  });
});
