/**
 * R2.23 — mutation evidence must reach the reliability record intact, count
 * correctly, and never let an absent ledger read as a clean run.
 */

import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { projectTaskRun } from '../../../src/app/task-run-projection';
import { TaskRunMutationSafety } from '../../../src/domain/task-run';
import { buildMutationLedger } from '../../../src/domain/execution/mutation-safety';
import { makeSnapshot } from './fixtures/reliability-fixtures';

function mutationEntry(over: Partial<TaskRunMutationSafety['mutations'][number]> = {}) {
  return {
    path: 'app/page.tsx',
    operation: 'modify',
    toolName: 'write_file',
    status: 'APPLIED',
    decision: 'ALLOW',
    beforeHash: 'aaa',
    afterHash: 'bbb',
    changed: true,
    syntaxValid: true,
    expectedChangePresent: true,
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    linesAdded: 1,
    linesRemoved: 0,
    bytesBefore: 100,
    bytesAfter: 120,
    failureCodes: [] as string[],
    ...over,
  };
}

function mutationSafety(over: Partial<TaskRunMutationSafety> = {}): TaskRunMutationSafety {
  return {
    mutationAttempts: 1,
    successfulMutations: 1,
    rejectedMutations: 0,
    blockedMutations: 0,
    rolledBackMutations: 0,
    failedMutations: 0,
    syntaxFailures: 0,
    unexpectedDiffs: 0,
    expectedChangeFailures: 0,
    rollbackFailures: 0,
    outOfScopeAttempts: 0,
    mutations: [mutationEntry()],
    ...over,
  };
}

describe('ReliabilityRecord mutation evidence (R2.23)', () => {
  it('carries a successful mutation through to the record', () => {
    const record = buildReliabilityRecord(makeSnapshot({ mutationSafety: mutationSafety() }));
    expect(record.mutationSafety.present).toBe(true);
    expect(record.mutationSafety.attempts).toBe(1);
    expect(record.mutationSafety.applied).toBe(1);
    expect(record.mutationSafety.state).toBe('PROVEN');
  });

  it('counts rejection, blocking, rollback and syntax failures separately', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      mutationSafety: mutationSafety({
        mutationAttempts: 4,
        successfulMutations: 0,
        rejectedMutations: 1,
        blockedMutations: 1,
        rolledBackMutations: 1,
        failedMutations: 1,
        syntaxFailures: 2,
        outOfScopeAttempts: 1,
        mutations: [
          mutationEntry({ status: 'REJECTED', syntaxValid: false, failureCodes: ['SYNTAX_INVALID'] }),
          mutationEntry({ status: 'BLOCKED', failureCodes: ['TARGET_OUT_OF_SCOPE'] }),
          mutationEntry({ status: 'ROLLED_BACK', rolledBack: true, rollbackVerified: true }),
          mutationEntry({ status: 'FAILED', failureCodes: ['ROLLBACK_FAILED'] }),
        ],
      }),
    }));

    expect(record.mutationSafety.rejected).toBe(1);
    expect(record.mutationSafety.blocked).toBe(1);
    expect(record.mutationSafety.rolledBack).toBe(1);
    expect(record.mutationSafety.failed).toBe(1);
    expect(record.mutationSafety.syntaxFailures).toBe(2);
    expect(record.mutationSafety.outOfScopeAttempts).toBe(1);
  });

  it('represents a suspicious mutation without turning it into a failure', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      mutationSafety: mutationSafety({
        unexpectedDiffs: 1,
        mutations: [mutationEntry({ suspicious: true, decision: 'WARN' })],
      }),
    }));
    expect(record.mutationSafety.suspiciousDiffs).toBe(1);
    expect(record.mutationSafety.applied).toBe(1);
  });

  it('flags a recorded success that sits on top of a rolled-back mutation', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      status: 'COMPLETED',
      mutationSafety: mutationSafety({ successfulMutations: 0, rolledBackMutations: 1 }),
    }));
    expect(record.suspicion.findings.map(f => f.code)).toContain('MUTATION_ROLLED_BACK');
    expect(record.suspicion.suspicious).toBe(true);
  });

  it('flags a failed rollback at any outcome, because workspace state is then unknown', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      status: 'FAILED',
      mutationSafety: mutationSafety({ rollbackFailures: 1 }),
    }));
    expect(record.suspicion.findings.map(f => f.code)).toContain('MUTATION_ROLLBACK_FAILED');
  });

  it('keeps historical records readable and never reads an absent ledger as clean', () => {
    const record = buildReliabilityRecord(makeSnapshot({}));
    expect(record.mutationSafety.present).toBe(false);
    expect(record.mutationSafety.state).toBe('UNKNOWN');
    expect(record.mutationSafety.attempts).toBe(0);
    expect(record.mutationSafety.basis).toMatch(/no executor mutation evidence/);
  });
});

describe('Mutation evidence projection (R2.18)', () => {
  it('projects a workflow ledger onto the task run snapshot without file bodies', () => {
    const ledger = buildMutationLedger([{
      toolName: 'write_file',
      status: 'ROLLED_BACK',
      blockedBeforeWrite: false,
      findings: [],
      results: [{
        path: 'app/page.tsx',
        operation: 'modify',
        toolName: 'write_file',
        status: 'ROLLED_BACK',
        beforeState: 'PRESENT',
        afterState: 'PRESENT',
        beforeHash: 'before-hash',
        afterHash: 'after-hash',
        changed: true,
        syntaxValid: false,
        syntaxDetail: 'line 7:3 unexpected token',
        expectedChangePresent: null,
        expectedMarkers: [],
        diffSummary: {
          linesAdded: 3, linesRemoved: 1, bytesBefore: 200, bytesAfter: 190, linesBefore: 10, linesAfter: 12,
        },
        suspicious: false,
        rolledBack: true,
        rollbackVerified: true,
        afterRollbackHash: 'before-hash',
        decision: 'ROLLBACK',
        findings: [{ level: 'LEVEL_3_SYNTAX', code: 'SYNTAX_INVALID', detail: 'line 7:3 unexpected token' }],
      }],
    }] as never);

    const snapshot = projectTaskRun({
      taskId: 'task-1',
      task: 'Add a JSX comment',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-08-29T10:00:00.000Z',
      success: false,
      workflowResult: { sessionId: 's1', success: false, mutationLedger: ledger } as never,
    });

    expect(snapshot.mutationSafety).toBeDefined();
    expect(snapshot.mutationSafety!.rolledBackMutations).toBe(1);
    const entry = snapshot.mutationSafety!.mutations[0];
    expect(entry.path).toBe('app/page.tsx');
    expect(entry.beforeHash).toBe('before-hash');
    expect(entry.afterRollbackHash).toBe('before-hash');
    expect(entry.failureCodes).toEqual(['SYNTAX_INVALID']);
    expect(JSON.stringify(entry)).not.toContain('export default');
  });

  it('leaves mutationSafety absent when the run produced no ledger', () => {
    const snapshot = projectTaskRun({
      taskId: 'task-2',
      task: 'plan only',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      startedAt: '2026-08-29T10:00:00.000Z',
      success: true,
      workflowResult: { sessionId: 's2', success: true } as never,
    });
    expect(snapshot.mutationSafety).toBeUndefined();
  });
});
