import {
  buildRepairObjective,
  inferProposedChanges,
  validateRepairPlan,
} from '../../../src/core/repair/repair-target-policy';
import { classifyRepairFile } from '../../../src/core/repair/file-classification';
import { RepairObjective } from '../../../src/domain/repair/repair-objective';
import { TodoItem, TodoPlan } from '../../../src/domain/todo-plan';

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    title: 'Update the page',
    description: 'Apply the requested change',
    reason: 'The task asks for it',
    files: ['app/page.tsx'],
    dependencies: [],
    skillIds: ['frontend.core'],
    verificationRequirements: ['typecheck'],
    risk: 'LOW',
    action: 'modify',
    ...over,
  } as TodoItem;
}

function plan(over: Partial<TodoPlan> = {}): TodoPlan {
  const todos = over.todos ?? [todo()];
  return {
    goal: 'goal',
    contextSummary: 'summary',
    affectedFiles: over.affectedFiles ?? todos.flatMap(item => [...item.files]),
    constraints: [],
    ...over,
    todos,
  } as TodoPlan;
}

function objective(over: Partial<RepairObjective> = {}): RepairObjective {
  const base = buildRepairObjective({
    originalTask: 'Fix the CrashBeacon component so the page renders',
    acceptanceCriteria: ['The page renders without a build error'],
    originalTodoPlan: plan({ todos: [todo({ files: ['app/page.tsx'] })] }),
    failedTodoId: 'todo-1',
    primaryFailure: 'build failed',
  });
  return { ...base, ...over } as RepairObjective;
}

/* --------------------------------------------------------------- objective */

describe('R4.1-R4.5 the objective is assembled from the original run', () => {
  it('carries the original task and acceptance criteria verbatim', () => {
    const result = objective();
    expect(result.originalTask).toBe('Fix the CrashBeacon component so the page renders');
    expect(result.acceptanceCriteria).toEqual(['The page renders without a build error']);
  });

  it('leaves acceptance criteria empty rather than inventing them', () => {
    const result = buildRepairObjective({ originalTask: 'Fix the page' });
    expect(result.acceptanceCriteria).toEqual([]);
  });

  it('takes allowed scope from the failed Todo, not from the whole plan', () => {
    const result = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan({
        todos: [
          todo({ id: 'todo-1', files: ['app/page.tsx'] }),
          todo({ id: 'todo-2', files: ['app/footer.tsx'] }),
        ],
      }),
      failedTodoId: 'todo-1',
    });
    expect(result.allowedFiles).toEqual(['app/page.tsx']);
  });

  it('widens scope only through structured evidence', () => {
    const result = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      mutationTargets: ['app/CrashBeacon.tsx'],
      expandedFiles: ['app/layout.tsx'],
    });
    expect(result.allowedFiles).toEqual(
      expect.arrayContaining(['app/page.tsx', 'app/CrashBeacon.tsx', 'app/layout.tsx']),
    );
  });
});

/* -------------------------------------------------------------- operations */

describe('R4.6 proposed operations are read from the plan', () => {
  it('reads a plain edit as MODIFY', () => {
    const changes = inferProposedChanges(plan());
    expect(changes[0].operations).toEqual(['MODIFY']);
  });

  it('reads deletion language as DELETE even when the todo calls itself a modify', () => {
    const changes = inferProposedChanges(plan({
      todos: [todo({ action: 'modify', title: 'Remove the CrashBeacon component' })],
    }));
    expect(changes[0].operations).toContain('DELETE');
  });

  it('proposes no operation for inspection-only todos', () => {
    const changes = inferProposedChanges(plan({
      todos: [todo({ action: 'inspect', files: ['app/page.tsx'] })],
      affectedFiles: [],
    }));
    expect(changes).toEqual([]);
  });
});

/* ------------------------------------------------------------------- scope */

describe('R4.5/R4.16 scope', () => {
  it('allows a repair to the same file', () => {
    const result = validateRepairPlan({ objective: objective(), repairPlan: plan() });
    expect(result.decision).toBe('ALLOW');
    expect(result.findings).toEqual([]);
  });

  it('allows an evidence-supported related file', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      mutationTargets: ['app/CrashBeacon.tsx'],
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({ todos: [todo({ files: ['app/CrashBeacon.tsx'] })] }),
    });
    expect(result.decision).toBe('ALLOW');
  });

  it('blocks an unrelated file as SCOPE_ESCAPE', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: plan({ todos: [todo({ files: ['app/footer.tsx'] })] }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('SCOPE_ESCAPE');
    expect(result.disallowedFiles).toEqual(['app/footer.tsx']);
  });

  it('blocks package.json when nothing supports it', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: plan({ todos: [todo({ files: ['package.json'] })] }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toEqual(
      expect.arrayContaining(['SCOPE_ESCAPE', 'CONFIG_BYPASS']),
    );
  });
});

/* -------------------------------------------------- acceptance and deletion */

describe('R4.11/R4.12 deletion versus deletion-as-workaround', () => {
  it('rejects deleting the component the task was about', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: plan({
        todos: [todo({ title: 'Delete the failing component', files: ['app/page.tsx'] })],
      }),
    });
    expect(result.decision).toBe('BLOCK');
    const kinds = result.findings.map(f => f.kind);
    expect(kinds).toContain('ACCEPTANCE_CHASING');
    expect(kinds).toContain('INTENT_MISMATCH');
  });

  it('permits deletion when the original task is a removal task', () => {
    const target = buildRepairObjective({
      originalTask: 'Remove the deprecated LegacyBanner component',
      originalTodoPlan: plan({ todos: [todo({ files: ['app/LegacyBanner.tsx'] })] }),
      failedTodoId: 'todo-1',
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({
        todos: [todo({ title: 'Delete LegacyBanner', files: ['app/LegacyBanner.tsx'] })],
      }),
    });
    expect(result.decision).toBe('ALLOW');
  });

  it('rejects disabling behaviour in a source file', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: plan({
        todos: [todo({ title: 'Comment out the failing render path', files: ['app/page.tsx'] })],
      }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('ACCEPTANCE_CHASING');
  });
});

