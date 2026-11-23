import {
  DEFAULT_MIN_SAMPLE_SIZE,
  aggregateReliability,
} from '../../../src/core/reliability/reliability-aggregator';
import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { ReliabilityRecord, ReliabilityReport } from '../../../src/domain/reliability';
import {
  makeBlockedSnapshot,
  makePlanningOnlySnapshot,
  makeRepairedSnapshot,
  makeSnapshot,
} from './fixtures/reliability-fixtures';

const NOW = new Date('2026-08-28T12:00:00.000Z');

function rate(report: ReliabilityReport, name: string) {
  const found = report.rates.find(entry => entry.name === name);
  if (!found) throw new Error(`missing rate ${name}`);
  return found;
}

function contribution(report: ReliabilityReport, name: string) {
  const found = report.contributions.find(entry => entry.name === name);
  if (!found) throw new Error(`missing contribution ${name}`);
  return found;
}

/** Seven runs: 4 first-pass successes, 1 repaired, 1 failed, 1 blocked. */
function population(): ReadonlyArray<ReliabilityRecord> {
  const successes = [1, 2, 3, 4].map(index => buildReliabilityRecord(makeSnapshot({
    taskId: `task-success-${index}`,
    startedAt: `2026-08-28T1${index}:00:00.000Z`,
    completedAt: `2026-08-28T1${index}:01:00.000Z`,
  })));
  const repaired = buildReliabilityRecord(makeRepairedSnapshot({
    startedAt: '2026-08-28T15:00:00.000Z',
  }));
  const failed = buildReliabilityRecord(makeSnapshot({
    taskId: 'task-failed',
    status: 'FAILED',
    startedAt: '2026-08-28T16:00:00.000Z',
    abortReason: 'verification failed: next build exited 1',
    verification: { ...makeSnapshot().verification!, passed: false },
  }));
  const blocked = buildReliabilityRecord(makeBlockedSnapshot({
    startedAt: '2026-08-28T17:00:00.000Z',
  }));
  return [...successes, repaired, failed, blocked];
}

describe('Reliability aggregation (G.18, G.19)', () => {
  it('reports totals per population', () => {
    const report = aggregateReliability(
      [...population(), buildReliabilityRecord(makePlanningOnlySnapshot())],
      { now: NOW },
    );
    expect(report.totals.allRuns).toBe(8);
    expect(report.totals.executionRuns).toBe(7);
    expect(report.totals.planningOnly).toBe(1);
    expect(report.totals.frontendRuns).toBe(8);
    expect(report.totals.backendRuns).toBe(0);
    expect(report.totals.repairRuns).toBe(1);
  });

  it('computes first-pass success against judgeable execution runs, not all runs', () => {
    const report = aggregateReliability(
      [...population(), buildReliabilityRecord(makePlanningOnlySnapshot())],
      { now: NOW, minSampleSize: 1 },
    );
    const firstPass = rate(report, 'firstPassSuccessRate');

    // 8 runs total, but the denominator excludes the planning-only run and
    // the blocked run: 4 successes + 1 repaired + 1 failed = 6.
    expect(firstPass.denominator).toBe(6);
    expect(firstPass.numerator).toBe(4);
    expect(firstPass.ratio).toBeCloseTo(4 / 6);
    // R1.32: mutation success is reported against mutating runs only, so
    // read-only inspections can never inflate it.
    expect(firstPass.population).toBe('MUTATING_EXECUTION');
  });

  it('counts a repaired run in final success but not in first-pass success', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 1 });
    expect(rate(report, 'finalSuccessRate')).toMatchObject({ numerator: 5, denominator: 6 });
    expect(rate(report, 'firstPassSuccessRate')).toMatchObject({ numerator: 4, denominator: 6 });
  });

  it('computes repair success against repair runs only', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 1 });
    expect(rate(report, 'repairSuccessRate')).toMatchObject({
      numerator: 1,
      denominator: 1,
      population: 'REPAIR_RUNS',
    });
  });

  it('keeps blocked runs out of the failure rate', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 1 });
    expect(rate(report, 'finalFailureRate')).toMatchObject({ numerator: 1, denominator: 6 });
    expect(rate(report, 'blockedRate')).toMatchObject({ numerator: 1, denominator: 7 });
    expect(report.outcomes.BLOCKED).toBe(1);
    expect(report.outcomes.FAILED).toBe(1);
  });

  it('excludes runs without reliable workspace evidence from the wrong-file denominator', () => {
    const withEvidence = buildReliabilityRecord(makeSnapshot({ taskId: 'clean' }));
    const withoutEvidence = buildReliabilityRecord(makeSnapshot({
      taskId: 'ambiguous',
      workspaceIntegrity: undefined,
    }));
    const dirty = buildReliabilityRecord(makeSnapshot({
      taskId: 'dirty',
      workspaceIntegrity: {
        filesModified: ['app/page.tsx', 'app/layout.tsx'],
        filesCreated: [],
        filesDeleted: [],
        unexpectedChanges: ['app/layout.tsx'],
        hasUnexpectedChanges: true,
      },
    }));

    const report = aggregateReliability([withEvidence, withoutEvidence, dirty], {
      now: NOW,
      minSampleSize: 1,
    });
    expect(rate(report, 'wrongFileRate')).toMatchObject({ numerator: 1, denominator: 2 });
    expect(report.safety.runsWithAmbiguousWorkspaceEvidence).toBe(1);
    expect(report.safety.unintendedFiles).toEqual(['app/layout.tsx']);
  });

  it('computes the suspicious success rate against recorded successes', () => {
    const suspicious = buildReliabilityRecord(makeSnapshot({
      taskId: 'task-suspicious',
      verification: undefined,
    }));
    const report = aggregateReliability([...population(), suspicious], {
      now: NOW,
      minSampleSize: 1,
    });
    // 4 clean successes + 1 repaired + 1 suspicious were recorded COMPLETED.
    expect(rate(report, 'suspiciousSuccessRate')).toMatchObject({
      numerator: 1,
      denominator: 6,
    });
    expect(report.suspiciousRuns.map(run => run.taskId)).toEqual(['task-suspicious']);
  });
});

