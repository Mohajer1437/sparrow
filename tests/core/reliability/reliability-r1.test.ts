/**
 * R1.29-R1.33 — reliability must carry the new evidence, keep read-only runs
 * out of mutation metrics, and refuse to call an unevidenced run clean.
 */

import { aggregateReliability } from '../../../src/core/reliability/reliability-aggregator';
import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { makeSnapshot, makeTodo, makeTodoPlan } from './fixtures/reliability-fixtures';

const NOW = new Date('2026-08-28T12:00:00.000Z');

type WorkspaceComparisonView = NonNullable<TaskRunSnapshot['workspaceComparison']>;

function cleanWorkspaceComparison(): WorkspaceComparisonView {
  return {
    state: 'PROVEN',
    basis: 'hash comparison over 2 candidate paths',
    intendedFiles: ['app/page.tsx'],
    intendedChangedFiles: ['app/page.tsx'],
    actualChangedFiles: ['app/page.tsx'],
    unintendedChangedFiles: [],
    missingExpectedChanges: [],
    preExistingDirtyFiles: ['data/saved_cards.json'],
    createdFiles: [],
    deletedFiles: [],
    wrongFileModification: 'NOT_PROVEN',
  };
}

describe('ReliabilityRecord R1 evidence (R1.29)', () => {
  it('carries executionMode, workspace comparison and todo verification', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      executionMode: 'STANDARD',
      workspaceComparison: cleanWorkspaceComparison(),
      todoVerification: {
        scope: 'TODO_SPECIFIC',
        wholeRunCheckCount: 1,
        todosTotal: 1,
        todosVerified: 1,
        todosFailed: 0,
        todosBlocked: 0,
        todosUnknown: 0,
        todosNotTested: 0,
        verdicts: [{
          todoId: 'todo-1',
          verdict: 'PASS',
          scope: 'TODO_SPECIFIC',
          requiredChecks: ['browser'],
          executedChecks: ['c-browser'],
          missingChecks: [],
          reason: 'all mapped todo-specific checks passed',
        }],
      },
    }));

    expect(record.executionMode).toBe('STANDARD');
    expect(record.readOnly).toBe(false);
    expect(record.workspaceComparison?.state).toBe('PROVEN');
    expect(record.todoCoverage.verified).toBe(1);
  });

  it('uses the workspace comparison for wrong-file detection (R1.31)', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: {
        ...cleanWorkspaceComparison(),
        intendedChangedFiles: [],
        actualChangedFiles: ['app/layout.tsx'],
        unintendedChangedFiles: ['app/layout.tsx'],
        missingExpectedChanges: ['app/page.tsx'],
        wrongFileModification: 'PROVEN',
      },
    }));

    expect(record.execution.wrongFileModification).toBe('PROVEN');
    expect(record.execution.unintendedChangedFiles).toEqual(['app/layout.tsx']);
    expect(record.suspicion.suspicious).toBe(true);
  });

  it('keeps a pre-existing dirty file out of unintended changes (R1.13)', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: cleanWorkspaceComparison(),
    }));

    expect(record.execution.unintendedChangedFiles).toEqual([]);
    expect(record.execution.wrongFileModification).toBe('NOT_PROVEN');
  });
});

describe('Read-only classification (R1.24, R1.32)', () => {
  const readOnly = () => makeSnapshot({
    taskId: 'task-read-only',
    executionMode: 'READ_ONLY',
    task: 'Inspect app/page.tsx and explain its current structure',
    touchedFiles: [],
    workspaceIntegrity: {
      filesModified: [],
      filesCreated: [],
      filesDeleted: [],
      unexpectedChanges: [],
      hasUnexpectedChanges: false,
    },
  });

  it('never counts a read-only run as a first-pass mutation success', () => {
    const record = buildReliabilityRecord(readOnly());
    expect(record.readOnly).toBe(true);
    expect(record.firstPassSuccess).toBe(false);
    expect(record.populations).toContain('READ_ONLY_INSPECTION');
    expect(record.populations).not.toContain('MUTATING_EXECUTION');
  });

  it('excludes read-only runs from the mutation success denominator', () => {
    const mutating = buildReliabilityRecord(makeSnapshot({ taskId: 'task-mutating' }));
    const inspection = buildReliabilityRecord(readOnly());

    const report = aggregateReliability([mutating, inspection], { now: NOW, minSampleSize: 1 });
    const firstPass = report.rates.find(entry => entry.name === 'firstPassSuccessRate');

    expect(firstPass?.population).toBe('MUTATING_EXECUTION');
    expect(firstPass?.denominator).toBe(1);
    expect(report.totals.readOnlyInspection).toBe(1);
    expect(report.totals.mutatingExecution).toBe(1);
  });
});

