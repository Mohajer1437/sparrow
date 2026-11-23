import { DefaultExecutionPlanner } from '../../../src/core/planning/default-execution-planner';
import { PlanningContext } from '../../../src/domain/planning-context';
import { DefaultPlanValidator } from '../../../src/core/planning/default-plan-validator';

describe('DefaultExecutionPlanner', () => {
  let planner: DefaultExecutionPlanner;

  beforeEach(() => {
    planner = new DefaultExecutionPlanner();
  });

  function createContext(objective: string, maxSteps = 10): PlanningContext {
    return Object.freeze({
      objective,
      availableTools: Object.freeze(['read_file', 'write_file']),
      maxSteps,
    });
  }

  it('creates a plan from objective', () => {
    const plan = planner.createPlan(createContext('Create a new file'));
    expect(plan).not.toBeNull();
    expect(plan!.objective).toBe('Create a new file');
    expect(plan!.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan!.status).toBe('CREATED');
  });

  it('returns null for empty objective', () => {
    expect(planner.createPlan(createContext(''))).toBeNull();
    expect(planner.createPlan(createContext('   '))).toBeNull();
  });

  it('decomposes multi-sentence objective into steps', () => {
    const plan = planner.createPlan(createContext('Read the file. Modify the content. Write the result.'));
    expect(plan).not.toBeNull();
    expect(plan!.steps.length).toBe(3);
  });

  it('respects maxSteps limit', () => {
    const plan = planner.createPlan(createContext('Step one. Step two. Step three. Step four.', 2));
    expect(plan!.steps.length).toBe(2);
  });

  it('assigns sequential dependencies', () => {
    const plan = planner.createPlan(createContext('First task. Second task. Third task.'));
    expect(plan!.steps[0].dependencies).toEqual([]);
    expect(plan!.steps[1].dependencies).toEqual(['step-1']);
    expect(plan!.steps[2].dependencies).toEqual(['step-2']);
  });

  it('infers step types from description', () => {
    const plan = planner.createPlan(createContext('Analyze the code. Find the bug. Fix the issue. Test the result.'));
    expect(plan!.steps[0].type).toBe('analysis');
    expect(plan!.steps[1].type).toBe('search');
    expect(plan!.steps[2].type).toBe('modify');
    expect(plan!.steps[3].type).toBe('test');
  });

  it('produces immutable plan', () => {
    const plan = planner.createPlan(createContext('Simple task'));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan!.steps)).toBe(true);
  });

  it('produces plan that passes R3 validation', async () => {
    const validator = new DefaultPlanValidator();
    const plan = planner.createPlan(createContext('Read file. Modify content. Write result.'));
    const result = await validator.validate(plan!, ['read_file', 'write_file']);
    expect(result.valid).toBe(true);
  });

  it('determines complexity based on step count', () => {
    const simple = planner.createPlan(createContext('One task. Two tasks.'));
    expect(simple!.complexity).toBe('simple');

    const medium = planner.createPlan(createContext('A. B. C. D. E.'));
    expect(medium!.complexity).toBe('medium');
  });

  it('handles single-sentence objective', () => {
    const plan = planner.createPlan(createContext('Implement the feature'));
    expect(plan!.steps.length).toBe(1);
    expect(plan!.steps[0].description).toBe('Implement the feature');
    expect(plan!.steps[0].dependencies).toEqual([]);
  });
});
