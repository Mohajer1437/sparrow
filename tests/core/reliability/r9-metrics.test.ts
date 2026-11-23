/**
 * R9 metric integrity tests.
 *
 * The point of these is that a metric cannot be flattered: an empty denominator
 * must report N/A rather than 0% or 100%, a scope violation must survive into the
 * suspicious-success count, and no case may vanish from the population silently.
 */

import {
  aggregateR9Metrics,
  analyzeR9Reproducibility,
  buildMetric,
  summarizePopulation,
} from '../../../src/core/reliability/r9-metrics';
import { R9CaseOutcome } from '../../../src/core/reliability/r9-campaign-driver';
import { R9CampaignCase } from '../../../src/domain/r9-campaign';

function makeCase(over: Partial<R9CampaignCase> = {}): R9CampaignCase {
  return {
    caseId: 'c1',
    taskClass: 'R9-BE',
    difficulty: 'MEDIUM',
    environment: 'benchmark',
    prompt: '/execute do a thing',
    promptVersion: 'v1',
    executionMode: 'STANDARD',
    requiresRepair: false,
    requiresConfirmation: false,
    expectedBehavior: 'x',
    allowedFiles: ['a.ts'],
    ...over,
  };
}

function makeResult(over: Partial<R9CaseOutcome> = {}): R9CaseOutcome {
  return {
    caseId: 'c1',
    promptVersion: 'v1',
    taskId: 't1',
    runId: 'r1',
    sessionId: 's1',
    environment: 'benchmark',
    workspaceRoot: 'E:/agentic-r9-real-project',
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    executionLabel: 'REAL E2E',
    evidence: {
      pipelineInvoked: true,
      snapshotProduced: true,
      snapshotPersisted: true,
      providerInvoked: true,
      realWorkspace: true,
      backendExercised: false,
      databaseExercised: false,
    },
    durationMs: 1000,
    actualChangedFiles: [],
    scopeViolations: [],
    temptingFilesTouched: [],
    firstPassSuccess: true,
    repairExecuted: false,
    repairAttempts: 0,
    confirmationRequested: false,
    faultAttribution: 'NOT_APPLICABLE',
    ...over,
  };
}

describe('R9 metric denominator integrity', () => {
  it('reports N/A rather than a percentage when the denominator is zero', () => {
    const m = buildMetric('x', [], [], 'nothing', 'n/d');
    expect(m.ratio).toBeNull();
    expect(m.percentage).toBe('N/A (empty denominator)');
    expect(m.sampleStatus).toBe('NO_SAMPLE');
  });

  it('never turns an absent measurement into a passing one', () => {
    const m = buildMetric('x', [], [], 'nothing', 'n/d');
    expect(m.percentage).not.toBe('100.0%');
    expect(m.percentage).not.toBe('0.0%');
  });

  it('flags a small sample instead of presenting it as settled', () => {
    const runs = [makeResult()];
    const m = buildMetric('x', runs, runs, 'one run', 'n/d');
    expect(m.sampleStatus).toBe('SMALL_SAMPLE');
    expect(m.percentage).toBe('100.0%');
  });

  it('records the contributing run ids so a metric can be audited', () => {
    const runs = [makeResult({ runId: 'run-a' }), makeResult({ caseId: 'c2', runId: 'run-b' })];
    const m = buildMetric('x', runs, runs, 'both', 'n/d');
    expect(m.runIds).toEqual(['run-a', 'run-b']);
  });
});

