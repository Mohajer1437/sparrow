import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { aggregateReliability } from '../../../src/core/reliability/reliability-aggregator';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { makeSnapshot } from './fixtures/reliability-fixtures';

describe('R5 Reliability Metrics & Integration (R5.27, R5.28)', () => {
  it('correctly derives confirmation dimensions from TaskRunSnapshot', () => {
    const snapshot: TaskRunSnapshot = makeSnapshot({
      confirmation: {
        requestId: 'conf-101',
        type: 'DESTRUCTIVE_REPAIR',
        status: 'APPROVED',
        reason: 'Repair target needs confirmation',
        risk: 'HIGH',
        requestedAction: 'APPLY_REPAIR',
        affectedFiles: ['app/CrashBeacon.tsx'],
        decision: {
          decision: 'APPROVE',
          actor: 'cli-user',
          decidedAt: '2026-08-29T12:00:00.000Z',
        },
      },
      abortReason: undefined,
    });

    const record = buildReliabilityRecord(snapshot);
    expect(record.confirmation).toBeDefined();
    expect(record.confirmation?.confirmationRequired).toBe(true);
    expect(record.confirmation?.confirmationApproved).toBe(true);
    expect(record.confirmation?.confirmationRejected).toBe(false);
    expect(record.confirmation?.requestId).toBe('conf-101');
  });

  it('correctly records rejected confirmation outcome', () => {
    const snapshot: TaskRunSnapshot = makeSnapshot({
      status: 'FAILED',
      confirmation: {
        requestId: 'conf-102',
        type: 'HIGH_RISK_CHANGE',
        status: 'REJECTED',
        reason: 'User rejected',
        risk: 'HIGH',
        decision: {
          decision: 'REJECT',
          actor: 'cli-user',
          decidedAt: '2026-08-29T12:00:00.000Z',
          reason: 'Declined by user',
        },
      },
      abortReason: 'CONFIRMATION_REJECTED: User rejected execution in prompt',
    });

    const record = buildReliabilityRecord(snapshot);
    expect(record.confirmation?.confirmationRequired).toBe(true);
    expect(record.confirmation?.confirmationRejected).toBe(true);
    expect(record.confirmation?.confirmationApproved).toBe(false);
  });

  it('correctly aggregates confirmation summary across multiple runs (R5.27)', () => {
    const records = [
      buildReliabilityRecord(makeSnapshot({
        confirmation: {
          requestId: 'c1',
          type: 'HIGH_RISK_CHANGE',
          status: 'APPROVED',
        },
      })),
      buildReliabilityRecord(makeSnapshot({
        confirmation: {
          requestId: 'c2',
          type: 'DESTRUCTIVE_REPAIR',
          status: 'REJECTED',
        },
        abortReason: 'CONFIRMATION_REJECTED',
      })),
      buildReliabilityRecord(makeSnapshot({
        confirmation: {
          requestId: 'c3',
          type: 'REQUIRES_TEST_CREDENTIAL',
          status: 'APPROVED',
          decision: {
            decision: 'PROVIDE',
            actor: 'cli-user',
            decidedAt: '2026-08-29T12:00:00.000Z',
          },
        },
      })),
    ];

    const report = aggregateReliability(records);
    expect(report.confirmation).toBeDefined();
    expect(report.confirmation?.confirmationRequiredRuns).toBe(3);
    expect(report.confirmation?.approvedRuns).toBe(2);
    expect(report.confirmation?.rejectedRuns).toBe(1);
    expect(report.confirmation?.credentialRequestedRuns).toBe(1);
    expect(report.confirmation?.credentialProvidedRuns).toBe(1);
  });
});