describe('Sample size (G.20)', () => {
  it('flags a rate whose denominator is under the threshold without hiding the counts', () => {
    const report = aggregateReliability([buildReliabilityRecord(makeSnapshot())], { now: NOW });
    const firstPass = rate(report, 'firstPassSuccessRate');
    expect(firstPass.denominator).toBe(1);
    expect(firstPass.numerator).toBe(1);
    expect(firstPass.sampleSize).toBe(1);
    expect(firstPass.insufficientSample).toBe(true);
    expect(firstPass.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(firstPass.ratio).toBe(1);
    expect(report.filters.minSampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE);
  });

  it('does not flag a rate that meets a configured threshold', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 5 });
    expect(rate(report, 'firstPassSuccessRate').insufficientSample).toBe(false);
  });
});

describe('Empty and degenerate datasets', () => {
  it('reports no metrics rather than zero percent for an empty dataset', () => {
    const report = aggregateReliability([], { now: NOW });
    expect(report.totals.allRuns).toBe(0);
    for (const entry of report.rates) {
      expect(entry.ratio).toBeNull();
      expect(entry.percent).toBe('INSUFFICIENT_EVIDENCE');
      expect(entry.state).toBe('INSUFFICIENT_EVIDENCE');
    }
    expect(report.verification.ratio).toBeNull();
    expect(report.impact.ratio).toBeNull();
  });

  it('reports INSUFFICIENT_EVIDENCE for repair success when no repair ever ran', () => {
    const report = aggregateReliability(
      [buildReliabilityRecord(makeSnapshot())],
      { now: NOW, minSampleSize: 1 },
    );
    const repair = rate(report, 'repairSuccessRate');
    expect(repair.denominator).toBe(0);
    expect(repair.ratio).toBeNull();
    expect(repair.percent).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('Filters (G.21, G.22, G.23)', () => {
  it('filters by time window and excludes older runs from the denominator', () => {
    const recent = buildReliabilityRecord(makeSnapshot({
      taskId: 'recent',
      startedAt: '2026-08-28T11:00:00.000Z',
    }));
    const old = buildReliabilityRecord(makeSnapshot({
      taskId: 'old',
      startedAt: '2026-01-01T00:00:00.000Z',
    }));

    const all = aggregateReliability([recent, old], { now: NOW, window: 'all', minSampleSize: 1 });
    const day = aggregateReliability([recent, old], { now: NOW, window: '24h', minSampleSize: 1 });

    expect(all.totals.allRuns).toBe(2);
    expect(day.totals.allRuns).toBe(1);
    expect(day.period.from).toBe('2026-08-27T12:00:00.000Z');
    expect(rate(day, 'firstPassSuccessRate').denominator).toBe(1);
  });

  it('filters by workspace so unrelated projects are not mixed', () => {
    const here = buildReliabilityRecord(makeSnapshot({ taskId: 'here' }));
    const elsewhere = buildReliabilityRecord(makeSnapshot({
      taskId: 'elsewhere',
      workspaceRoot: 'E:/other-project',
    }));
    const report = aggregateReliability([here, elsewhere], {
      now: NOW,
      workspaceRoot: 'E:\\new-test-2',
      minSampleSize: 1,
    });
    expect(report.totals.allRuns).toBe(1);
    expect(contribution(report, 'firstPassSuccessRate').denominatorRuns).toEqual(['here']);
  });

  it('filters by population', () => {
    const report = aggregateReliability(
      [...population(), buildReliabilityRecord(makePlanningOnlySnapshot())],
      { now: NOW, population: 'PLANNING_ONLY', minSampleSize: 1 },
    );
    expect(report.totals.allRuns).toBe(1);
    expect(report.filters.population).toBe('PLANNING_ONLY');
  });

  it('filters by skill and framework', () => {
    const frontend = buildReliabilityRecord(makeSnapshot({ taskId: 'frontend-run' }));
    const unattributed = buildReliabilityRecord(makeSnapshot({
      taskId: 'unattributed',
      skills: [],
    }));
    const bySkill = aggregateReliability([frontend, unattributed], {
      now: NOW,
      skillId: 'frontend.core',
      minSampleSize: 1,
    });
    const byFramework = aggregateReliability([frontend, unattributed], {
      now: NOW,
      framework: 'nextjs',
      minSampleSize: 1,
    });
    expect(bySkill.totals.allRuns).toBe(1);
    expect(byFramework.totals.allRuns).toBe(2);
  });
});

describe('Dimension breakdowns (G.23-G.25)', () => {
  it('groups by skill, framework version, risk and impact confidence', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 1 });
    expect(report.dimensions.bySkill).toEqual([expect.objectContaining({
      key: 'frontend.core',
      runs: 7,
      firstPassSuccess: 4,
      finalSuccess: 5,
      failed: 1,
      blocked: 1,
    })]);
    expect(report.dimensions.byFrameworkVersion[0].key).toBe('next@14.2.35');
    expect(report.dimensions.byRisk[0].key).toBe('LOW');
    expect(report.dimensions.byImpactConfidence[0].key).toBe('CONFIRMED');
  });

  it('omits a run from a dimension it never recorded, instead of bucketing it as unknown', () => {
    const attributed = buildReliabilityRecord(makeSnapshot({ taskId: 'attributed' }));
    const unattributed = buildReliabilityRecord(makeSnapshot({
      taskId: 'unattributed',
      skills: [],
    }));
    const report = aggregateReliability([attributed, unattributed], { now: NOW });
    expect(report.dimensions.bySkill).toHaveLength(1);
    expect(report.dimensions.bySkill[0].runs).toBe(1);
  });
});

describe('Drill-down contributions (G.31)', () => {
  it('lists the runs behind each side of every rate', () => {
    const report = aggregateReliability(population(), { now: NOW, minSampleSize: 1 });
    const firstPass = contribution(report, 'firstPassSuccessRate');

    expect(firstPass.numeratorRuns).toEqual([
      'task-success-1', 'task-success-2', 'task-success-3', 'task-success-4',
    ]);
    expect(firstPass.denominatorRuns).toHaveLength(6);
    expect(firstPass.denominatorRuns).not.toContain('task-blocked');
    expect(firstPass.numeratorRuns.length).toBe(rate(report, 'firstPassSuccessRate').numerator);
    expect(firstPass.denominatorRuns.length).toBe(rate(report, 'firstPassSuccessRate').denominator);
  });
});

describe('Aggregate coverage (G.8-G.12)', () => {
  it('sums coverage over runs that declared a denominator only', () => {
    const withRequirements = buildReliabilityRecord(makeSnapshot({ taskId: 'with' }));
    const withoutRequirements = buildReliabilityRecord(makeSnapshot({
      taskId: 'without',
      skills: [],
      todoPlan: undefined,
    }));
    const report = aggregateReliability([withRequirements, withoutRequirements], { now: NOW });

    expect(report.verification.runsWithEvidence).toBe(1);
    expect(report.verification.runsWithoutEvidence).toBe(1);
    expect(report.verification.required).toBe(1);
    expect(report.verification.executed).toBe(1);
    expect(report.verification.ratio).toBe(1);
  });

  it('never counts UNKNOWN impact runs toward impact coverage', () => {
    const unknown = buildReliabilityRecord(makeSnapshot({
      taskId: 'unknown-impact',
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        confidence: 'UNKNOWN',
        unknowns: ['dynamic import'],
      },
    }));
    const report = aggregateReliability([unknown], { now: NOW });
    expect(report.impact.runsWithEvidence).toBe(0);
    expect(report.impact.ratio).toBeNull();
    expect(report.impact.state).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('Determinism (same evidence, same structured metrics)', () => {
  it('produces identical structured output regardless of input order', () => {
    const records = population();
    const shuffled = [...records].reverse();
    const a = aggregateReliability(records, { now: NOW, minSampleSize: 3 });
    const b = aggregateReliability(shuffled, { now: NOW, minSampleSize: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