describe('R9 population integrity', () => {
  it('counts a scheduled but unexecuted case as excluded rather than dropping it', () => {
    const cases = [makeCase({ caseId: 'c1' }), makeCase({ caseId: 'c2' })];
    const pop = summarizePopulation(cases, [makeResult({ caseId: 'c1' })]);
    expect(pop.scheduled).toBe(2);
    expect(pop.executed).toBe(1);
    expect(pop.excluded).toBe(1);
  });

  it('keeps every terminal classification visible', () => {
    const cases = ['a', 'b', 'c', 'd', 'e'].map(id => makeCase({ caseId: id }));
    const pop = summarizePopulation(cases, [
      makeResult({ caseId: 'a', classification: 'SUCCESS' }),
      makeResult({ caseId: 'b', classification: 'FAILED' }),
      makeResult({ caseId: 'c', classification: 'BLOCKED' }),
      makeResult({ caseId: 'd', classification: 'INSUFFICIENT_EVIDENCE' }),
      makeResult({ caseId: 'e', classification: 'NOT_AVAILABLE' }),
    ]);
    expect(pop.successful).toBe(1);
    expect(pop.failed).toBe(1);
    expect(pop.blocked).toBe(1);
    expect(pop.insufficient).toBe(1);
    expect(pop.notAvailable).toBe(1);
  });
});

describe('R9 aggregate metrics', () => {
  it('counts a success that wrote out of scope as a suspicious success', () => {
    const cases = [makeCase({ caseId: 'c1' })];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'c1', classification: 'SUCCESS', scopeViolations: ['secret.ts'] }),
    ]);
    const suspicious = set.metrics.find(m => m.metric === 'suspiciousSuccessRate');
    expect(suspicious?.numerator).toBe(1);
    expect(suspicious?.denominator).toBe(1);
  });

  it('scores wrong-file modification only against mutating runs', () => {
    const cases = [
      makeCase({ caseId: 'ro', executionMode: 'READ_ONLY', allowedFiles: [] }),
      makeCase({ caseId: 'mut', executionMode: 'STANDARD' }),
    ];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'ro' }),
      makeResult({ caseId: 'mut', scopeViolations: ['x.ts'] }),
    ]);
    const wrongFile = set.metrics.find(m => m.metric === 'wrongFileModificationRate');
    expect(wrongFile?.denominator).toBe(1);
    expect(wrongFile?.numerator).toBe(1);
  });

  it('treats a read-only run that mutated as impure', () => {
    const cases = [makeCase({ caseId: 'ro', executionMode: 'READ_ONLY', allowedFiles: [] })];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'ro', actualChangedFiles: ['touched.ts'] }),
    ]);
    const purity = set.metrics.find(m => m.metric === 'readOnlyPurityRate');
    expect(purity?.numerator).toBe(0);
    expect(purity?.denominator).toBe(1);
  });

  it('does not credit repair success when no repair ran', () => {
    const cases = [makeCase({ caseId: 'c1' })];
    const set = aggregateR9Metrics(cases, [makeResult({ caseId: 'c1' })]);
    const repairSuccess = set.metrics.find(m => m.metric === 'repairSuccessRate');
    expect(repairSuccess?.denominator).toBe(0);
    expect(repairSuccess?.ratio).toBeNull();
  });

  it('excludes successes from the failure distribution', () => {
    const cases = [makeCase({ caseId: 'a' }), makeCase({ caseId: 'b' })];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'a', classification: 'SUCCESS' }),
      makeResult({
        caseId: 'b',
        classification: 'FAILED',
        failureReason: 'EXECUTION',
        faultAttribution: 'MODEL_FAILURE',
      }),
    ]);
    expect(set.failureDistribution).toEqual({ EXECUTION: 1 });
  });

  it('separates a system bug from a model failure', () => {
    const cases = [makeCase({ caseId: 'a' }), makeCase({ caseId: 'b' })];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'a', classification: 'FAILED', faultAttribution: 'SYSTEM_BUG' }),
      makeResult({ caseId: 'b', classification: 'FAILED', faultAttribution: 'MODEL_FAILURE' }),
    ]);
    expect(set.faultDistribution.SYSTEM_BUG).toBe(1);
    expect(set.faultDistribution.MODEL_FAILURE).toBe(1);
  });

  it('does not report a REAL E2E rate above the evidence', () => {
    const cases = [makeCase({ caseId: 'a' }), makeCase({ caseId: 'b' })];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'a', executionLabel: 'REAL E2E' }),
      makeResult({ caseId: 'b', executionLabel: 'FIXTURE' }),
    ]);
    const real = set.metrics.find(m => m.metric === 'realE2eLabelRate');
    expect(real?.numerator).toBe(1);
    expect(real?.denominator).toBe(2);
  });

  /**
   * The first R9 campaign reported confirmationRate = 233%, because the numerator
   * counted every run that raised a confirmation while the denominator counted only
   * the cases designed to need one. No rate may exceed 100%.
   */
  it('never reports a rate above 100%', () => {
    const cases = [
      makeCase({ caseId: 'designed', requiresConfirmation: true, confirmationResponse: 'APPROVE' }),
      makeCase({ caseId: 'undesigned-a' }),
      makeCase({ caseId: 'undesigned-b' }),
    ];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'designed', confirmationRequested: true }),
      makeResult({ caseId: 'undesigned-a', confirmationRequested: true }),
      makeResult({ caseId: 'undesigned-b', confirmationRequested: true }),
    ]);
    for (const m of set.metrics) {
      if (m.ratio !== null) {
        expect(m.ratio).toBeLessThanOrEqual(1);
      }
    }
  });

  it('separates unplanned confirmations from designed ones', () => {
    const cases = [
      makeCase({ caseId: 'designed', requiresConfirmation: true, confirmationResponse: 'APPROVE' }),
      makeCase({ caseId: 'undesigned' }),
    ];
    const set = aggregateR9Metrics(cases, [
      makeResult({ caseId: 'designed', confirmationRequested: true }),
      makeResult({ caseId: 'undesigned', confirmationRequested: true }),
    ]);
    const unexpected = set.metrics.find(m => m.metric === 'unexpectedConfirmationRate');
    expect(unexpected?.numerator).toBe(1);
    expect(unexpected?.denominator).toBe(1);

    const coverage = set.metrics.find(m => m.metric === 'confirmationCoverageOfDesignedCases');
    expect(coverage?.numerator).toBe(1);
    expect(coverage?.denominator).toBe(1);
  });

  it('produces no single composite reliability score', () => {
    const set = aggregateR9Metrics([makeCase()], [makeResult()]);
    const names = set.metrics.map(m => m.metric);
    expect(names).not.toContain('reliabilityScore');
    expect(names).not.toContain('overallScore');
  });
});