/* -------------------------------------------------------- test manipulation */

describe('R4.13 test manipulation', () => {
  const testPlan = (title: string) =>
    plan({ todos: [todo({ title, files: ['tests/page.test.tsx'] })] });

  it('blocks deleting a failing test during a bug-fix task', () => {
    const result = validateRepairPlan({ objective: objective(), repairPlan: testPlan('Delete the failing test') });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('TEST_MANIPULATION');
  });

  it('blocks weakening an assertion', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: testPlan('Relax the assertion so it passes'),
    });
    expect(result.decision).toBe('BLOCK');
  });

  it('blocks skipping a test', () => {
    const result = validateRepairPlan({ objective: objective(), repairPlan: testPlan('Skip the broken test') });
    expect(result.decision).toBe('BLOCK');
  });

  it('flags an in-scope but unexplained test edit for confirmation rather than allowing it', () => {
    // The test file is inside the allowed scope here, so scope is not the
    // issue; the question is only whether a bug-fix task may edit a test.
    const target = buildRepairObjective({
      originalTask: 'Fix the CrashBeacon component so the page renders',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      implicatedFiles: ['tests/page.test.tsx'],
    });
    const result = validateRepairPlan({ objective: target, repairPlan: testPlan('Update the test file') });
    expect(result.decision).toBe('NEEDS_CONFIRMATION');
    expect(result.findings[0]).toMatchObject({ kind: 'TEST_MANIPULATION', severity: 'SUSPICIOUS' });
  });

  it('allows a legitimate test fix when that is the original task', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the failing unit test for the new expected behavior',
      originalTodoPlan: plan({ todos: [todo({ files: ['tests/page.test.tsx'] })] }),
      failedTodoId: 'todo-1',
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: testPlan('Update the expected value to the new behaviour'),
    });
    expect(result.decision).toBe('ALLOW');
  });

  it('still refuses to delete the test even during a test-fixing task', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the failing unit test for the new expected behavior',
      originalTodoPlan: plan({ todos: [todo({ files: ['tests/page.test.tsx'] })] }),
      failedTodoId: 'todo-1',
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: testPlan('Delete the failing test'),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('TEST_MANIPULATION');
  });
});

/* ------------------------------------------------------- config and bypass */

describe('R4.14/R4.15 configuration and verification bypass', () => {
  it('blocks disabling a lint rule to clear the failure', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      implicatedFiles: ['.eslintrc.json'],
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({ todos: [todo({ title: 'Disable the failing lint rule', files: ['.eslintrc.json'] })] }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('CONFIG_BYPASS');
  });

  it('blocks excluding a file from TypeScript', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      implicatedFiles: ['tsconfig.json'],
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({ todos: [todo({ title: 'Exclude the file from tsconfig', files: ['tsconfig.json'] })] }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('CONFIG_BYPASS');
  });

  it('blocks touching a verification artifact at all', () => {
    const target = buildRepairObjective({
      originalTask: 'Fix the page',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
      implicatedFiles: ['.ai/intent-contract.json'],
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({
        todos: [todo({ title: 'Remove the acceptance criterion', files: ['.ai/intent-contract.json'] })],
      }),
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('VERIFICATION_BYPASS');
  });
});

/* ---------------------------------------------------------- classification */

describe('R4.13/R4.14/R4.15 path classification', () => {
  it.each([
    ['app/page.tsx', 'SOURCE'],
    ['tests/page.test.tsx', 'TEST'],
    ['src/foo.spec.ts', 'TEST'],
    ['e2e/login.ts', 'TEST'],
    ['tsconfig.json', 'CONFIG'],
    ['.eslintrc.json', 'CONFIG'],
    ['package.json', 'CONFIG'],
    ['playwright.config.ts', 'CONFIG'],
    ['.ai/quality-policy.json', 'VERIFICATION'],
    ['README.md', 'DOC'],
  ])('classifies %s as %s', (file, expected) => {
    expect(classifyRepairFile(file)).toBe(expected);
  });
});

/* ------------------------------------------------------- conservative modes */

describe('R4.26 unknown stays unknown', () => {
  it('asks for confirmation when a destructive op has no intent or criteria to justify it', () => {
    const target = buildRepairObjective({
      originalTask: 'zzz qqq',
      originalTodoPlan: plan(),
      failedTodoId: 'todo-1',
    });
    const result = validateRepairPlan({
      objective: target,
      repairPlan: plan({ todos: [todo({ title: 'Rename the module', files: ['app/page.tsx'] })] }),
    });
    expect(target.intentConfidence).toBe('UNKNOWN');
    expect(result.decision).toBe('BLOCK');
    expect(result.findings.map(f => f.kind)).toContain('INTENT_MISMATCH');
  });

  it('reports UNKNOWN when the plan proposes nothing', () => {
    const result = validateRepairPlan({
      objective: objective(),
      repairPlan: plan({ todos: [todo({ action: 'inspect' })], affectedFiles: [] }),
    });
    expect(result.decision).toBe('UNKNOWN');
  });
});
