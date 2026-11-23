import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { buildRepairContext, expandRepairFiles } from '../../../src/core/repair/repair-context';
import { DEFAULT_REPAIR_LIMITS, emptyRepairHistory } from '../../../src/domain/repair-intelligence';
import { appendRepairAttempt } from '../../../src/core/repair/repair-attempt-history';
import { VerificationCheck } from '../../../src/domain/verification-check';

describe('repair context', () => {
  const checks: VerificationCheck[] = [{
    id: 'intent-authz-post--api-save',
    category: 'api',
    name: 'Intent POST /api/save',
    passed: false,
    severity: 'HIGH',
    evidence: 'Expected: 401; Actual: 500; source: middleware.ts',
  }];
  const failureContract = buildFailureContract({
    profile: 'STANDARD',
    checks,
    attempt: 1,
  })!;

  it('includes failure, failed Todo, attempt history, and relevant files', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'ORIGINAL',
      failedTodoId: 'todo-2',
      todoIds: ['todo-2'],
      planFingerprint: 'middleware.ts::modify|Fix|middleware.ts',
      filesTouched: ['middleware.ts'],
      expected: '401',
      actual: '500',
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: ['intent-authz-post--api-save'],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    const context = buildRepairContext({
      originalTask: 'Fix POST /api/save authorization in middleware.ts',
      failureContract,
      failedTodoId: 'todo-2',
      failedTodoFiles: ['middleware.ts'],
      history,
      expansionLevel: 0,
      limits: DEFAULT_REPAIR_LIMITS,
    });
    expect(context.failureContract?.id).toBe(failureContract.id);
    expect(context.failedTodoId).toBe('todo-2');
    expect(context.history.attempts).toHaveLength(1);
    expect(context.candidateFiles).toContain('middleware.ts');
    expect(context.candidateFiles).not.toContain('src/unrelated.ts');
    expect(context.candidateFiles).toEqual([...context.candidateFiles].sort((a, b) => a.localeCompare(b)));
  });

  // R3 changed this deliberately. The seed set used to grow at level 1 by
  // synthesising `<dir>/error.ts`, `<dir>/service.ts`, `<file>.test.ts` and
  // friends whether or not those files existed, which is precisely the
  // hallucinated candidate R3 forbids. Widening is now the job of
  // generateExpansionCandidates, which only emits files evidence points at.
  it('keeps the seed set to files the evidence named, at every level', () => {
    const level0 = expandRepairFiles(['middleware.ts'], 0, 8);
    const level1 = expandRepairFiles(['middleware.ts'], 1, 8);
    const level2 = expandRepairFiles(['middleware.ts'], 2, 8);
    expect(level0).toEqual(['middleware.ts']);
    expect(level1).toEqual(['middleware.ts']);
    expect(level2).toEqual(['middleware.ts']);
    expect(level1.some(file => file.endsWith('.test.ts') || file === 'error.ts' || file === 'service.ts'))
      .toBe(false);
  });

  it('stays deterministic and bounded for a multi-file seed', () => {
    const seed = ['b.ts', 'a.ts', 'a.ts', './c.ts', '../escape.ts'];
    const files = expandRepairFiles(seed, 1, 2);
    expect(files).toEqual(['a.ts', 'b.ts']);
    expect(expandRepairFiles(seed, 1, 2)).toEqual(files);
  });

  it('cannot expand at all without a workspace to check candidates against', () => {
    const context = buildRepairContext({
      originalTask: 'Fix POST /api/save authorization in middleware.ts',
      failureContract,
      failedTodoId: 'todo-2',
      failedTodoFiles: ['middleware.ts'],
      expansionLevel: 0,
      limits: DEFAULT_REPAIR_LIMITS,
    });
    expect(context.expandedFiles).toEqual([]);
    expect(context.expansionLevel).toBe(0);
  });
});
