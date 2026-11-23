import { evaluateRepairSafety } from '../../../src/core/repair/repair-context';
import { emptyRepairHistory } from '../../../src/domain/repair-intelligence';
import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';

describe('repair safety', () => {
  it('does not invent scope when files and failed Todo are unknown', () => {
    expect(evaluateRepairSafety({
      failedTodoId: undefined,
      candidateFiles: [],
      history: emptyRepairHistory(),
    })).toBe('NEEDS_CONTEXT');
  });

  it('blocks when a Todo is known but no files can be established', () => {
    expect(evaluateRepairSafety({
      failedTodoId: 'todo-2',
      candidateFiles: [],
      history: emptyRepairHistory(),
    })).toBe('BLOCKED');
  });

  it('returns REPAIR_LIMIT_REACHED without guessing', () => {
    expect(evaluateRepairSafety({
      failedTodoId: 'todo-2',
      candidateFiles: ['middleware.ts'],
      history: emptyRepairHistory(),
      limitState: 'REPAIR_LIMIT_REACHED',
    })).toBe('REPAIR_LIMIT_REACHED');
  });

  it('proceeds when implicated files exist', () => {
    const failureContract = buildFailureContract({
      profile: 'STANDARD',
      checks: [{
        id: 'intent-authz',
        category: 'api',
        name: 'authz',
        passed: false,
        severity: 'HIGH',
        evidence: 'source: middleware.ts; Expected: 401; Actual: 500',
      }],
    });
    expect(evaluateRepairSafety({
      failureContract,
      failedTodoId: 'todo-2',
      candidateFiles: ['middleware.ts'],
      history: emptyRepairHistory(),
    })).toBe('PROCEED');
  });
});
