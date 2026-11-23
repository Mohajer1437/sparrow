/**
 * R3.30/R3.31: expansion metrics must come from what a run recorded, and must
 * never flatter the system by crediting expansion for a repair that succeeded
 * without it.
 */

import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { aggregateReliability } from '../../../src/core/reliability/reliability-aggregator';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { makeSnapshot } from './fixtures/reliability-fixtures';

function expansion(over: Record<string, unknown> = {}) {
  return {
    attemptId: 'attempt-2',
    attemptNumber: 2,
    expansionLevel: 1,
    decision: 'EXPAND_CONTEXT',
    reason: 'failure evidence names missing MISSING_DEPENDENCY',
    selectedFiles: ['src/auth/session.ts'],
    candidates: [],
    rejected: [],
    missingEvidence: [],
    previousContextFingerprint: 'aaaa0000',
    contextFingerprint: 'bbbb1111',
    newFiles: ['src/auth/session.ts'],
    changedFiles: [],
    unchangedFiles: ['middleware.ts'],
    hasNewEvidence: true,
    duplicatePlan: false,
    ...over,
  };
}

function snapshot(over: Record<string, unknown> = {}): TaskRunSnapshot {
  return makeSnapshot({
    contextStrategy: { repairMode: true },
    repair: { outcome: 'PROCEED', attempts: [], expansion: expansion() },
    ...over,
  } as any);
}

function failedWithExpansion(over: Record<string, unknown>): TaskRunSnapshot {
  return snapshot({
    status: 'FAILED',
    verification: undefined,
    repair: { outcome: 'PROCEED', attempts: [], expansion: expansion(over) },
  });
}

describe('R3.30 reliability reflects expansion accurately', () => {
  it('records the files an expansion added', () => {
    const record = buildReliabilityRecord(snapshot());
    expect(record.repair.contextExpansionUsed).toBe(true);
    expect(record.repair.expandedFiles).toBe(1);
  });

  it('credits success to expansion only when expansion actually happened', () => {
    const withExpansion = buildReliabilityRecord(snapshot());
    expect(withExpansion.repair.succeeded).toBe(true);
    expect(withExpansion.repair.succeededAfterExpansion).toBe(true);

    const withoutExpansion = buildReliabilityRecord(snapshot({
      repair: {
        outcome: 'PROCEED',
        attempts: [],
        expansion: expansion({
          decision: 'REPAIR_WITH_EXISTING_CONTEXT',
          expansionLevel: 0,
          selectedFiles: [],
          newFiles: [],
          hasNewEvidence: false,
        }),
      },
    }));
    expect(withoutExpansion.repair.succeeded).toBe(true);
    // Succeeded, but not because context grew. This must not be inflated.
    expect(withoutExpansion.repair.succeededAfterExpansion).toBe(false);
  });

  it('records a no-new-evidence stop', () => {
    const record = buildReliabilityRecord(failedWithExpansion({
      decision: 'STOP',
      stopCode: 'NO_NEW_EVIDENCE',
      selectedFiles: [],
      hasNewEvidence: false,
      duplicatePlan: true,
    }));
    expect(record.repair.stoppedForNoNewEvidence).toBe(true);
    expect(record.repair.succeededAfterExpansion).toBe(false);
  });

  it('records an expansion-limit stop', () => {
    const record = buildReliabilityRecord(failedWithExpansion({
      decision: 'STOP',
      stopCode: 'EXPANSION_LIMIT_REACHED',
      expansionLevel: 2,
      selectedFiles: [],
    }));
    expect(record.repair.stoppedForExpansionLimit).toBe(true);
  });

  it('records that the run said it needed context it could not find', () => {
    const record = buildReliabilityRecord(failedWithExpansion({
      decision: 'NEEDS_CONTEXT',
      stopCode: 'NEEDS_CONTEXT',
      selectedFiles: [],
      hasNewEvidence: false,
    }));
    expect(record.repair.needsContext).toBe(true);
  });

  it('treats a repair with no expansion record as not having expanded', () => {
    const record = buildReliabilityRecord(snapshot({
      repair: { outcome: 'PROCEED', attempts: [] },
    }));
    expect(record.repair.contextExpansionUsed).toBe(false);
    expect(record.repair.expandedFiles).toBe(0);
    expect(record.repair.succeededAfterExpansion).toBe(false);
  });
});

describe('R3.31 aggregate metrics have explicit denominators', () => {
  it('splits the repair population into expanded and not expanded', () => {
    const expanded = buildReliabilityRecord(snapshot());
    const plain = buildReliabilityRecord(snapshot({
      taskId: 'task-2',
      repair: { outcome: 'PROCEED', attempts: [] },
    }));

    const summary = aggregateReliability([expanded, plain]);
    expect(summary.repair.repairsWithExpansion + summary.repair.repairsWithoutExpansion)
      .toBe(summary.repair.repairRuns);
    expect(summary.repair.repairsWithExpansion).toBe(1);
    expect(summary.repair.successfulRepairsAfterExpansion).toBe(1);
  });
});
