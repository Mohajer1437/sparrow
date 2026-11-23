import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AppFactory } from '../../../src/core/app-factory';
import { assertOneLineTask, PHASE6_TASK_A } from '../../../src/core/benchmark/phase6-effectiveness';

describe('Phase 6 Milestone 1 — one-line task + knowledgeConsumption wiring', () => {
  test('assertOneLineTask accepts one-line task', () => {
    expect(() => assertOneLineTask(PHASE6_TASK_A)).not.toThrow();
    expect(PHASE6_TASK_A.includes('\n')).toBe(false);
    expect(PHASE6_TASK_A.includes('\r')).toBe(false);
  });

  test('assertOneLineTask rejects \\n', () => {
    expect(() => assertOneLineTask('line1\nline2')).toThrow(/INVALID_INPUT/);
  });

  test('assertOneLineTask rejects \\r', () => {
    expect(() => assertOneLineTask('line1\rline2')).toThrow(/INVALID_INPUT/);
  });

  test('default AppFactory knowledgeConsumption is on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-af-default-'));
    try {
      const factory = new AppFactory(dir);
      expect(factory.getKnowledgeConsumption()).toBe('on');
      const engine = factory.createStepExecutionEngine(dir);
      expect(engine.getKnowledgeBridge()).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('Knowledge OFF does not wire execution bridge', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-af-off-'));
    try {
      const factory = new AppFactory(dir, undefined, undefined, 'off');
      expect(factory.getKnowledgeConsumption()).toBe('off');
      const engine = factory.createStepExecutionEngine(dir);
      expect(engine.getKnowledgeBridge()).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('Knowledge ON preserves bridge wiring', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-af-on-'));
    try {
      const factory = new AppFactory(dir, undefined, undefined, 'on');
      expect(factory.getKnowledgeConsumption()).toBe('on');
      const engine = factory.createStepExecutionEngine(dir);
      expect(engine.getKnowledgeBridge()).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