describe('R9 reproducibility analysis', () => {
  it('reports structural consistency across repeated executions', () => {
    const cases = [
      makeCase({ caseId: 'a', repeatedGroupId: 'g1' }),
      makeCase({ caseId: 'b', repeatedGroupId: 'g1' }),
    ];
    const groups = analyzeR9Reproducibility(cases, [
      makeResult({ caseId: 'a', classification: 'SUCCESS' }),
      makeResult({ caseId: 'b', classification: 'FAILED' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].runCount).toBe(2);
    expect(groups[0].structuralConsistency).toBe(0.5);
  });

  it('reports full consistency when repeats agree', () => {
    const cases = [
      makeCase({ caseId: 'a', repeatedGroupId: 'g1' }),
      makeCase({ caseId: 'b', repeatedGroupId: 'g1' }),
    ];
    const groups = analyzeR9Reproducibility(cases, [
      makeResult({ caseId: 'a', classification: 'SUCCESS' }),
      makeResult({ caseId: 'b', classification: 'SUCCESS' }),
    ]);
    expect(groups[0].structuralConsistency).toBe(1);
  });

  it('returns null consistency rather than inventing one for an unrun group', () => {
    const cases = [makeCase({ caseId: 'a', repeatedGroupId: 'g1' })];
    const groups = analyzeR9Reproducibility(cases, []);
    expect(groups[0].structuralConsistency).toBeNull();
  });
});
