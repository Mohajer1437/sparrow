/**
 * Milestone G — aggregates ReliabilityRecords into a ReliabilityReport.
 *
 * Every rate carries its own numerator, denominator and population so a
 * reader can recompute it, and every rate records which runs contributed to
 * each side so any number can be traced back to evidence (G.18, G.31).
 *
 * Nothing here fills a gap: a zero denominator produces a null ratio and an
 * INSUFFICIENT_EVIDENCE state, never 0%.
 */

import {
  AggregateCoverage,
  EVIDENCE_PRESENCES,
  EvidencePresence,
  RELIABILITY_SCHEMA_VERSION,
  RUN_OUTCOMES,
  RateContribution,
  ReliabilityDimensionBreakdown,
  ReliabilityDimensionsSummary,
  ReliabilityEvidenceQuality,
  ReliabilityExecutionSummary,
  ReliabilityFilters,
  ReliabilityPeriod,
  ReliabilityPlanningSummary,
  ReliabilityRate,
  ReliabilityRecord,
  ReliabilityReport,
  ReliabilityRepairSummary,
  ReliabilitySafetySummary,
  ReliabilityConfirmationSummary,
  ReliabilityTimeWindow,
  ReliabilityTotals,
  RunOutcome,
  RunPopulation,
  SuspiciousRunView,
  buildRate,
  windowDurationMs,
} from '../../domain/reliability';

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

export interface ReliabilityAggregationOptions {
  readonly window?: ReliabilityTimeWindow;
  readonly now?: Date;
  readonly workspaceRoot?: string;
  readonly projectType?: string;
  readonly framework?: string;
  readonly skillId?: string;
  readonly population?: RunPopulation;
  readonly minSampleSize?: number;
}

/**
 * Runs excluded from success/failure denominators because they never reached
 * a state that could be judged. Keeping them out of the denominator prevents
 * an interrupted run from silently depressing the success rate.
 */
const UNJUDGEABLE_OUTCOMES: ReadonlyArray<RunOutcome> = Object.freeze([
  'ABORTED',
  'INSUFFICIENT_EVIDENCE',
]);

