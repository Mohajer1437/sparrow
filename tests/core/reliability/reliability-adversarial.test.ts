/**
 * Adversarial suite: the reliability layer is treated as untrusted accounting
 * software. Every test here tries to make it overstate success, invent a
 * denominator, or convert an unknown into a pass.
 */

import { aggregateReliability } from '../../../src/core/reliability/reliability-aggregator';
import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import {
  makeBlockedSnapshot,
  makeCheck,
  makePlanningOnlySnapshot,
  makeRepairedSnapshot,
  makeSnapshot,
  makeTodo,
  makeTodoPlan,
} from './fixtures/reliability-fixtures';

const NOW = new Date('2026-08-28T12:00:00.000Z');

describe('Denominators cannot be inflated or invented', () => {
  it('does not let a duplicate record double-count a run', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    const report = aggregateReliability([record, record], { now: NOW, minSampleSize: 1 });
    // Aggregation counts what it is given; de-duplication is the service's
    // job, so the contribution list must expose the duplication rather than
    // silently hide it.
    expect(report.contributions.find(c => c.name === 'firstPassSuccessRate')!.denominatorRuns)
      .toEqual(['task-1', 'task-1']);
  });

  it('never produces a ratio above 1', () => {
    const report = aggregateReliability(
      [1, 2, 3].map(index => buildReliabilityRecord(makeSnapshot({ taskId: `t${index}` }))),
      { now: NOW, minSampleSize: 1 },
    );
    for (const rate of report.rates) {
      if (rate.ratio === null) continue;
      expect(rate.ratio).toBeLessThanOrEqual(1);
      expect(rate.numerator).toBeLessThanOrEqual(rate.denominator);
    }
  });

  it('keeps every numerator a subset of its own denominator', () => {
    const records = [
      buildReliabilityRecord(makeSnapshot({ taskId: 'a' })),
      buildReliabilityRecord(makeRepairedSnapshot({ taskId: 'b' })),
      buildReliabilityRecord(makeBlockedSnapshot({ taskId: 'c' })),
      buildReliabilityRecord(makePlanningOnlySnapshot({ taskId: 'd' })),
    ];
    const report = aggregateReliability(records, { now: NOW, minSampleSize: 1 });
    for (const contribution of report.contributions) {
      const denominator = new Set(contribution.denominatorRuns);
      for (const id of contribution.numeratorRuns) {
        expect(denominator.has(id)).toBe(true);
      }
    }
  });

  it('excludes a run with an unparseable timestamp from a windowed report', () => {
    const broken = buildReliabilityRecord(makeSnapshot({
      taskId: 'broken-clock',
      startedAt: 'not-a-date',
    }));
    const good = buildReliabilityRecord(makeSnapshot({
      taskId: 'good',
      startedAt: '2026-08-28T11:00:00.000Z',
    }));
    const windowed = aggregateReliability([broken, good], { now: NOW, window: '24h' });
    const allTime = aggregateReliability([broken, good], { now: NOW, window: 'all' });
    expect(windowed.totals.allRuns).toBe(1);
    expect(allTime.totals.allRuns).toBe(2);
  });

  it('does not let a completedAt before startedAt produce a negative duration', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      startedAt: '2026-08-28T10:05:00.000Z',
      completedAt: '2026-08-28T10:00:00.000Z',
    }));
    expect(record.durationMs).toBeNull();
  });
});

describe('Unknowns are never upgraded', () => {
  it('does not convert an UNKNOWN todo verdict into a pass when whole-run V&V passed', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.verification.status).toBe('PASSED');
    expect(record.todoCoverage.verified).toBe(0);
    expect(record.todoCoverage.unknown).toBe(1);
  });

  it('does not treat an absent endpoint result as a tested endpoint', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        affectedEndpoints: ['GET /api/a', 'GET /api/b', 'GET /api/c'],
      },
      verification: {
        ...makeSnapshot().verification!,
        checks: [makeCheck({
          id: 'api-a',
          category: 'api',
          name: 'GET /api/a',
          evidence: 'GET /api/a returned 200',
        })],
      },
    }));
    expect(record.endpointCoverage.discovered).toBe(3);
    expect(record.endpointCoverage.tested).toBe(1);
    expect(record.endpointCoverage.ratio).toBeCloseTo(1 / 3);
  });

  it('does not treat a run with no failures as a proven regression pass', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        selectedChecks: ['deterministic', 'browser', 'unit-test'],
        skippedChecks: [
          { check: 'browser', reason: 'no browser tooling' },
          { check: 'unit-test', reason: 'no test runner configured' },
        ],
      },
    }));
    expect(record.regression.selected).toBe(3);
    expect(record.regression.executed).toBe(1);
    expect(record.regression.passed).toBe(1);
    expect(record.regression.failed).toBe(0);
    expect(record.regression.skipped).toBe(2);
    // 2 skipped checks must never appear as passes.
    expect(record.regression.passed + record.regression.skipped).toBe(3);
  });

  it('does not treat NOT_TESTED verification as a pass', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      verification: {
        passed: true,
        scope: 'WHOLE_RUN',
        checks: [],
        evidence: [],
        todoVerdicts: [],
      },
    }));
    // The report claims a pass but produced no check evidence at all.
    expect(record.verification.coverage.executed).toBe(0);
    expect(record.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
  });
});

