/**
 * R1.19 — the planner receives READ_ONLY as a system constraint. It is never
 * offered mutation tools, and if it emits one anyway the plan is stripped.
 */

import { DefaultTaskPlanner } from '../../../src/core/planning/default-task-planner';
import { MemoryContextBuilder } from '../../../src/contracts/memory-context-builder';
import { Provider } from '../../../src/contracts/provider';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';

const AVAILABLE_TOOLS = ['read_file', 'grep', 'list_directory', 'write_file', 'apply_patch', 'delete_file'];

const PLAN_JSON = {
  id: 'plan-ro-1',
  objective: 'Inspect app/page.tsx',
  complexity: 'simple',
  reasoning: 'Read the file and describe its structure.',
  steps: [
    {
      id: 'step-1',
      description: 'Read app/page.tsx',
      type: 'analysis',
      requiredTools: ['read_file'],
      expectedOutcome: 'file contents understood',
    },
    {
      // A planner that ignores the directive still must not reach the executor
      // with a mutation tool attached.
      id: 'step-2',
      description: 'Rewrite app/page.tsx',
      type: 'modify',
      requiredTools: ['write_file', 'apply_patch'],
      expectedOutcome: 'file rewritten',
    },
  ],
  affectedDomains: ['frontend'],
  validationStrategy: { requiredTests: [], successCriteria: ['structure explained'] },
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Planner integration with READ_ONLY (R1.19)', () => {
  let provider: jest.Mocked<Provider>;
  let planner: DefaultTaskPlanner;

  beforeEach(() => {
    provider = { generate: jest.fn().mockResolvedValue({ content: JSON.stringify(PLAN_JSON) }) } as never;
    const memory = {
      load: jest.fn().mockResolvedValue({
        architecturalMap: null, codebaseMap: null, knowledgeBase: null,
        loadedAt: '2026-01-01T00:00:00.000Z', isEmpty: true,
      }),
      hasKnowledge: jest.fn().mockResolvedValue(false),
      getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
    } as unknown as WorkspaceMemory;
    const contextBuilder = { build: jest.fn().mockReturnValue('') } as unknown as MemoryContextBuilder;
    planner = new DefaultTaskPlanner(provider, memory, contextBuilder);
  });

  it('never offers a mutation tool to the planner in READ_ONLY', async () => {
    await planner.plan({
      task: 'Inspect app/page.tsx and explain its current structure without modifying any files',
      availableTools: AVAILABLE_TOOLS,
      executionMode: 'READ_ONLY',
    });

    const prompt = JSON.stringify(provider.generate.mock.calls[0]);
    expect(prompt).toContain('read_file');
    expect(prompt).not.toContain('- write_file');
    expect(prompt).not.toContain('- apply_patch');
    expect(prompt).not.toContain('- delete_file');
    expect(prompt).toContain('READ_ONLY');
  });

  it('strips mutation tools from the returned plan even if the model emitted them', async () => {
    const plan = await planner.plan({
      task: 'Inspect app/page.tsx and explain its current structure without modifying any files',
      availableTools: AVAILABLE_TOOLS,
      executionMode: 'READ_ONLY',
    });

    const tools = (plan?.steps ?? []).flatMap(step => [...step.requiredTools]);
    expect(tools).toContain('read_file');
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('apply_patch');
  });

  it('leaves STANDARD planning untouched', async () => {
    const plan = await planner.plan({
      task: 'Add authentication middleware to the existing application with proper token validation',
      availableTools: AVAILABLE_TOOLS,
    });

    const tools = (plan?.steps ?? []).flatMap(step => [...step.requiredTools]);
    expect(tools).toContain('write_file');
  });
});