export function aggregateReliability(
  allRecords: ReadonlyArray<ReliabilityRecord>,
  options: ReliabilityAggregationOptions = {},
): ReliabilityReport {
  const window = options.window ?? 'all';
  const now = options.now ?? new Date();
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const population = options.population ?? 'ALL_RUNS';

  const period = derivePeriod(window, now);
  const records = sortRecords(filterRecords(allRecords, { ...options, window, period }));

  const filters: ReliabilityFilters = Object.freeze({
    window,
    workspaceRoot: options.workspaceRoot,
    projectType: options.projectType,
    framework: options.framework,
    skillId: options.skillId,
    population,
    minSampleSize,
  });

  const inPopulation = (name: RunPopulation) =>
    records.filter(record => record.populations.includes(name));

  const executionRuns = inPopulation('EXECUTION_RUNS');
  const repairRuns = inPopulation('REPAIR_RUNS');

  // Judgeable execution runs: attempted, terminal, and not stopped by policy.
  // BLOCKED is excluded here and reported through its own rate (G.7).
  // R1.32: read-only inspections never enter mutation success or failure rates.
  const judgeable = executionRuns.filter(record =>
    !UNJUDGEABLE_OUTCOMES.includes(record.outcome)
    && record.outcome !== 'BLOCKED'
    && !record.readOnly);
  const recordedSuccessRuns = records.filter(record => record.recordedStatus === 'COMPLETED');
  const workspaceEvidenceRuns = records.filter(record =>
    record.execution.wrongFileModification === 'PROVEN'
    || record.execution.wrongFileModification === 'NOT_PROVEN');

  const rateSpecs: ReadonlyArray<{
    name: string;
    formula: string;
    population: RunPopulation;
    denominatorRuns: ReadonlyArray<ReliabilityRecord>;
    predicate: (record: ReliabilityRecord) => boolean;
  }> = [
    {
      name: 'firstPassSuccessRate',
      formula: 'runs with firstPassSuccess / execution runs that reached a judgeable terminal state (excludes BLOCKED, ABORTED, INSUFFICIENT_EVIDENCE and planning-only runs)',
      population: 'MUTATING_EXECUTION',
      denominatorRuns: judgeable,
      predicate: record => record.firstPassSuccess,
    },
    {
      name: 'finalSuccessRate',
      formula: 'runs with outcome SUCCESS or SUCCESS_AFTER_REPAIR / execution runs that reached a judgeable terminal state',
      population: 'EXECUTION_RUNS',
      denominatorRuns: judgeable,
      predicate: record => record.outcome === 'SUCCESS' || record.outcome === 'SUCCESS_AFTER_REPAIR',
    },
    {
      name: 'repairSuccessRate',
      formula: 'runs with outcome SUCCESS_AFTER_REPAIR / runs where at least one repair attempt was made',
      population: 'REPAIR_RUNS',
      denominatorRuns: repairRuns,
      predicate: record => record.successAfterRepair,
    },
    {
      name: 'finalFailureRate',
      formula: 'runs with outcome FAILED / execution runs that reached a judgeable terminal state',
      population: 'EXECUTION_RUNS',
      denominatorRuns: judgeable,
      predicate: record => record.finalFailure,
    },
    {
      name: 'blockedRate',
      formula: 'runs with outcome BLOCKED / all runs in the filtered set',
      population: 'ALL_RUNS',
      denominatorRuns: records,
      predicate: record => record.blocked,
    },
    {
      name: 'suspiciousSuccessRate',
      formula: 'runs classified SUCCESS_WITH_INSUFFICIENT_EVIDENCE / runs the pipeline recorded as COMPLETED',
      population: 'ALL_RUNS',
      denominatorRuns: recordedSuccessRuns,
      predicate: record => record.outcome === 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
    },
    {
      name: 'wrongFileRate',
      formula: 'runs with proven unintended file modification / runs with reliable workspace state-comparison evidence (runs without that evidence are excluded, not assumed clean)',
      population: 'ALL_RUNS',
      denominatorRuns: workspaceEvidenceRuns,
      predicate: record => record.execution.wrongFileModification === 'PROVEN',
    },
  ];

  const rates: ReliabilityRate[] = [];
  const contributions: RateContribution[] = [];
  for (const spec of rateSpecs) {
    const numeratorRuns = spec.denominatorRuns.filter(spec.predicate);
    rates.push(buildRate({
      name: spec.name,
      formula: spec.formula,
      population: spec.population,
      numerator: numeratorRuns.length,
      denominator: spec.denominatorRuns.length,
      minSampleSize,
    }));
    contributions.push(Object.freeze({
      name: spec.name,
      numeratorRuns: Object.freeze(numeratorRuns.map(record => record.taskId)),
      denominatorRuns: Object.freeze(spec.denominatorRuns.map(record => record.taskId)),
    }));
  }

  return Object.freeze({
    schemaVersion: RELIABILITY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    period,
    filters,
    totals: deriveTotals(records, inPopulation),
    outcomes: deriveOutcomes(records),
    rates: Object.freeze(rates),
    planning: derivePlanningSummary(records),
    execution: deriveExecutionSummary(records, executionRuns),
    verification: deriveVerificationCoverage(records),
    impact: deriveImpactCoverage(records),
    endpoints: deriveEndpointCoverage(records),
    regression: deriveRegressionCoverage(records),
    todos: deriveTodoCoverage(records),
    repair: deriveRepairSummary(records, repairRuns),
    safety: deriveSafetySummary(records, workspaceEvidenceRuns),
    confirmation: deriveConfirmationSummary(records),
    evidenceQuality: deriveEvidenceQuality(records),
    dimensions: deriveDimensions(records),
    contributions: Object.freeze(contributions),
    suspiciousRuns: deriveSuspiciousRuns(records),
  });
}

/* ------------------------------------------------------- filtering / period */

function derivePeriod(window: ReliabilityTimeWindow, now: Date): ReliabilityPeriod {
  const duration = windowDurationMs(window);
  if (duration === null) return Object.freeze({ window });
  return Object.freeze({
    window,
    from: new Date(now.getTime() - duration).toISOString(),
    to: now.toISOString(),
  });
}

