/**
 * CLI / REPL inspection for Reliability Evidence & Measurement (Milestone G.29).
 *
 * Read-only. Every rate is printed with its numerator, denominator and
 * population so the terminal output can be audited without trusting a
 * percentage on its own.
 */

import * as path from 'path';
import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import {
  AggregateCoverage,
  ReliabilityReport,
  RunOutcome,
  formatRate,
  isReliabilityTimeWindow,
  isRunPopulation,
} from '../../domain/reliability';
import { ReliabilityService } from '../../app/reliability-service';

interface ParsedArgs {
  readonly targetDir?: string;
  readonly window: string;
  readonly population: string;
  readonly workspaceFilter?: string;
  readonly framework?: string;
  readonly skill?: string;
  readonly minSample?: number;
  readonly runTaskId?: string;
  readonly metric?: string;
  readonly showWhy?: string;
  readonly json: boolean;
}

export async function reliabilityCommand(args: string[] = []): Promise<void> {
  const parsed = parseArgs(args);
  const targetDir = parsed.targetDir ? path.resolve(parsed.targetDir) : await resolveWorkspaceRoot();
  const logger: Logger = { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };
  const service = new AppFactory(targetDir, logger).createReliabilityService();

  const options = {
    window: isReliabilityTimeWindow(parsed.window) ? parsed.window : 'all' as const,
    population: isRunPopulation(parsed.population) ? parsed.population : 'ALL_RUNS' as const,
    workspaceRoot: parsed.workspaceFilter,
    framework: parsed.framework,
    skillId: parsed.skill,
    minSampleSize: parsed.minSample,
  };

  try {
    if (parsed.runTaskId) {
      await printRun(service, parsed.runTaskId, parsed.json);
      return;
    }
    if (parsed.showWhy) {
      await printWhy(service, parsed.showWhy, parsed.json);
      return;
    }
    if (parsed.metric) {
      await printContribution(service, parsed.metric, options, parsed.json);
      return;
    }
    const report = await service.getReport(options);
    if (parsed.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printReport(targetDir, report);
  } catch (error: any) {
    console.error(`Error generating reliability report: ${error.message}`);
  }
}

function printReport(targetDir: string, report: ReliabilityReport): void {
  console.log('Sparrow Reliability Report (read-only, evidence-derived)');
  console.log(`Workspace: ${targetDir}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window:    ${report.period.window}${report.period.from ? ` (from ${report.period.from})` : ''}`);
  console.log(`Population filter: ${report.filters.population}`);
  console.log(`Minimum sample size: ${report.filters.minSampleSize}`);
  console.log('');

  if (report.totals.allRuns === 0) {
    console.log('No recorded task runs match these filters. No metrics can be reported.');
    return;
  }

  console.log('Runs:');
  console.log(`  All runs:        ${report.totals.allRuns}`);
  console.log(`  Execution runs:  ${report.totals.executionRuns}`);
  console.log(`  Planning only:   ${report.totals.planningOnly}`);
  console.log(`  Frontend runs:   ${report.totals.frontendRuns}`);
  console.log(`  Backend runs:    ${report.totals.backendRuns}`);
  console.log(`  Repair runs:     ${report.totals.repairRuns}`);
  console.log('');

  console.log('Outcomes:');
  for (const [outcome, count] of Object.entries(report.outcomes) as Array<[RunOutcome, number]>) {
    if (count === 0) continue;
    console.log(`  ${outcome.padEnd(36)} ${count}`);
  }
  console.log('');

  console.log('Rates (numerator / denominator = value):');
  for (const rate of report.rates) {
    console.log(`  ${formatRate(rate)}`);
  }
  console.log('');

  console.log('Coverage (counted in checks/artifacts, not runs):');
  printCoverage('Verification checks', report.verification);
  printCoverage('Todos', report.todos);
  printCoverage('Impact artifacts', report.impact);
  printCoverage('Endpoints', report.endpoints);
  printCoverage('Regression checks', report.regression);
  console.log('');

  // R3.31: expansion counts are stated against the repair population so the
  // reader can see the denominator rather than infer it.
  const repair = report.repair;
  console.log('Repair context expansion:');
  console.log(`  Repair runs:                     ${repair.repairRuns}`);
  console.log(`  Repair attempts:                 ${repair.repairAttempts}`);
  console.log(`  With expansion:                  ${repair.repairsWithExpansion} / ${repair.repairRuns} REPAIR_RUNS`);
  console.log(`  Without expansion:               ${repair.repairsWithoutExpansion} / ${repair.repairRuns} REPAIR_RUNS`);
  console.log(`  Succeeded:                       ${repair.succeeded} / ${repair.repairRuns} REPAIR_RUNS`);
  console.log(`  Succeeded after expansion:       ${repair.successfulRepairsAfterExpansion} / ${repair.succeeded} SUCCEEDED_REPAIRS`);
  console.log(`  Stopped, no new evidence:        ${repair.stoppedForNoNewEvidence}`);
  console.log(`  Stopped, expansion limit:        ${repair.stoppedForExpansionLimit}`);
  console.log(`  Reported insufficient evidence:  ${repair.needsContext}`);
  console.log(`  Duplicate plan detected:         ${repair.duplicateDetected}`);
  console.log('');

  // R4.33: the counts that separate a repair from a suppressed symptom.
  console.log('Repair targeting:');
  console.log(`  Target valid:                    ${repair.repairTargetValid} / ${repair.repairRuns} REPAIR_RUNS`);
  console.log(`  Legitimate repair success:       ${repair.legitimateRepairSuccess} / ${repair.succeeded} SUCCEEDED_REPAIRS`);
  console.log(`  Rejected for suppressed symptom: ${repair.suppressedSymptomRejected} / ${repair.repairRuns} REPAIR_RUNS`);
  console.log(`  Acceptance chasing detected:     ${repair.acceptanceChasingDetected}`);
  console.log(`  Scope escape detected:           ${repair.scopeEscapeDetected}`);
  console.log(`  Test manipulation detected:      ${repair.testManipulationDetected}`);
  console.log(`  Verification bypass detected:    ${repair.verificationBypassDetected}`);
  console.log(`  Config bypass detected:          ${repair.configBypassDetected}`);
  console.log(`  Intent mismatch detected:        ${repair.intentMismatchDetected}`);
  console.log('');

  console.log('Planning:');
  console.log(`  Planner requests:      ${report.planning.plannerRequests}`);
  console.log(`  Valid TodoPlan:        ${report.planning.validTodoPlan}`);
  console.log(`  Plan without TodoPlan: ${report.planning.planWithoutTodoPlan}`);
  console.log(`  Output rejected:       ${report.planning.outputRejected}`);
  console.log(`  Provider failure:      ${report.planning.providerFailure}`);
  console.log(`  Timeout:               ${report.planning.timeout}`);
  console.log(`  Unknown:               ${report.planning.unknown}`);
  console.log('');

  if (report.confirmation) {
    const c = report.confirmation;
    console.log('Human confirmation:');
    console.log(`  Confirmation required:           ${c.confirmationRequiredRuns}`);
    console.log(`  Approved:                        ${c.approvedRuns}`);
    console.log(`  Rejected:                        ${c.rejectedRuns}`);
    console.log(`  Expired:                         ${c.expiredRuns}`);
    console.log(`  Invalidated (stale):             ${c.invalidatedRuns}`);
    console.log(`  Credential requested:            ${c.credentialRequestedRuns}`);
    console.log(`  Credential provided:             ${c.credentialProvidedRuns}`);
    console.log('');
  }

  console.log('Execution:');
  console.log(`  Attempts:              ${report.execution.executionAttempts}`);
  console.log(`  Completed:             ${report.execution.completed}`);
  console.log(`  Partial:               ${report.execution.partial}`);
  console.log(`  Failed:                ${report.execution.failed}`);
  console.log(`  Steps succeeded:       ${report.execution.succeededSteps} / ${report.execution.totalSteps}`);
  console.log('');

  console.log('Repair:');
  console.log(`  Repair runs:           ${report.repair.repairRuns}`);
  console.log(`  Repair attempts:       ${report.repair.repairAttempts}`);
  console.log(`  Succeeded:             ${report.repair.succeeded}`);
  console.log(`  Failed:                ${report.repair.failed}`);
  console.log(`  Limit reached:         ${report.repair.limitReached}`);
  console.log(`  Blocked:               ${report.repair.blocked}`);
  console.log(`  Duplicate plan:        ${report.repair.duplicateDetected}`);
  console.log(`  Context expansion:     ${report.repair.contextExpansionUsed}`);
  console.log('');

  console.log('Safety (workspace evidence):');
  console.log(`  Runs with unintended changes:     ${report.safety.runsWithUnintendedChanges}`);
  console.log(`  Runs with ambiguous evidence:     ${report.safety.runsWithAmbiguousWorkspaceEvidence}`);
  if (report.safety.unintendedFiles.length > 0) {
    console.log(`  Unintended files: ${report.safety.unintendedFiles.join(', ')}`);
  }
  console.log('');

  console.log('Evidence quality (runs by overall completeness):');
  console.log(`  COMPLETE: ${report.evidenceQuality.complete}`);
  console.log(`  PARTIAL:  ${report.evidenceQuality.partial}`);
  console.log(`  MISSING:  ${report.evidenceQuality.missing}`);
  for (const [area, counts] of Object.entries(report.evidenceQuality.byArea)) {
    const parts = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([presence, count]) => `${presence}=${count}`);
    console.log(`    ${area.padEnd(14)} ${parts.join(' ')}`);
  }
  console.log('');

  if (report.suspiciousRuns.length > 0) {
    console.log(`Suspicious successes (${report.suspiciousRuns.length}):`);
    for (const run of report.suspiciousRuns) {
      console.log(`  ${run.taskId} [${run.outcome}]`);
      for (const finding of run.findings) {
        console.log(`    - ${finding.code}: ${finding.detail}`);
      }
    }
    console.log('');
  }

  if (report.dimensions.bySkill.length > 0) {
    console.log('By skill (runs / first-pass / final success / failed / blocked):');
    for (const entry of report.dimensions.bySkill) {
      console.log(`  ${entry.key.padEnd(24)} ${entry.runs} / ${entry.firstPassSuccess} / ${entry.finalSuccess} / ${entry.failed} / ${entry.blocked}`);
    }
    console.log('');
  }
  if (report.dimensions.byFrameworkVersion.length > 0) {
    console.log('By recorded framework version:');
    for (const entry of report.dimensions.byFrameworkVersion) {
      console.log(`  ${entry.key.padEnd(24)} runs=${entry.runs} firstPass=${entry.firstPassSuccess} failed=${entry.failed}`);
    }
    console.log('');
  }

  console.log('Trace a metric: Sparrow reliability --metric firstPassSuccessRate');
  console.log('Inspect a run:  Sparrow reliability --run <taskId>');
  console.log('Explain doubt:  Sparrow reliability --why <taskId>');
}

