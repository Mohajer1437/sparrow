/**
 * Read-only run inspection for CLI and REPL (H.8, H.9, H.10).
 *
 * Every view here is rendered from TaskQueryService, the same application
 * service the Web API serves, so the terminal cannot show a different task
 * state, TodoPlan or verification verdict than the browser.
 */

import * as path from 'path';
import { AppFactory } from '../../core/app-factory';
import { Logger } from '../../contracts/logger';
import { resolveWorkspaceRoot } from '../workspace-resolver';
import { TaskQueryService } from '../../app/task-query-service';
import { classifyError } from '../../app/interface-error';
import { formatOutcomeSummaryText } from '../../domain/task-outcome-summary';

const VIEWS = [
  'timeline', 'task', 'outcome', 'context', 'skills', 'version', 'plan', 'impact',
  'regression', 'execution', 'workspace', 'verification', 'failure', 'repair', 'events',
] as const;

type RunView = (typeof VIEWS)[number];

function isRunView(value: string | undefined): value is RunView {
  return typeof value === 'string' && (VIEWS as ReadonlyArray<string>).includes(value);
}

export async function runsCommand(args: string[] = []): Promise<void> {
  const { taskId, runId, view, json, limit, targetDir } = parseArgs(args);
  const root = targetDir ? path.resolve(targetDir) : await resolveWorkspaceRoot();
  const logger: Logger = { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };
  const queries = new AppFactory(root, logger).createTaskQueryService();

  try {
    if (!taskId && !runId) {
      await printList(queries, limit, json);
      return;
    }
    if (runId && !taskId) {
      const run = await queries.getRun(runId);
      await printRun(queries, run.taskId, view, json, runId);
      return;
    }
    await printRun(queries, taskId!, view, json, runId);
  } catch (error) {
    const body = classifyError(error);
    console.error(`${body.error.code}: ${body.error.message}`);
  }
}