function filterRecords(
  records: ReadonlyArray<ReliabilityRecord>,
  options: ReliabilityAggregationOptions & { period: ReliabilityPeriod },
): ReadonlyArray<ReliabilityRecord> {
  const fromMs = options.period.from ? Date.parse(options.period.from) : null;
  const population = options.population ?? 'ALL_RUNS';

  return records.filter(record => {
    if (fromMs !== null) {
      const started = Date.parse(record.startedAt);
      // A record with an unparseable timestamp cannot be placed in a window,
      // so it is excluded rather than counted in the wrong period.
      if (!Number.isFinite(started) || started < fromMs) return false;
    }
    if (population !== 'ALL_RUNS' && !record.populations.includes(population)) return false;
    if (options.workspaceRoot
      && normalizeRoot(record.workspaceRoot) !== normalizeRoot(options.workspaceRoot)) {
      return false;
    }
    if (options.projectType
      && (record.dimensions.projectType ?? '').toLowerCase() !== options.projectType.toLowerCase()) {
      return false;
    }
    if (options.framework
      && !record.dimensions.frameworks.some(f => f.toLowerCase() === options.framework!.toLowerCase())) {
      return false;
    }
    if (options.skillId && !record.dimensions.skillIds.includes(options.skillId)) return false;
    return true;
  });
}

/** Stable ordering so identical evidence always yields an identical report. */
function sortRecords(records: ReadonlyArray<ReliabilityRecord>): ReadonlyArray<ReliabilityRecord> {
  return Object.freeze([...records].sort((a, b) => {
    const byTime = a.startedAt.localeCompare(b.startedAt);
    return byTime !== 0 ? byTime : a.taskId.localeCompare(b.taskId);
  }));
}