describe('Suspicious success (R1.33)', () => {
  it('flags a mutating success with no workspace evidence at all', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: undefined,
      workspaceIntegrity: undefined,
    }));

    expect(record.suspicion.suspicious).toBe(true);
    expect(record.suspicion.findings.map(f => f.code)).toContain('WORKSPACE_EVIDENCE_MISSING');
  });

  it('flags a mutating success whose comparison could not be completed', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: {
        ...cleanWorkspaceComparison(),
        state: 'INSUFFICIENT_EVIDENCE',
        basis: 'snapshot budget exceeded',
        intendedChangedFiles: [],
        actualChangedFiles: [],
        wrongFileModification: 'INSUFFICIENT_EVIDENCE',
      },
    }));

    expect(record.suspicion.findings.map(f => f.code)).toContain('WORKSPACE_EVIDENCE_INSUFFICIENT');
  });

  it('flags a success whose planned file never changed', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: {
        ...cleanWorkspaceComparison(),
        intendedChangedFiles: [],
        actualChangedFiles: [],
        missingExpectedChanges: ['app/page.tsx'],
      },
    }));

    expect(record.suspicion.findings.map(f => f.code)).toContain('MISSING_EXPECTED_CHANGE');
  });

  it('does not call an unchanged planned file a missing change in a read-only run', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      executionMode: 'READ_ONLY',
      workspaceComparison: {
        ...cleanWorkspaceComparison(),
        intendedChangedFiles: [],
        actualChangedFiles: [],
        missingExpectedChanges: ['app/page.tsx'],
      },
    }));

    expect(record.suspicion.findings.map(f => f.code)).not.toContain('MISSING_EXPECTED_CHANGE');
  });

  it('flags a todo that declared an attributable requirement but got only whole-run evidence', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: cleanWorkspaceComparison(),
      todoPlan: makeTodoPlan({ todos: [makeTodo({ verificationRequirements: ['browser'] })] }),
    }));

    expect(record.suspicion.findings.map(f => f.code)).toContain('TODO_VERIFICATION_MISSING');
  });

  it('does not flag a todo whose only requirement is inherently whole-run', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: cleanWorkspaceComparison(),
      todoPlan: makeTodoPlan({ todos: [makeTodo({ verificationRequirements: ['deterministic'] })] }),
    }));

    expect(record.suspicion.findings.map(f => f.code)).not.toContain('TODO_VERIFICATION_MISSING');
  });

  it('flags an undeclared verification side effect (R1.27)', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceComparison: cleanWorkspaceComparison(),
      verificationSideEffects: {
        policy: 'CONTROLLED_MUTATION',
        performedCount: 1,
        blockedCount: 0,
        undeclaredCount: 1,
        effects: [{
          id: 'unknown-probe',
          source: 'api-verifier',
          kind: 'HTTP_MUTATION',
          target: 'POST /api/cards',
          policy: 'CONTROLLED_MUTATION',
          status: 'PERFORMED',
          declared: false,
          reversible: false,
          detail: 'probe wrote data/saved_cards.json',
        }],
      },
    }));

    expect(record.suspicion.findings.map(f => f.code)).toContain('UNDECLARED_VERIFICATION_SIDE_EFFECT');
  });
});