async function printList(queries: TaskQueryService, limit: number, json: boolean): Promise<void> {
  const tasks = await queries.listTasks(limit);
  if (json) {
    console.log(JSON.stringify({ tasks }, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log('No recorded task runs in this workspace.');
    return;
  }
  console.log(`Recorded task runs (${tasks.length}):`);
  for (const task of tasks) {
    console.log(`  ${task.taskId}`);
    console.log(`      status=${task.status} recorded=${task.recordedStatus} started=${task.startedAt}`);
    console.log(`      run=${task.runId ?? '(none recorded)'} skills=${task.skillIds.join(', ') || 'none'}`);
    console.log(`      ${task.task}`);
  }
  console.log('');
  console.log('Inspect one run: agent runs <taskId> [--view timeline|task|context|skills|version|plan|impact|regression|execution|verification|failure|repair|events]');
}

async function printRun(
  queries: TaskQueryService,
  taskId: string,
  view: RunView,
  json: boolean,
  runId?: string,
): Promise<void> {
  const payload = await load(queries, taskId, view, runId);
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  render(view, payload);
}

async function load(queries: TaskQueryService, taskId: string, view: RunView, runId?: string): Promise<any> {
  if (runId) {
    switch (view) {
      case 'timeline': return queries.getTimelineForRun(runId);
      case 'task': return queries.getTaskRun(taskId, runId);
      case 'outcome': return queries.getOutcomeSummary(taskId, runId);
      case 'events': return queries.getEventsForTaskRun(taskId, runId, undefined, 200);
      default: break;
    }
  }

  switch (view) {
    case 'timeline': return queries.getTimeline(taskId);
    case 'task': return queries.getTask(taskId);
    case 'outcome': return queries.getOutcomeSummary(taskId);
    case 'context': return queries.getContext(taskId);
    case 'skills': return queries.getSkills(taskId);
    case 'version': return queries.getVersion(taskId);
    case 'plan': return queries.getTodos(taskId);
    case 'impact': return queries.getImpact(taskId);
    case 'regression': return queries.getRegression(taskId);
    case 'execution': return queries.getExecution(taskId);
    case 'workspace': return queries.getWorkspace(taskId);
    case 'verification': return queries.getVerification(taskId);
    case 'failure': return queries.getFailure(taskId);
    case 'repair': return queries.getRepair(taskId);
    case 'events': return queries.getEvents(taskId, undefined, 200);
  }
}

/** R2.18: executor mutation evidence, printed from the recorded ledger only. */
/** R3.29: renders the shared expansion projection; derives nothing of its own. */
/** R4.35: repair targeting, rendered from the shared read model. */
function printRepairTarget(target: any): void {
  if (!target) return;
  console.log('  Repair target:');
  console.log(`    original task: ${target.originalTask}`);
  console.log(`    original Todo: ${target.originalTodoId ?? '(unknown)'}`);
  console.log(`    intent: ${target.intent} (${target.intentConfidence})`
    + (target.intentEvidence ? ` — "${target.intentEvidence}"` : ''));
  if (target.primaryFailure) console.log(`    primary failure: ${target.primaryFailure}`);
  console.log(`    acceptance criteria: ${target.acceptanceCriteria?.length
    ? target.acceptanceCriteria.join(' | ')
    : 'UNKNOWN'}`);
  console.log(`    allowed files: ${target.allowedFiles?.join(', ') || '(none)'}`);
  console.log(`    allowed operations: ${target.allowedOperations?.join(', ') || '(none)'}`);
  console.log(`    proposed files: ${target.proposedFiles?.join(', ') || '(none)'}`);
  console.log(`    proposed operations: ${target.proposedOperations?.join(', ') || '(none)'}`);
  if (target.disallowedFiles?.length) {
    console.log(`    outside scope: ${target.disallowedFiles.join(', ')}`);
  }
  console.log(`    decision: ${target.decision} — ${target.decisionReason}`);
  for (const finding of target.findings ?? []) {
    console.log(`    finding ${finding.kind}[${finding.severity}] ${finding.subject}`);
    console.log(`      reason: ${finding.reason}`);
    console.log(`      evidence: ${finding.evidenceRef}`);
  }
  const completion = target.completion;
  if (completion) {
    console.log(`    completion: ${completion.state}`
      + ` (succeeded=${completion.succeeded ? 'yes' : 'no'})`);
    console.log(`      primary resolved: ${completion.primaryResolved ? 'yes' : 'no'}`
      + ` · acceptance: ${completion.acceptancePreserved === undefined
        ? 'UNKNOWN'
        : completion.acceptancePreserved ? 'PRESERVED' : 'NOT PRESERVED'}`
      + ` · verification: ${completion.verificationPassed === undefined
        ? 'UNKNOWN'
        : completion.verificationPassed ? 'passed' : 'failed'}`
      + ` · scope: ${completion.scopeRespected ? 'respected' : 'escaped'}`);
    console.log(`      reason: ${completion.reason}`);
  }
}

function printRepairExpansion(expansion: any): void {
  if (!expansion) return;
  console.log(`  Context expansion: ${expansion.decision} at level ${expansion.expansionLevel}`
    + (expansion.stopCode ? ` (stop=${expansion.stopCode})` : ''));
  console.log(`    reason: ${expansion.reason || '(none)'}`);
  console.log(`    context ${expansion.previousContextFingerprint ?? '-'} -> ${expansion.contextFingerprint ?? '-'}`
    + ` · newEvidence=${expansion.hasNewEvidence ? 'yes' : 'no'}`);
  if (expansion.selectedFiles?.length) {
    console.log(`    selected: ${expansion.selectedFiles.join(', ')}`);
  }
  if (expansion.newFiles?.length) console.log(`    new files: ${expansion.newFiles.join(', ')}`);
  if (expansion.changedFiles?.length) {
    console.log(`    changed files: ${expansion.changedFiles.join(', ')}`);
  }
  for (const candidate of expansion.candidates ?? []) {
    console.log(`    candidate ${candidate.path} [${candidate.source} rank=${candidate.rank}`
      + ` ${candidate.confidence}${candidate.exists ? '' : ' NOT_FOUND'}`
      + `${candidate.alreadyInContext ? ' ALREADY_HELD' : ''}] ${candidate.reason}`);
  }
  for (const item of expansion.rejected ?? []) {
    console.log(`    rejected  ${item.path}: ${item.rejection} — ${item.reason}`);
  }
  for (const item of expansion.missingEvidence ?? []) {
    console.log(`    missing   ${item.kind}: ${item.reference}`
      + ` (${item.resolved ? 'found in workspace' : 'NOT FOUND'})`);
  }
}

function printMutationSafety(mutations: any): void {
  if (!mutations) {
    console.log('  Mutation safety: no executor mutation evidence recorded for this run.');
    return;
  }
  console.log(
    `  Mutation safety: ${mutations.successfulMutations} applied, ${mutations.rejectedMutations} rejected, `
    + `${mutations.blockedMutations} blocked, ${mutations.rolledBackMutations} rolled back, `
    + `${mutations.failedMutations} failed (of ${mutations.mutationAttempts} attempt(s))`);
  console.log(
    `    syntax failures: ${mutations.syntaxFailures}  suspicious diffs: ${mutations.unexpectedDiffs}  `
    + `expected-change failures: ${mutations.expectedChangeFailures}  rollback failures: ${mutations.rollbackFailures}  `
    + `out-of-scope attempts: ${mutations.outOfScopeAttempts}`);
  for (const mutation of mutations.mutations ?? []) {
    const codes = (mutation.failureCodes ?? []).length > 0 ? ` [${mutation.failureCodes.join(', ')}]` : '';
    console.log(
      `    ${mutation.path} ${mutation.operation} → ${mutation.status}${codes} `
      + `(+${mutation.linesAdded}/-${mutation.linesRemoved})`);
    if (mutation.rolledBack) {
      console.log(
        `      rollback ${mutation.rollbackVerified ? 'verified' : 'FAILED'}; `
        + `before=${String(mutation.beforeHash).slice(0, 12)} afterRollback=${String(mutation.afterRollbackHash ?? '').slice(0, 12) || '(none)'}`);
    }
  }
}

function render(view: RunView, data: any): void {
  switch (view) {
    case 'timeline':
      console.log(`Timeline: ${data.taskId}`);
      console.log(`  Run id:          ${data.runId ?? '(none recorded)'}`);
      console.log(`  Recorded status: ${data.recordedStatus}`);
      console.log(`  Live status:     ${data.liveStatus}`);
      console.log('');
      for (const stage of data.stages) {
        console.log(`  ${stage.stage.padEnd(13)} ${stage.status.padEnd(10)} ${stage.detail}`);
      }
      console.log('');
      console.log('  Stages absent from this list produced no recorded evidence.');
      return;

    case 'task':
      console.log(`Task: ${data.taskId}`);
      console.log(`  Description:     ${data.task}`);
      console.log(`  Run id:          ${data.runId ?? data.sessionId ?? '(none recorded)'}`);
      console.log(`  Recorded status: ${data.status}`);
      console.log(`  Live status:     ${data.liveStatus}`);
      console.log(`  Role:            ${data.roleId}`);
      console.log(`  Workspace:       ${data.workspaceRoot}`);
      console.log(`  Started:         ${data.startedAt}`);
      console.log(`  Completed:       ${data.completedAt ?? '(none recorded)'}`);
      console.log(`  Skills:          ${(data.skills ?? []).map((s: any) => s.id).join(', ') || 'none'}`);
      if (data.abortReason) console.log(`  Aborted at ${data.abortedAt ?? '?'}: ${data.abortReason}`);
      if (data.confirmation) {
        console.log(`  Confirmation:    ${data.confirmation.status} [${data.confirmation.type}] — ${data.confirmation.reason}`);
      }
      if (data.outcomeSummary) {
        console.log('');
        console.log(formatOutcomeSummaryText(data.outcomeSummary));
      }
      return;

    case 'outcome':
      console.log(formatOutcomeSummaryText(data));
      return;

    case 'context': {
      const strategy = data.strategy;
      console.log(`Context: ${data.taskId}`);
      if (!strategy) {
        console.log('  No context strategy was recorded.');
      } else {
        console.log(`  Repair mode:      ${strategy.repairMode}`);
        console.log(`  Selected:         ${strategy.selectedSources.join(', ') || 'none'}`);
        console.log(`  Missing required: ${strategy.missingRequired.join(', ') || 'none'}`);
        console.log(`  Missing optional: ${strategy.missingOptional.join(', ') || 'none'}`);
      }
      for (const item of data.items ?? []) {
        console.log(`  [${item.index}] ${item.source} ${item.reference} · ${item.status} · ${item.sizeBytes}b`);
      }
      return;
    }

    case 'skills':
      console.log(`Skills: ${data.taskId} (mode: ${data.resolutionMode})`);
      for (const skill of data.skills ?? []) {
        console.log(`  ${skill.id} · ${skill.name} · domain=${skill.domain}`);
        console.log(`      source=${skill.resolutionSource ?? 'unknown'} checks=${skill.requiredChecks.join(', ') || 'none'}`);
      }
      return;

    case 'version':
      console.log(`Version intelligence recorded for ${data.taskId} at ${data.recordedAt}`);
      if (!data.available) {
        console.log('  No version evidence was recorded for this run.');
        return;
      }
      console.log(`  ${data.versionIntelligence.summary}`);
      console.log(`  dependencies=${data.versionIntelligence.dependenciesCount} effectiveKnowledge=${data.versionIntelligence.effectiveKnowledgeCount} stale=${data.versionIntelligence.staleCount} conflicts=${data.versionIntelligence.conflictCount}`);
      for (const item of data.versionIntelligence.items ?? []) {
        console.log(`  ${item.technology}@${item.normalizedVersion} · ${item.status} · ${item.effectiveSource}`);
      }
      return;

    case 'plan': {
      console.log(`Todo plan: ${data.taskId}`);
      if (!data.todoPlan) {
        console.log('  No TodoPlan was recorded for this run.');
        return;
      }
      console.log(`  Goal:           ${data.todoPlan.goal}`);
      console.log(`  Affected files: ${data.todoPlan.affectedFiles.join(', ') || 'none'}`);
      const byId = new Map<string, any>((data.todoStatuses ?? []).map((s: any) => [s.todoId, s]));
      for (const todo of data.todoPlan.todos) {
        const status = byId.get(todo.id);
        console.log(`  ${todo.id} · ${todo.title}`);
        console.log(`      execution=${status?.executionStatus ?? 'UNKNOWN'} verification=${status?.verificationVerdict ?? 'UNKNOWN'} (scope=${status?.verificationScope ?? 'WHOLE_RUN'})`);
      }
      return;
    }

    case 'impact':
      console.log(`Impact: ${data.taskId}`);
      if (!data.available) {
        console.log('  No impact analysis was recorded for this run.');
        return;
      }
      console.log(`  Confidence:  ${data.impactAnalysis.confidence}`);
      console.log(`  Summary:     ${data.impactAnalysis.summary}`);
      console.log(`  Direct:      ${data.impactAnalysis.directlyAffected.join(', ') || 'none'}`);
      console.log(`  Indirect:    ${data.impactAnalysis.indirectlyAffected.join(', ') || 'none'}`);
      console.log(`  Endpoints:   ${data.impactAnalysis.affectedEndpoints.join(', ') || 'none'}`);
      console.log(`  Tests:       ${data.impactAnalysis.affectedTests.join(', ') || 'none'}`);
      console.log(`  Unknowns:    ${data.impactAnalysis.unknowns.join(', ') || 'none'}`);
      console.log(`  Limits hit:  ${data.impactAnalysis.limitsReached}`);
      return;

    case 'regression':
      console.log(`Regression plan: ${data.taskId}`);
      if (!data.available) {
        console.log('  No regression plan was recorded for this run.');
        return;
      }
      console.log(`  Risk:      ${data.regressionPlan.risk}`);
      console.log(`  Policy:    ${data.regressionPlan.policy}`);
      console.log(`  Selected:  ${data.regressionPlan.selectedChecks.join(', ') || 'none'}`);
      for (const skipped of data.regressionPlan.skippedChecks ?? []) {
        console.log(`  Skipped:   ${skipped.check} — ${skipped.reason}`);
      }
      console.log(`  Affected artifacts:   ${data.regressionPlan.affectedArtifacts.join(', ') || 'none'}`);
      console.log(`  Unverified artifacts: ${data.regressionPlan.unverifiedArtifacts.join(', ') || 'none'}`);
      return;

    case 'execution':
      console.log(`Execution: ${data.taskId}`);
      if (data.abortReason) console.log(`  Aborted at ${data.abortedAt ?? '?'}: ${data.abortReason}`);
      for (const step of data.steps ?? []) {
        console.log(`  ${step.stepId} · ${step.status} · todo=${step.sourceTodoId ?? 'none'} · ${step.description ?? ''}`);
        if (step.error) console.log(`      error: ${step.error}`);
      }
      console.log(`  Touched files: ${(data.touchedFiles ?? []).join(', ') || 'none'}`);
      return;

    case 'workspace':
      console.log(`Workspace evidence: ${data.taskId}`);
      console.log(`  Execution Mode: ${data.executionMode ?? '(not recorded)'}`);
      printMutationSafety(data.mutationSafety);
      if (!data.workspaceComparison) {
        console.log('  No workspace comparison was recorded for this run.');
        return;
      }
      console.log(`  State: ${data.workspaceComparison.state} — ${data.workspaceComparison.basis}`);
      console.log(`  Intended files:        ${data.workspaceComparison.intendedFiles.join(', ') || 'none'}`);
      console.log(`  Actual changed files:  ${data.workspaceComparison.actualChangedFiles.join(', ') || 'none'}`);
      console.log(`  Unintended changes:    ${data.workspaceComparison.unintendedChangedFiles.join(', ') || 'none'}`);
      console.log(`  Missing expected:      ${data.workspaceComparison.missingExpectedChanges.join(', ') || 'none'}`);
      console.log(`  Pre-existing dirty:    ${data.workspaceComparison.preExistingDirtyFiles.join(', ') || 'none'}`);
      console.log(`  Wrong-file modification: ${data.workspaceComparison.wrongFileModification}`);
      return;

    case 'verification':
      console.log(`Verification: ${data.taskId}`);
      console.log(`  Execution Mode: ${data.executionMode ?? '(not recorded)'}`);
      if (!data.available) {
        console.log('  No verification report was recorded for this run.');
        return;
      }
      console.log(`  Result: ${data.verification.passed ? 'PASS' : 'FAIL'} · scope=${data.verification.scope}`);
      if (data.todoVerification) {
        console.log(`  Todo verification scope: ${data.todoVerification.scope}`);
        for (const verdict of data.todoVerification.verdicts) {
          console.log(`  todo ${verdict.todoId}: ${verdict.verdict} (${verdict.scope})`
            + ` required=[${verdict.requiredChecks.join(',') || 'none'}]`
            + ` missing=[${verdict.missingChecks.join(',') || 'none'}] — ${verdict.reason}`);
        }
      }
      if (data.verificationSideEffects) {
        console.log(`  V&V side effects: policy=${data.verificationSideEffects.policy}`
          + ` performed=${data.verificationSideEffects.performedCount}`
          + ` blocked=${data.verificationSideEffects.blockedCount}`);
      }
      for (const check of data.verification.checks ?? []) {
        console.log(`  ${check.passed ? 'PASS' : 'FAIL'} ${check.id} · ${check.category} · ${check.name}`);
      }
      for (const verdict of data.verification.todoVerdicts ?? []) {
        console.log(`  todo ${verdict.todoId}: ${verdict.verdict} (scope=${verdict.scope}) — ${verdict.reason}`);
      }
      return;

    case 'failure':
      console.log(`Failure contract: ${data.taskId}`);
      if (!data.available) {
        console.log('  No failure contract was recorded for this run.');
        return;
      }
      console.log(`  Summary:        ${data.failure.summary}`);
      console.log(`  Classification: ${data.failure.classification ?? 'UNKNOWN'}`);
      console.log(`  Failed todo:    ${data.failure.failedTodoId ?? 'UNKNOWN'}`);
      console.log(`  Expected:       ${data.failure.expected ?? '—'}`);
      console.log(`  Actual:         ${data.failure.actual ?? '—'}`);
      return;

    case 'repair':
      console.log(`Repair: ${data.taskId}`);
      if (!data.available) {
        console.log('  No repair activity was recorded for this run.');
        return;
      }
      console.log(`  Outcome:  ${data.repair.outcome ?? 'UNKNOWN'}`);
      console.log(`  Attempts: ${data.repair.attempts.length}`);
      for (const attempt of data.repair.attempts) {
        console.log(`  ${attempt.attemptId} · ${attempt.kind} · outcome=${attempt.outcome} · expansion=${attempt.expansionLevel}`);
        if (attempt.contextFingerprint) {
          console.log(`      context=${attempt.contextFingerprint}`
            + (attempt.expansionReason ? ` · ${attempt.expansionReason}` : ''));
        }
      }
      printRepairExpansion(data.repair.expansion);
      printRepairTarget(data.repair.target);
      return;

    case 'events':
      console.log(`Pipeline events: ${data.taskId} (run: ${data.runId ?? 'n/a'}, session: ${data.sessionId ?? 'n/a'})`);
      for (const event of data.events ?? []) {
        const attemptTag = event.attemptId ? ` [${event.attemptId}]` : '';
        console.log(`  [seq ${event.seq}] ${event.ts} ${event.phase}${attemptTag} ${event.message}`);
      }
      return;
  }
}

function parseArgs(args: ReadonlyArray<string>): {
  taskId?: string;
  runId?: string;
  view: RunView;
  json: boolean;
  limit: number;
  targetDir?: string;
} {
  let taskId: string | undefined;
  let runId: string | undefined;
  let view: RunView = 'timeline';
  let json = false;
  let limit = 20;
  let targetDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[index + 1];
    if (arg === '--view') {
      const value = next();
      if (isRunView(value)) view = value;
      index += 1;
      continue;
    }
    if (arg === '--run') {
      runId = next();
      index += 1;
      continue;
    }
    if (arg === '--events') {
      view = 'events';
      continue;
    }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--limit') {
      const parsed = Number(next());
      if (Number.isInteger(parsed) && parsed > 0) limit = parsed;
      index += 1;
      continue;
    }
    if (arg === '--workspace') { targetDir = next(); index += 1; continue; }
    if (arg.startsWith('--')) continue;
    // Positional: first is the task id, a second one may name the view so the
    // REPL can accept `/runs <taskId> verification`.
    if (!taskId) taskId = arg;
    else if (isRunView(arg)) view = arg;
  }

  return { taskId, runId, view, json, limit, targetDir };
}
