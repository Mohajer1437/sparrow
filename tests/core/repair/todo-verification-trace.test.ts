import { mapVerificationToTodos } from '../../../src/core/repair/todo-verification-trace';
import { todoPlanToExecutionPlan } from '../../../src/core/planning/todo-plan-to-execution-plan';
import { resolveTodoIdForStep } from '../../../src/core/planning/todo-plan-to-execution-plan';
import { validateTodoPlan } from '../../../src/domain/todo-plan';
import { VerificationCheck } from '../../../src/domain/verification-check';

function plan() {
  const todoPlan = validateTodoPlan({
    goal: 'Fix page',
    contextSummary: 'two todos',
    affectedFiles: ['app/page.tsx', 'middleware.ts'],
    constraints: [],
    todos: [
      {
        id: 'todo-1',
        title: 'Page',
        description: 'Edit page',
        reason: 'ui',
        files: ['app/page.tsx'],
        dependencies: [],
        skillIds: ['frontend.core'],
        verificationRequirements: ['browser'],
        risk: 'LOW',
        action: 'modify',
      },
      {
        id: 'todo-2',
        title: 'Auth',
        description: 'Edit middleware',
        reason: 'auth',
        files: ['middleware.ts'],
        dependencies: ['todo-1'],
        skillIds: ['frontend.core'],
        verificationRequirements: ['intent-contract'],
        risk: 'MEDIUM',
        action: 'modify',
      },
    ],
  });
  return todoPlanToExecutionPlan(todoPlan, ['read_file', 'write_file', 'apply_patch']);
}

describe('V&V traceability', () => {
  it('maps verification evidence to a Todo when the mapping is reliable', () => {
    const executionPlan = plan();
    const checks: VerificationCheck[] = [{
      id: 'intent-todo-2',
      category: 'api',
      name: 'todo-2 authz',
      passed: false,
      severity: 'HIGH',
      evidence: 'todo-2 failed: Expected 401 Actual 500',
    }];
    const trace = mapVerificationToTodos({ plan: executionPlan, checks });
    expect(trace.verdicts.find(item => item.todoId === 'todo-2')).toEqual({
      todoId: 'todo-2',
      scope: 'TODO_SPECIFIC',
      verdict: 'FAIL',
    });
    expect(resolveTodoIdForStep(executionPlan, 'todo-2')).toBe('todo-2');
  });

  it('keeps whole-run verification as whole-run UNKNOWN, not PASS', () => {
    const executionPlan = plan();
    const checks: VerificationCheck[] = [{
      id: 'browser-dom-home',
      category: 'browser',
      name: 'whole run',
      passed: true,
      severity: 'LOW',
      evidence: 'page loaded',
    }, {
      id: 'intent-authz',
      category: 'api',
      name: 'authz',
      passed: false,
      severity: 'HIGH',
      evidence: 'Expected 401 Actual 500',
    }];
    const trace = mapVerificationToTodos({ plan: executionPlan, checks });
    expect(trace.scope).toBe('WHOLE_RUN');
    expect(trace.verdicts.every(item => item.verdict === 'UNKNOWN')).toBe(true);
    expect(trace.verdicts.find(item => item.todoId === 'todo-2')?.verdict).not.toBe('PASS');
    expect(trace.verdicts.find(item => item.todoId === 'todo-2')?.verdict).not.toBe('FAIL');
  });
});
