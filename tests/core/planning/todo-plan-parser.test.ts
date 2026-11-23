import { PlannerOutputRejectedError } from '../../../src/domain/errors/todo-plan-errors';
import { parseTodoPlanFromPlannerOutput } from '../../../src/core/planning/todo-plan-parser';
import { todoPlanToExecutionPlan } from '../../../src/core/planning/todo-plan-to-execution-plan';

const VALID_TODO_PLAN = {
  goal: 'Inspect app/page.tsx',
  contextSummary: 'Next.js app. Gathered app/page.tsx from the task.',
  affectedFiles: ['app/page.tsx'],
  constraints: ['Do not modify unrelated files'],
  todos: [
    {
      id: 'todo-1',
      title: 'Inspect the home page source',
      description: 'Read app/page.tsx and describe its component structure.',
      reason: 'Explicitly named in the task and collected in SOURCE_FILES.',
      files: ['app/page.tsx'],
      dependencies: [],
      skillIds: ['frontend.core'],
      verificationRequirements: ['browser'],
      risk: 'LOW',
      action: 'inspect',
    },
  ],
};

describe('TodoPlan parser', () => {
  it('parses valid structured output', () => {
    const plan = parseTodoPlanFromPlannerOutput(JSON.stringify(VALID_TODO_PLAN), {
      allowedSkillIds: ['frontend.core'],
    });
    expect(plan.todos[0].id).toBe('todo-1');
    expect(plan.affectedFiles).toEqual(['app/page.tsx']);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseTodoPlanFromPlannerOutput('This is not JSON')).toThrow(PlannerOutputRejectedError);
  });

  it('rejects empty planner output', () => {
    expect(() => parseTodoPlanFromPlannerOutput('   ')).toThrow(/empty/i);
  });

  it('rejects empty todos', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: [],
    }))).toThrow(PlannerOutputRejectedError);
  });

  it('rejects missing required fields', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      contextSummary: 'x',
      affectedFiles: [],
      constraints: [],
      todos: VALID_TODO_PLAN.todos,
    }))).toThrow(PlannerOutputRejectedError);
  });

  it('accepts snake_case context_summary and affected_files', () => {
    const plan = parseTodoPlanFromPlannerOutput(JSON.stringify({
      goal: 'Inspect app/page.tsx',
      context_summary: 'Next.js app. Gathered app/page.tsx from the task.',
      affected_files: ['app/page.tsx'],
      constraints: [],
      todos: VALID_TODO_PLAN.todos,
    }), { allowedSkillIds: ['frontend.core'] });
    expect(plan.contextSummary).toContain('Next.js');
    expect(plan.affectedFiles).toEqual(['app/page.tsx']);
  });

  it('rejects missing todos', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({ goal: 'x', contextSummary: 'y' }))).toThrow(
      /not a TodoPlan/,
    );
  });

  it('rejects invalid types', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: 'nope',
    }))).toThrow(PlannerOutputRejectedError);
  });

  it('rejects invalid enums', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: [{ ...VALID_TODO_PLAN.todos[0], risk: 'NUCLEAR' }],
    }))).toThrow(PlannerOutputRejectedError);
  });

  it('rejects duplicate IDs', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: [VALID_TODO_PLAN.todos[0], { ...VALID_TODO_PLAN.todos[0] }],
    }))).toThrow(/unique/i);
  });

  it('rejects a dependency cycle', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      goal: 'x',
      contextSummary: 'y',
      affectedFiles: ['a.ts', 'b.ts'],
      constraints: [],
      todos: [
        { ...VALID_TODO_PLAN.todos[0], id: 'todo-1', files: ['a.ts'], dependencies: ['todo-2'] },
        { ...VALID_TODO_PLAN.todos[0], id: 'todo-2', files: ['b.ts'], dependencies: ['todo-1'] },
      ],
    }))).toThrow(/cycle/i);
  });

  it('rejects an unknown dependency', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: [{ ...VALID_TODO_PLAN.todos[0], dependencies: ['todo-8'] }],
    }))).toThrow(/unknown/i);
  });

  it('rejects an unknown skill ID', () => {
    expect(() => parseTodoPlanFromPlannerOutput(JSON.stringify({
      ...VALID_TODO_PLAN,
      todos: [{ ...VALID_TODO_PLAN.todos[0], skillIds: ['magic.skill'] }],
    }), { allowedSkillIds: ['frontend.core'] })).toThrow(/skill/i);
  });

  it('adapts legacy execution-plan JSON then validates', () => {
    const plan = parseTodoPlanFromPlannerOutput(JSON.stringify({
      id: 'plan-legacy',
      objective: 'Inspect the page',
      complexity: 'simple',
      reasoning: 'Use gathered context.',
      steps: [{
        id: 'step-1',
        description: 'Read app/page.tsx',
        type: 'analysis',
        requiredTools: ['read_file'],
        expectedOutcome: 'Understood',
        expectedFiles: ['app/page.tsx'],
      }],
      affectedDomains: ['frontend'],
      validationStrategy: { requiredTests: ['browser'], successCriteria: [] },
    }));
    expect(plan.goal).toBe('Inspect the page');
    expect(plan.todos[0].id).toBe('todo-1');
    expect(plan.todos[0].files).toEqual(['app/page.tsx']);
  });

  it('bridges a validated TodoPlan into ExecutionPlan without dropping identity', () => {
    const todoPlan = parseTodoPlanFromPlannerOutput(JSON.stringify(VALID_TODO_PLAN), {
      allowedSkillIds: ['frontend.core'],
    });
    const execution = todoPlanToExecutionPlan(todoPlan, ['read_file', 'write_file']);
    expect(execution.todoPlan).toBe(todoPlan);
    expect(execution.objective).toBe(todoPlan.goal);
    expect(execution.steps[0].id).toBe('todo-1');
    expect(execution.steps[0].sourceTodoId).toBe('todo-1');
    expect(execution.steps[0].skillIds).toEqual(['frontend.core']);
    expect(execution.steps[0].validationCriteria).toEqual(['browser']);
    expect(execution.steps[0].expectedFiles).toEqual(['app/page.tsx']);
    expect(execution.id).toBe('plan-todo-1');
  });
});