function normalizeRoot(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/* ----------------------------------------------------------------- totals */

function deriveTotals(
  records: ReadonlyArray<ReliabilityRecord>,
  inPopulation: (name: RunPopulation) => ReadonlyArray<ReliabilityRecord>,
): ReliabilityTotals {
  return Object.freeze({
    allRuns: records.length,
    executionRuns: inPopulation('EXECUTION_RUNS').length,
    planningOnly: inPopulation('PLANNING_ONLY').length,
    backendRuns: inPopulation('BACKEND_RUNS').length,
    frontendRuns: inPopulation('FRONTEND_RUNS').length,
    repairRuns: inPopulation('REPAIR_RUNS').length,
    readOnlyInspection: inPopulation('READ_ONLY_INSPECTION').length,
    mutatingExecution: inPopulation('MUTATING_EXECUTION').length,
  });
}

function deriveOutcomes(
  records: ReadonlyArray<ReliabilityRecord>,
): Readonly<Record<RunOutcome, number>> {
  const counts = {} as Record<RunOutcome, number>;
  for (const outcome of RUN_OUTCOMES) counts[outcome] = 0;
  for (const record of records) counts[record.outcome] += 1;
  return Object.freeze(counts);
}

/* ---------------------------------------------------------------- planning */

function derivePlanningSummary(
  records: ReadonlyArray<ReliabilityRecord>,
): ReliabilityPlanningSummary {
  const count = (status: string) =>
    records.filter(record => record.planning.plannerOutputStatus === status).length;
  return Object.freeze({
    plannerRequests: records.length,
    validTodoPlan: count('VALID_TODO_PLAN'),
    planWithoutTodoPlan: count('PLAN_WITHOUT_TODO_PLAN'),
    outputRejected: count('OUTPUT_REJECTED'),
    providerFailure: count('PROVIDER_FAILURE'),
    timeout: count('TIMEOUT'),
    notAttempted: count('NOT_ATTEMPTED'),
    unknown: count('UNKNOWN'),
  });
}

/* --------------------------------------------------------------- execution */

function deriveExecutionSummary(
  records: ReadonlyArray<ReliabilityRecord>,
  executionRuns: ReadonlyArray<ReliabilityRecord>,
): ReliabilityExecutionSummary {
  return Object.freeze({
    executionAttempts: executionRuns.length,
    completed: executionRuns.filter(r => r.execution.status === 'COMPLETED').length,
    partial: executionRuns.filter(r => r.execution.status === 'PARTIAL').length,
    failed: executionRuns.filter(r => r.execution.status === 'FAILED').length,
    totalSteps: sum(executionRuns.map(r => r.execution.totalSteps)),
    succeededSteps: sum(executionRuns.map(r => r.execution.succeededSteps)),
    failedSteps: sum(executionRuns.map(r => r.execution.failedSteps)),
    runsWithUnintendedChanges:
      records.filter(r => r.execution.wrongFileModification === 'PROVEN').length,
    runsWithUnknownWorkspaceEvidence:
      records.filter(r => r.execution.wrongFileModification === 'INSUFFICIENT_EVIDENCE').length,
  });
}

/* ---------------------------------------------------------------- coverage */

function buildAggregateCoverage(input: {
  readonly withEvidence: number;
  readonly withoutEvidence: number;
  readonly required: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}): AggregateCoverage {
  const hasDenominator = input.required > 0;
  return Object.freeze({
    runsWithEvidence: input.withEvidence,
    runsWithoutEvidence: input.withoutEvidence,
    required: input.required,
    executed: input.executed,
    passed: input.passed,
    failed: input.failed,
    skipped: input.skipped,
    ratio: hasDenominator ? input.executed / input.required : null,
    state: hasDenominator ? 'PROVEN' : 'INSUFFICIENT_EVIDENCE',
  });
}

function deriveVerificationCoverage(
  records: ReadonlyArray<ReliabilityRecord>,
): AggregateCoverage {
  const withEvidence = records.filter(r => r.verification.coverage.required > 0);
  return buildAggregateCoverage({
    withEvidence: withEvidence.length,
    withoutEvidence: records.length - withEvidence.length,
    required: sum(withEvidence.map(r => r.verification.coverage.required)),
    executed: sum(withEvidence.map(r => r.verification.coverage.executed)),
    passed: sum(withEvidence.map(r => r.verification.coverage.passed)),
    failed: sum(withEvidence.map(r => r.verification.coverage.failed)),
    skipped: sum(withEvidence.map(r => r.verification.coverage.unknown)),
  });
}

function deriveImpactCoverage(records: ReadonlyArray<ReliabilityRecord>): AggregateCoverage {
  // Only runs with a determined impact set contribute; UNKNOWN impact is
  // counted as missing evidence, never as zero affected artifacts (G.10).
  const withEvidence = records.filter(r =>
    r.impactCoverage.state === 'PROVEN' && r.impactCoverage.affected > 0);
  return buildAggregateCoverage({
    withEvidence: withEvidence.length,
    withoutEvidence: records.length - withEvidence.length,
    required: sum(withEvidence.map(r => r.impactCoverage.affected)),
    executed: sum(withEvidence.map(r => r.impactCoverage.verified)),
    passed: sum(withEvidence.map(r => r.impactCoverage.verified)),
    failed: 0,
    skipped: sum(withEvidence.map(r => r.impactCoverage.unverified)),
  });
}

function deriveEndpointCoverage(records: ReadonlyArray<ReliabilityRecord>): AggregateCoverage {
  const withEvidence = records.filter(r =>
    r.endpointCoverage.state === 'PROVEN' && r.endpointCoverage.discovered > 0);
  return buildAggregateCoverage({
    withEvidence: withEvidence.length,
    withoutEvidence: records.length - withEvidence.length,
    required: sum(withEvidence.map(r => r.endpointCoverage.discovered)),
    executed: sum(withEvidence.map(r => r.endpointCoverage.tested)),
    passed: sum(withEvidence.map(r => r.endpointCoverage.passed)),
    failed: sum(withEvidence.map(r => r.endpointCoverage.failed)),
    skipped: sum(withEvidence.map(r => r.endpointCoverage.skipped)),
  });
}

function deriveRegressionCoverage(records: ReadonlyArray<ReliabilityRecord>): AggregateCoverage {
  const withEvidence = records.filter(r => r.regression.selected > 0);
  return buildAggregateCoverage({
    withEvidence: withEvidence.length,
    withoutEvidence: records.length - withEvidence.length,
    required: sum(withEvidence.map(r => r.regression.selected)),
    executed: sum(withEvidence.map(r => r.regression.executed)),
    passed: sum(withEvidence.map(r => r.regression.passed)),
    failed: sum(withEvidence.map(r => r.regression.failed)),
    skipped: sum(withEvidence.map(r => r.regression.skipped)),
  });
}

function deriveTodoCoverage(records: ReadonlyArray<ReliabilityRecord>): AggregateCoverage {
  const withEvidence = records.filter(r => r.todoCoverage.total > 0);
  return buildAggregateCoverage({
    withEvidence: withEvidence.length,
    withoutEvidence: records.length - withEvidence.length,
    required: sum(withEvidence.map(r => r.todoCoverage.total)),
    executed: sum(withEvidence.map(r => r.todoCoverage.executed)),
    passed: sum(withEvidence.map(r => r.todoCoverage.verified)),
    failed: sum(withEvidence.map(r => r.todoCoverage.failed)),
    skipped: sum(withEvidence.map(r => r.todoCoverage.unknown)),
  });
}

/* ------------------------------------------------------------------ repair */

function deriveRepairSummary(
  records: ReadonlyArray<ReliabilityRecord>,
  repairRuns: ReadonlyArray<ReliabilityRecord>,
): ReliabilityRepairSummary {
  return Object.freeze({
    repairRuns: repairRuns.length,
    repairAttempts: sum(records.map(r => r.repair.repairAttempts)),
    succeeded: records.filter(r => r.repair.status === 'SUCCEEDED').length,
    failed: records.filter(r => r.repair.status === 'FAILED').length,
    limitReached: records.filter(r => r.repair.limitReached).length,
    blocked: records.filter(r => r.repair.blocked).length,
    duplicateDetected: records.filter(r => r.repair.duplicateDetected).length,
    contextExpansionUsed: records.filter(r => r.repair.contextExpansionUsed).length,
    // R3.31: denominators are explicit. Expansion counts are taken over the
    // repair population, not over every run, so a project that rarely repairs
    // cannot dilute them into looking healthy.
    repairsWithExpansion: repairRuns.filter(r => r.repair.contextExpansionUsed).length,
    repairsWithoutExpansion: repairRuns.filter(r => !r.repair.contextExpansionUsed).length,
    successfulRepairsAfterExpansion: records.filter(r => r.repair.succeededAfterExpansion).length,
    stoppedForNoNewEvidence: records.filter(r => r.repair.stoppedForNoNewEvidence).length,
    stoppedForExpansionLimit: records.filter(r => r.repair.stoppedForExpansionLimit).length,
    needsContext: records.filter(r => r.repair.needsContext).length,
    // R4.33: target validity is measured over repair runs, and legitimate
    // success over successes, so a suppressed symptom cannot be counted as a
    // repair by either denominator.
    repairTargetValid: repairRuns.filter(r => r.repair.repairTargetValid).length,
    acceptanceChasingDetected: repairRuns.filter(r => r.repair.acceptanceChasingDetected).length,
    scopeEscapeDetected: repairRuns.filter(r => r.repair.scopeEscapeDetected).length,
    testManipulationDetected: repairRuns.filter(r => r.repair.testManipulationDetected).length,
    verificationBypassDetected: repairRuns.filter(r => r.repair.verificationBypassDetected).length,
    configBypassDetected: repairRuns.filter(r => r.repair.configBypassDetected).length,
    intentMismatchDetected: repairRuns.filter(r => r.repair.intentMismatchDetected).length,
    legitimateRepairSuccess: records.filter(r => r.repair.legitimateRepairSuccess).length,
    suppressedSymptomRejected: repairRuns.filter(r => r.repair.suppressedSymptomRejected).length,
  });
}

/* ------------------------------------------------------------------ safety */

function deriveSafetySummary(
  records: ReadonlyArray<ReliabilityRecord>,
  workspaceEvidenceRuns: ReadonlyArray<ReliabilityRecord>,
): ReliabilitySafetySummary {
  const files = new Set<string>();
  for (const record of records) {
    for (const file of record.execution.unintendedChangedFiles) files.add(file);
  }
  return Object.freeze({
    runsWithUnintendedChanges:
      records.filter(r => r.execution.wrongFileModification === 'PROVEN').length,
    unintendedFiles: Object.freeze([...files].sort((a, b) => a.localeCompare(b))),
    runsWithAmbiguousWorkspaceEvidence: records.length - workspaceEvidenceRuns.length,
  });
}

/* ------------------------------------------------------------ confirmation */

function deriveConfirmationSummary(records: ReadonlyArray<ReliabilityRecord>): ReliabilityConfirmationSummary {
  let confirmationRequiredRuns = 0;
  let approvedRuns = 0;
  let rejectedRuns = 0;
  let expiredRuns = 0;
  let invalidatedRuns = 0;
  let credentialRequestedRuns = 0;
  let credentialProvidedRuns = 0;

  for (const record of records) {
    if (record.confirmation?.confirmationRequired) confirmationRequiredRuns++;
    if (record.confirmation?.confirmationApproved) approvedRuns++;
    if (record.confirmation?.confirmationRejected) rejectedRuns++;
    if (record.confirmation?.confirmationExpired) expiredRuns++;
    if (record.confirmation?.confirmationInvalidated) invalidatedRuns++;
    if (record.confirmation?.credentialRequested) credentialRequestedRuns++;
    if (record.confirmation?.credentialProvided) credentialProvidedRuns++;
  }

  return Object.freeze({
    confirmationRequiredRuns,
    approvedRuns,
    rejectedRuns,
    expiredRuns,
    invalidatedRuns,
    credentialRequestedRuns,
    credentialProvidedRuns,
  });
}

/* -------------------------------------------------------- evidence quality */

function deriveEvidenceQuality(
  records: ReadonlyArray<ReliabilityRecord>,
): ReliabilityEvidenceQuality {
  const areas = [
    'planning', 'todoPlan', 'execution', 'verification',
    'repair', 'impact', 'regression', 'workspace',
  ] as const;

  const byArea: Record<string, Record<EvidencePresence, number>> = {};
  for (const area of areas) {
    const counts = {} as Record<EvidencePresence, number>;
    for (const presence of EVIDENCE_PRESENCES) counts[presence] = 0;
    for (const record of records) counts[record.evidenceCompleteness[area]] += 1;
    byArea[area] = Object.freeze(counts);
  }

  const overall = (presence: EvidencePresence) =>
    records.filter(record => record.evidenceCompleteness.overall === presence).length;

  return Object.freeze({
    complete: overall('COMPLETE'),
    partial: overall('PARTIAL'),
    missing: overall('MISSING'),
    notApplicable: overall('NOT_APPLICABLE'),
    byArea: Object.freeze(byArea),
  });
}

/* -------------------------------------------------------------- dimensions */

function deriveDimensions(
  records: ReadonlyArray<ReliabilityRecord>,
): ReliabilityDimensionsSummary {
  return Object.freeze({
    bySkill: groupBy(records, record => record.dimensions.skillIds),
    byFramework: groupBy(records, record => record.dimensions.frameworks),
    byFrameworkVersion: groupBy(records, record => record.dimensions.frameworkVersions),
    byWorkspace: groupBy(records, record => [record.workspaceRoot]),
    byRisk: groupBy(records, record => record.dimensions.riskLevels),
    byImpactConfidence: groupBy(records, record =>
      record.dimensions.impactConfidence ? [record.dimensions.impactConfidence] : []),
  });
}

/**
 * Groups runs by a dimension. A run that carries no key for the dimension is
 * omitted rather than bucketed as "unknown", so a dimension breakdown never
 * attributes reliability to a skill or version that was never recorded (G.23).
 */
function groupBy(
  records: ReadonlyArray<ReliabilityRecord>,
  keysOf: (record: ReliabilityRecord) => ReadonlyArray<string>,
): ReadonlyArray<ReliabilityDimensionBreakdown> {
  const buckets = new Map<string, ReliabilityRecord[]>();
  for (const record of records) {
    for (const key of keysOf(record)) {
      if (!key) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), record]);
    }
  }
  return Object.freeze([...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, group]) => Object.freeze({
      key,
      runs: group.length,
      firstPassSuccess: group.filter(r => r.firstPassSuccess).length,
      finalSuccess: group.filter(r =>
        r.outcome === 'SUCCESS' || r.outcome === 'SUCCESS_AFTER_REPAIR').length,
      failed: group.filter(r => r.finalFailure).length,
      blocked: group.filter(r => r.blocked).length,
      suspicious: group.filter(r => r.suspicion.suspicious).length,
    })));
}

function deriveSuspiciousRuns(
  records: ReadonlyArray<ReliabilityRecord>,
): ReadonlyArray<SuspiciousRunView> {
  return Object.freeze(records
    .filter(record => record.suspicion.suspicious)
    .map(record => Object.freeze({
      taskId: record.taskId,
      outcome: record.outcome,
      findings: record.suspicion.findings,
    })));
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}
