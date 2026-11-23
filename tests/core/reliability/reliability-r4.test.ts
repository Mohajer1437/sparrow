/**
 * R4.33: reliability has to separate a repair that fixed the problem from one
 * that made the evidence of the problem disappear. A run that reports
 * COMPLETED with passing verification is exactly what an acceptance-chasing
 * repair produces, so the metrics may not be derived from that alone.
 */

import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { aggregateReliability } from '../../../src/core/reliability/reliability-aggregator';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { makeSnapshot } from './fixtures/reliability-fixtures';

function target(over: Record<string, unknown> = {}) {
  return {
    attemptId: 'attempt-2',
    attemptNumber: 2,
    originalTask: 'Fix the CrashBeacon component',
    acceptanceCriteria: ['The page renders the beacon'],
    intent: 'FIX_BUG',
    intentConfidence: 'EVIDENCED',
    originalTodoId: 'todo-1',
    originalFiles: ['app/page.tsx'],
    allowedFiles: ['app/page.tsx'],
    allowedOperations: ['ADD', 'MODIFY'],
    proposedFiles: ['app/page.tsx'],
    proposedOperations: ['MODIFY'],
    disallowedFiles: [],
    decision: 'ALLOW',
    decisionReason: 'in scope',
    findings: [],
    ...over,
  };
}

function finding(kind: string, severity = 'BLOCKING') {
  return { kind, severity, subject: 'app/page.tsx', reason: 'r', evidenceRef: 'e' };
}

function snapshot(over: Record<string, unknown> = {}): TaskRunSnapshot {
  return makeSnapshot({
    contextStrategy: { repairMode: true },
    repair: { outcome: 'PROCEED', attempts: [], target: target() },
    ...over,
  } as any);
}

describe('R4.33 legitimate repair success versus a suppressed symptom', () => {
  it('credits a clean repair as a legitimate success', () => {
    const record = buildReliabilityRecord(snapshot({
      repair: {
        outcome: 'PROCEED',
        attempts: [],
        target: target({
          completion: {
            state: 'PRIMARY_RESOLVED',
            succeeded: true,
            primaryResolved: true,
            acceptancePreserved: true,
            verificationPassed: true,
            scopeRespected: true,
            reason: 'ok',
          },
        }),
      },
    }));
    expect(record.repair.repairTargetValid).toBe(true);
    expect(record.repair.legitimateRepairSuccess).toBe(true);
    expect(record.repair.acceptanceChasingDetected).toBe(false);
  });

  it('refuses to credit a repair that only made the symptom vanish', () => {
    const record = buildReliabilityRecord(snapshot({
      status: 'FAILED',
      verification: undefined,
      repair: {
        outcome: 'REPAIR_ACCEPTANCE_CHASING',
        attempts: [],
        target: target({
          decision: 'BLOCK',
          findings: [finding('ACCEPTANCE_CHASING')],
          completion: {
            state: 'ACCEPTANCE_CHASING_DETECTED',
            succeeded: false,
            primaryResolved: false,
            acceptancePreserved: false,
            verificationPassed: true,
            scopeRespected: true,
            reason: 'gutted',
          },
        }),
      },
    }));
    expect(record.repair.acceptanceChasingDetected).toBe(true);
    expect(record.repair.repairTargetValid).toBe(false);
    expect(record.repair.legitimateRepairSuccess).toBe(false);
    expect(record.repair.suppressedSymptomRejected).toBe(true);
  });

  it('does not call a run legitimate when a blocking finding stands, even if it completed', () => {
    // The decisive case: run status and verification both look healthy.
    const record = buildReliabilityRecord(snapshot({
      repair: {
        outcome: 'PROCEED',
        attempts: [],
        target: target({ findings: [finding('ACCEPTANCE_CHASING')] }),
      },
    }));
    expect(record.repair.succeeded).toBe(true);
    expect(record.repair.legitimateRepairSuccess).toBe(false);
  });

  it.each([
    ['SCOPE_ESCAPE', 'scopeEscapeDetected'],
    ['TEST_MANIPULATION', 'testManipulationDetected'],
    ['VERIFICATION_BYPASS', 'verificationBypassDetected'],
    ['INTENT_MISMATCH', 'intentMismatchDetected'],
  ])('records a %s finding as %s', (kind, field) => {
    const record = buildReliabilityRecord(snapshot({
      repair: { outcome: 'PROCEED', attempts: [], target: target({ findings: [finding(kind)] }) },
    }));
    expect((record.repair as any)[field]).toBe(true);
    expect(record.repair.repairTargetValid).toBe(false);
  });

  it('records a suspicious config bypass without calling the target invalid', () => {
    const record = buildReliabilityRecord(snapshot({
      repair: {
        outcome: 'PROCEED',
        attempts: [],
        target: target({ findings: [finding('CONFIG_BYPASS', 'SUSPICIOUS')] }),
      },
    }));
    expect(record.repair.configBypassDetected).toBe(true);
    expect(record.repair.repairTargetValid).toBe(true);
  });

  it('treats a run with no targeting record as valid rather than guessing', () => {
    const record = buildReliabilityRecord(makeSnapshot({} as any));
    expect(record.repair.repairTargetValid).toBe(true);
    expect(record.repair.acceptanceChasingDetected).toBe(false);
  });
});

describe('R4.33 aggregation uses explicit denominators', () => {
  it('counts targeting outcomes over the repair population', () => {
    const clean = snapshot({
      repair: {
        outcome: 'PROCEED',
        attempts: [],
        target: target({
          completion: {
            state: 'PRIMARY_RESOLVED', succeeded: true, primaryResolved: true,
            acceptancePreserved: true, verificationPassed: true, scopeRespected: true, reason: 'ok',
          },
        }),
      },
    });
    const chasing = snapshot({
      status: 'FAILED',
      verification: undefined,
      repair: {
        outcome: 'REPAIR_ACCEPTANCE_CHASING',
        attempts: [],
        target: target({ decision: 'BLOCK', findings: [finding('ACCEPTANCE_CHASING')] }),
      },
    });
    const escape = snapshot({
      status: 'FAILED',
      verification: undefined,
      repair: {
        outcome: 'REPAIR_TARGET_REJECTED',
        attempts: [],
        target: target({ decision: 'BLOCK', findings: [finding('SCOPE_ESCAPE')] }),
      },
    });

    const report = aggregateReliability(
      [clean, chasing, escape].map(buildReliabilityRecord),
    );
    const repair = report.repair;

    expect(repair.repairRuns).toBe(3);
    expect(repair.acceptanceChasingDetected).toBe(1);
    expect(repair.scopeEscapeDetected).toBe(1);
    expect(repair.suppressedSymptomRejected).toBe(1);
    expect(repair.repairTargetValid).toBe(1);
    // Legitimate success is denominated by successes, not by repair runs, so
    // the two rejected repairs cannot inflate it.
    expect(repair.legitimateRepairSuccess).toBe(1);
    expect(repair.succeeded).toBe(1);
  });
});
