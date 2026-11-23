import { parseTodoPlanFromPlannerOutput } from '../../../src/core/planning/todo-plan-parser';
import {
  resolveTodoIdForStep,
  todoPlanToExecutionPlan,
} from '../../../src/core/planning/todo-plan-to-execution-plan';

const TWO_TODOS = {
  goal: 'Inspect then describe a small change to app/page.tsx',
  contextSummary: 'Next.js frontend. Gathered app/page.tsx.',
  affectedFiles: ['app/page.tsx'],
  constraints: ['Do not modify files'],
  todos: [
    {
      id: 'todo-1',
      title: 'Inspect the home page',
      description: 'Read app/page.tsx',
      reason: 'Named by the task',
      files: ['app/page.tsx'],
      dependencies: [],
      skillIds: ['frontend.core'],
      verificationRequirements: ['deterministic'],
      risk: 'LOW',
      action: 'inspect',
    },
    {
      id: 'todo-2',
      title: 'Describe the smallest safe change',
      description: 'Write the planned change without editing files',
      reason: 'Depends on inspection',
      files: ['app/page.tsx'],
      dependencies: ['todo-1'],
      skillIds: ['frontend.core'],
      verificationRequirements: ['intent-contract'],
      risk: 'LOW',
      action: 'verify',
    },
  ],
};

describe('Todo identity preservation', () => {
  it('keeps ordered Todo IDs, files, deps, skills, and verification on ExecutionPlan steps', () => {
    const todoPlan = parseTodoPlanFromPlannerOutput(JSON.stringify(TWO_TODOS), {
      allowedSkillIds: ['frontend.core'],
    });
    const execution = todoPlanToExecutionPlan(todoPlan, ['read_file']);
    expect(execution.steps.map(step => step.id)).toEqual(['todo-1', 'todo-2']);
    expect(execution.steps.map(step => step.sourceTodoId)).toEqual(['todo-1', 'todo-2']);
    expect(execution.steps[1].dependencies).toEqual(['todo-1']);
    expect(execution.steps[0].expectedFiles).toEqual(['app/page.tsx']);
    expect(execution.steps[0].skillIds).toEqual(['frontend.core']);
    expect(execution.steps[1].validationCriteria).toEqual(['intent-contract']);
    expect(execution.affectedDomains).toEqual(['frontend.core']);
  });

  it('maps a failed execution step back to its Todo id', () => {
    const todoPlan = parseTodoPlanFromPlannerOutput(JSON.stringify(TWO_TODOS), {
      allowedSkillIds: ['frontend.core'],
    });
    const execution = todoPlanToExecutionPlan(todoPlan, ['read_file']);
    expect(resolveTodoIdForStep(execution, 'todo-2')).toBe('todo-2');
    expect(resolveTodoIdForStep(execution, 'mt-99')).toBeUndefined();
  });
});