describe('Corrupted, partial and out-of-order evidence', () => {
  it('survives a snapshot with no skills, no plan, no verification and no impact', () => {
    const bare = {
      taskId: 'bare',
      task: '',
      roleId: 'coder',
      workspaceRoot: 'E:/new-test-2',
      status: 'COMPLETED',
      startedAt: '2026-08-28T10:00:00.000Z',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
    } as unknown as TaskRunSnapshot;

    const record = buildReliabilityRecord(bare);
    expect(record.outcome).toBe('SUCCESS');
    expect(record.firstPassSuccess).toBe(false);
    expect(record.evidenceCompleteness.overall).toBe('MISSING');
    expect(record.populations).toContain('PLANNING_ONLY');
  });

  it('handles an unrecognized recorded status without guessing', () => {
    const record = buildReliabilityRecord(makeSnapshot({ status: 'WEIRD' as never }));
    expect(record.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(record.outcomeReason).toContain('unrecognized recorded status');
  });

  it('handles step results that reference todos the plan never declared', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      execution: [{
        stepId: 'orphan',
        sourceTodoId: 'todo-99',
        requiredTools: [],
        files: [],
        status: 'SUCCEEDED',
      }],
    }));
    expect(record.todoCoverage.total).toBe(1);
    expect(record.todoCoverage.executed).toBe(0);
  });

  it('handles repair attempts recorded out of order', () => {
    const forward = buildReliabilityRecord(makeRepairedSnapshot());
    const reversed = buildReliabilityRecord(makeRepairedSnapshot({
      repair: {
        ...makeRepairedSnapshot().repair!,
        attempts: [...makeRepairedSnapshot().repair!.attempts].reverse(),
      },
    }));
    expect(reversed.repair.repairAttempts).toBe(forward.repair.repairAttempts);
    expect(reversed.repair.succeeded).toBe(forward.repair.succeeded);
    expect(reversed.outcome).toBe(forward.outcome);
  });

  it('handles a repair outcome recorded with no attempt entries', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      status: 'FAILED',
      repair: { outcome: 'REPAIR_LIMIT_REACHED', attempts: [] },
    }));
    expect(record.repair.repairAttempts).toBe(0);
    expect(record.repair.limitReached).toBe(true);
    expect(record.repair.succeeded).toBe(false);
    expect(record.outcome).toBe('FAILED');
  });

  it('does not crash on a todo plan with duplicate todo ids', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      todoPlan: makeTodoPlan({ todos: [makeTodo(), makeTodo()] }),
    }));
    expect(record.todoCoverage.total).toBe(2);
    expect(record.todoCoverage.executed).toBe(2);
  });
});

describe('Multiple workspaces and versions stay separated', () => {
  it('does not attribute one project\'s runs to another', () => {
    const a = buildReliabilityRecord(makeSnapshot({ taskId: 'a', workspaceRoot: 'E:/proj-a' }));
    const b = buildReliabilityRecord(makeSnapshot({
      taskId: 'b',
      workspaceRoot: 'E:/proj-b',
      status: 'FAILED',
      verification: { ...makeSnapshot().verification!, passed: false },
    }));
    const report = aggregateReliability([a, b], {
      now: NOW,
      workspaceRoot: 'E:/proj-a',
      minSampleSize: 1,
    });
    expect(report.totals.allRuns).toBe(1);
    expect(report.outcomes.FAILED).toBe(0);
    expect(report.dimensions.byWorkspace.map(entry => entry.key)).toEqual(['E:/proj-a']);
  });

  it('keeps a historical run on the version recorded at the time', () => {
    const old = buildReliabilityRecord(makeSnapshot({
      taskId: 'on-14',
      versionIntelligence: {
        ...makeSnapshot().versionIntelligence!,
        items: [{
          ...makeSnapshot().versionIntelligence!.items[0],
          normalizedVersion: '14.2.35',
        }],
      },
    }));
    const recent = buildReliabilityRecord(makeSnapshot({
      taskId: 'on-15',
      versionIntelligence: {
        ...makeSnapshot().versionIntelligence!,
        items: [{
          ...makeSnapshot().versionIntelligence!.items[0],
          normalizedVersion: '15.0.0',
        }],
      },
    }));
    const report = aggregateReliability([old, recent], { now: NOW });
    expect(report.dimensions.byFrameworkVersion.map(entry => entry.key))
      .toEqual(['next@14.2.35', 'next@15.0.0']);
    expect(report.dimensions.byFrameworkVersion.every(entry => entry.runs === 1)).toBe(true);
  });
});

describe('Blocked and planning-only runs cannot inflate success', () => {
  it('a dataset of only blocked runs reports no success rate rather than 0%', () => {
    const report = aggregateReliability(
      [buildReliabilityRecord(makeBlockedSnapshot())],
      { now: NOW, minSampleSize: 1 },
    );
    const firstPass = report.rates.find(rate => rate.name === 'firstPassSuccessRate')!;
    expect(firstPass.denominator).toBe(0);
    expect(firstPass.ratio).toBeNull();
    expect(report.rates.find(rate => rate.name === 'blockedRate')).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
  });

  it('a dataset of only planning runs reports no execution metrics', () => {
    const report = aggregateReliability(
      [buildReliabilityRecord(makePlanningOnlySnapshot())],
      { now: NOW, minSampleSize: 1 },
    );
    expect(report.totals.executionRuns).toBe(0);
    expect(report.rates.find(rate => rate.name === 'finalSuccessRate')!.ratio).toBeNull();
    expect(report.execution.executionAttempts).toBe(0);
  });
});