function printCoverage(label: string, coverage: AggregateCoverage): void {
  if (coverage.ratio === null) {
    console.log(`  ${label.padEnd(20)} INSUFFICIENT_EVIDENCE (no run declared a denominator; ${coverage.runsWithoutEvidence} run(s) without evidence)`);
    return;
  }
  const percent = `${(coverage.ratio * 100).toFixed(1)}%`;
  console.log(`  ${label.padEnd(20)} ${coverage.executed} / ${coverage.required} = ${percent} (passed=${coverage.passed} failed=${coverage.failed} skipped/unknown=${coverage.skipped}, from ${coverage.runsWithEvidence} run(s))`);
}

async function printRun(service: ReliabilityService, taskId: string, json: boolean): Promise<void> {
  const record = await service.getRecord(taskId);
  if (json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  console.log(`Reliability record: ${record.taskId}`);
  console.log(`  Run id:          ${record.runId}`);
  console.log(`  Task:            ${record.task}`);
  console.log(`  Workspace:       ${record.workspaceRoot}`);
  console.log(`  Started:         ${record.startedAt}`);
  console.log(`  Completed:       ${record.completedAt ?? '(none recorded)'}`);
  console.log(`  Recorded status: ${record.recordedStatus}`);
  console.log(`  Outcome:         ${record.outcome}`);
  console.log(`  Reason:          ${record.outcomeReason}`);
  console.log(`  First pass:      ${record.firstPassSuccess}`);
  console.log(`  Populations:     ${record.populations.join(', ')}`);
  console.log('');
  console.log(`  Planning:        ${record.planning.plannerOutputStatus}, todos=${record.planning.todoCount}`);
  console.log(`  Execution:       ${record.execution.status}, steps ${record.execution.succeededSteps}/${record.execution.totalSteps} succeeded`);
  console.log(`  Verification:    ${record.verification.status}, scope=${record.verification.scope}, required=${record.verification.coverage.required} executed=${record.verification.coverage.executed} missing=${record.verification.coverage.unknown}`);
  console.log(`  Todos:           total=${record.todoCoverage.total} executed=${record.todoCoverage.executed} verified=${record.todoCoverage.verified} unknown=${record.todoCoverage.unknown}`);
  console.log(`  Impact:          confidence=${record.impactCoverage.confidence} affected=${record.impactCoverage.affected} verified=${record.impactCoverage.verified} unverified=${record.impactCoverage.unverified} unknowns=${record.impactCoverage.unknown} [${record.impactCoverage.state}]`);
  console.log(`  Endpoints:       discovered=${record.endpointCoverage.discovered} tested=${record.endpointCoverage.tested} skipped=${record.endpointCoverage.skipped} [${record.endpointCoverage.state}]`);
  for (const skip of record.endpointCoverage.skipReasons) {
    console.log(`      skipped ${skip.endpoint}: ${skip.reason}`);
  }
  console.log(`  Regression:      risk=${record.regression.risk} policy=${record.regression.policy} selected=${record.regression.selected} executed=${record.regression.executed} skipped=${record.regression.skipped}`);
  console.log(`  Repair:          ${record.repair.status}, attempts=${record.repair.repairAttempts} limitReached=${record.repair.limitReached}`);
  console.log(`  Workspace:       wrongFileModification=${record.execution.wrongFileModification}`);
  console.log(`      basis: ${record.execution.wrongFileBasis}`);
  console.log('');
  console.log('  Evidence completeness:');
  for (const [area, presence] of Object.entries(record.evidenceCompleteness)) {
    console.log(`    ${area.padEnd(14)} ${presence}`);
  }
  if (record.suspicion.findings.length > 0) {
    console.log('');
    console.log('  Suspicion findings:');
    for (const finding of record.suspicion.findings) {
      console.log(`    - ${finding.code}: ${finding.detail}`);
    }
  }
}

async function printWhy(service: ReliabilityService, taskId: string, json: boolean): Promise<void> {
  const detail = await service.getSuspicionDetail(taskId);
  if (json) {
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  console.log(`Suspicious success drill-down: ${detail.taskId}`);
  console.log(`  Outcome:              ${detail.outcome}`);
  console.log(`  Reason:               ${detail.outcomeReason}`);
  console.log(`  Verification status:  ${detail.verificationStatus}`);
  console.log(`  Required checks:      ${detail.requiredChecks}`);
  console.log(`  Executed:             ${detail.executedChecks}`);
  console.log(`  Missing:              ${detail.missingChecks}`);
  console.log('');
  for (const finding of detail.findings) {
    console.log(`  - ${finding.code}: ${finding.detail}`);
  }
  console.log('');
  console.log(`  Conclusion: ${detail.conclusion}`);
}

async function printContribution(
  service: ReliabilityService,
  metric: string,
  options: Parameters<ReliabilityService['getContribution']>[1],
  json: boolean,
): Promise<void> {
  const view = await service.getContribution(metric, options);
  if (json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  console.log(`Metric: ${view.metric}`);
  console.log(`  ${formatRate(view.rate)}`);
  console.log(`  Formula: ${view.rate.formula}`);
  console.log('');
  console.log(`Numerator runs (${view.numeratorRuns.length}):`);
  for (const run of view.numeratorRuns) {
    console.log(`  ${run.taskId}  ${run.outcome}  ${run.startedAt}`);
  }
  console.log('');
  console.log(`Denominator runs (${view.denominatorRuns.length}):`);
  for (const run of view.denominatorRuns) {
    console.log(`  ${run.taskId}  ${run.outcome}  ${run.startedAt}  ${run.outcomeReason}`);
  }
}

function parseArgs(args: ReadonlyArray<string>): ParsedArgs {
  let targetDir: string | undefined;
  let window = 'all';
  let population = 'ALL_RUNS';
  let workspaceFilter: string | undefined;
  let framework: string | undefined;
  let skill: string | undefined;
  let minSample: number | undefined;
  let runTaskId: string | undefined;
  let metric: string | undefined;
  let showWhy: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[index + 1];
    switch (arg) {
      case '--window': window = next() ?? window; index += 1; break;
      case '--population': population = next() ?? population; index += 1; break;
      case '--workspace': workspaceFilter = next(); index += 1; break;
      case '--framework': framework = next(); index += 1; break;
      case '--skill': skill = next(); index += 1; break;
      case '--min-sample': {
        const parsed = Number(next());
        if (Number.isInteger(parsed) && parsed >= 0) minSample = parsed;
        index += 1;
        break;
      }
      case '--run': runTaskId = next(); index += 1; break;
      case '--metric': metric = next(); index += 1; break;
      case '--why': showWhy = next(); index += 1; break;
      case '--json': json = true; break;
      default:
        if (!arg.startsWith('--') && !targetDir) targetDir = arg;
        break;
    }
  }

  return { targetDir, window, population, workspaceFilter, framework, skill, minSample, runTaskId, metric, showWhy, json };
}
