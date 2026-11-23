/**
 * R1.1-R1.5, R1.10 — Todo verdicts must follow the evidence and nothing else.
 */

import {
  TodoVerificationCheckResult,
  deriveTodoVerdict,
  isTodoAttributableRequirement,
  summarizeTodoVerification,
} from '../../src/domain/todo-verification';

function check(overrides: Partial<TodoVerificationCheckResult> = {}): TodoVerificationCheckResult {
  return {
    checkId: 'check-1',
    name: 'browser',
    category: 'browser',
    todoId: 'todo-1',
    scope: 'TODO_SPECIFIC',
    status: 'PASS',
    mappingSource: 'EXPLICIT_CHECK_TODO_ID',
    required: true,
    evidenceRefs: [],
    source: 'browser-verifier',
    ...overrides,
  };
}

describe('Todo verdict derivation (R1.3-R1.5)', () => {
  it('reports PASS only when every mapped todo-specific check passed and nothing required is missing', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-1',
      requiredChecks: ['browser'],
      results: [check()],
      executed: true,
    });
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.scope).toBe('TODO_SPECIFIC');
    expect(verdict.missingChecks).toEqual([]);
  });

  it('reports FAIL when a required todo-specific check failed, even alongside passing checks', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-2',
      requiredChecks: ['browser', 'api'],
      results: [
        check({ checkId: 'c-api', name: 'api', category: 'api', status: 'PASS' }),
        check({ checkId: 'c-browser', status: 'FAIL' }),
      ],
      executed: true,
    });
    expect(verdict.verdict).toBe('FAIL');
  });

  it('tracks multiple checks per todo independently (R1.4)', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-2',
      requiredChecks: ['typecheck', 'lint', 'browser'],
      results: [
        check({ checkId: 'c-tc', name: 'typecheck', category: 'deterministic', status: 'PASS' }),
        check({ checkId: 'c-lint', name: 'lint', category: 'deterministic', status: 'PASS' }),
        check({ checkId: 'c-browser', name: 'browser', category: 'browser', status: 'FAIL' }),
      ],
      executed: true,
    });
    expect(verdict.executedChecks).toEqual(['c-tc', 'c-lint', 'c-browser']);
    expect(verdict.verdict).toBe('FAIL');
  });

  it('refuses PASS when a required check produced no todo-specific evidence (R1.5)', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-3',
      requiredChecks: ['browser', 'api'],
      results: [check()],
      executed: true,
    });
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(verdict.missingChecks).toEqual(['api']);
  });

  it('reports BLOCKED when a todo-specific check could not run', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-4',
      requiredChecks: ['browser'],
      results: [check({ status: 'BLOCKED' })],
      executed: true,
    });
    expect(verdict.verdict).toBe('BLOCKED');
  });

  it('never turns a whole-run PASS into a todo PASS (R1.2, R1.10)', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-5',
      requiredChecks: ['browser'],
      results: [check({ scope: 'WHOLE_RUN', status: 'PASS', mappingSource: 'NONE', todoId: undefined })],
      executed: true,
    });
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(verdict.scope).toBe('WHOLE_RUN');
  });

  it('never turns an unknown-scope PASS into a todo PASS (R1.2)', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-6',
      requiredChecks: [],
      results: [check({ scope: 'UNKNOWN', status: 'PASS', mappingSource: 'NONE' })],
      executed: true,
    });
    expect(verdict.verdict).toBe('UNKNOWN');
  });

  it('reports NOT_TESTED for a todo that never executed and has no mapped check', () => {
    const verdict = deriveTodoVerdict({
      todoId: 'todo-7',
      requiredChecks: ['browser'],
      results: [],
      executed: false,
    });
    expect(verdict.verdict).toBe('NOT_TESTED');
  });
});

describe('Todo verification summary (R1.30)', () => {
  it('counts each verdict kind and keeps whole-run checks separate', () => {
    const report = summarizeTodoVerification({
      verdicts: [
        deriveTodoVerdict({ todoId: 'todo-1', requiredChecks: ['browser'], results: [check()], executed: true }),
        deriveTodoVerdict({
          todoId: 'todo-2',
          requiredChecks: ['browser'],
          results: [check({ todoId: 'todo-2', status: 'FAIL' })],
          executed: true,
        }),
        deriveTodoVerdict({ todoId: 'todo-3', requiredChecks: ['browser'], results: [], executed: false }),
      ],
      wholeRunChecks: [check({ scope: 'WHOLE_RUN', name: 'typecheck', mappingSource: 'NONE', todoId: undefined })],
    });

    expect(report.scope).toBe('TODO_SPECIFIC');
    expect(report.todosTotal).toBe(3);
    expect(report.todosVerified).toBe(1);
    expect(report.todosFailed).toBe(1);
    expect(report.todosNotTested).toBe(1);
    expect(report.wholeRunChecks).toHaveLength(1);
  });

  it('stays WHOLE_RUN when no todo carries todo-specific evidence', () => {
    const report = summarizeTodoVerification({
      verdicts: [
        deriveTodoVerdict({ todoId: 'todo-1', requiredChecks: [], results: [], executed: true }),
      ],
      wholeRunChecks: [],
    });
    expect(report.scope).toBe('WHOLE_RUN');
    expect(report.todosVerified).toBe(0);
  });
});

describe('Todo-attributable requirements', () => {
  it('treats route- and endpoint-level requirements as attributable', () => {
    expect(isTodoAttributableRequirement('browser')).toBe(true);
    expect(isTodoAttributableRequirement('api')).toBe(true);
    expect(isTodoAttributableRequirement('database-read-check')).toBe(true);
  });

  it('treats whole-project requirements as non-attributable', () => {
    expect(isTodoAttributableRequirement('typecheck')).toBe(false);
    expect(isTodoAttributableRequirement('lint')).toBe(false);
    expect(isTodoAttributableRequirement('deterministic')).toBe(false);
  });
});
