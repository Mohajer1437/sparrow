import { DefaultPlanValidator } from '../../../src/core/planning/default-plan-validator';
import { ExecutionPlan, PlanStep } from '../../../src/domain/execution-plan';

describe('DefaultPlanValidator', () => {
  let validator: DefaultPlanValidator;
  const availableTools = ['read_file', 'write_file', 'apply_patch'];

  const createMockPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
    id: 'plan-1',
    objective: 'Test objective',
    complexity: 'simple',
    reasoning: 'Test reasoning',
    steps: [
      { id: 'step-1', description: 'Read file', type: 'search', requiredTools: ['read_file'], expectedOutcome: 'File read' },
      { id: 'step-2', description: 'Write file', type: 'modify', requiredTools: ['write_file'], expectedOutcome: 'File written' }
    ],
    affectedDomains: ['core'],
    validationStrategy: { requiredTests: [], successCriteria: [] },
    createdAt: new Date().toISOString(),
    ...overrides
  });

  beforeEach(() => {
    validator = new DefaultPlanValidator();
  });

  it('validates a correct plan successfully', async () => {
    const plan = createMockPlan();
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing objective', async () => {
    const plan = createMockPlan({ objective: '' });
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'EMPTY_OBJECTIVE')).toBe(true);
  });

  it('detects missing steps', async () => {
    const plan = createMockPlan({ steps: [] });
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'NO_STEPS')).toBe(true);
  });

  it('detects invalid tool requirements', async () => {
    const plan = createMockPlan({
      steps: [{ id: 'step-1', description: 'Bad', type: 'modify', requiredTools: ['delete_file', 'read_file'], expectedOutcome: 'x' }]
    });
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_TOOL')).toBe(true);
  });

  it('detects impossible execution order (missing dependency)', async () => {
    const plan = createMockPlan({
      steps: [{ id: 'step-1', description: 'Bad', type: 'modify', requiredTools: [], expectedOutcome: 'x', dependencies: ['step-99'] } as any]
    });
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'IMPOSSIBLE_DEPENDENCY')).toBe(true);
  });

  it('detects circular dependencies', async () => {
    const plan = createMockPlan({
      steps: [
        { id: 'step-1', description: 'A', type: 'modify', requiredTools: [], expectedOutcome: 'x', dependencies: ['step-2'] } as any,
        { id: 'step-2', description: 'B', type: 'modify', requiredTools: [], expectedOutcome: 'x', dependencies: ['step-1'] } as any
      ]
    });
    const result = await validator.validate(plan, availableTools);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
  });

  it('resolves dependencies in correct topological order', async () => {
    const steps: PlanStep[] = [
      { id: 'step-3', description: 'C', type: 'test', requiredTools: [], expectedOutcome: 'x', dependencies: ['step-2'] } as any,
      { id: 'step-1', description: 'A', type: 'search', requiredTools: [], expectedOutcome: 'x' },
      { id: 'step-2', description: 'B', type: 'modify', requiredTools: [], expectedOutcome: 'x', dependencies: ['step-1'] } as any
    ];
    
    const sorted = validator.resolveDependencies(steps);
    expect(sorted[0].id).toBe('step-1');
    expect(sorted[1].id).toBe('step-2');
    expect(sorted[2].id).toBe('step-3');
  });

  it('workflow aborts on invalid plan (simulated)', async () => {
    const plan = createMockPlan({ objective: '' });
    const result = await validator.validate(plan, availableTools);
    
    // Simulating workflow logic
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      // In real workflow: await sessionManager.failSession(...), await sessionManager.recordDecision(...)
    }
    expect(result.valid).toBe(false);
  });
});
