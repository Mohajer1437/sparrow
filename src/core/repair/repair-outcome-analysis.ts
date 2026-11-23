import { MutationLedger } from '../../domain/execution/mutation-safety';
import {
  RepairCompletion,
  RepairCompletionState,
  RepairObjective,
  RepairSafetyFinding,
  normalizeObjectivePath,
} from '../../domain/repair/repair-objective';
import { classifyRepairFile } from './file-classification';

/**
 * R4.11/R4.28/R4.29: judge a repair by what it actually did, not by whether
 * the build went green afterwards.
 *
 * Plan validation (repair-target-policy) catches repairs that announce their
 * intent to delete or disable something. It cannot catch a repair that quietly
 * empties a file while describing itself as a fix. That is what this module is
 * for: it reads the mutation and workspace evidence produced by R2 and R1 and
 * asks whether the failure stopped occurring because the artifact stopped
 * existing.
 */

/* ---------------------------------------------------- outcome-side finding */

export interface AnalyzeRepairOutcomeInput {
  readonly objective: RepairObjective;
  readonly mutationLedger?: MutationLedger;
  /** R1: files that disappeared during the attempt. */
  readonly deletedFiles?: ReadonlyArray<string>;
  readonly unintendedChangedFiles?: ReadonlyArray<string>;
  /** Acceptance observables that were present before the repair and are now gone. */
  readonly removedObservables?: ReadonlyArray<string>;
}

/**
 * A file that lost essentially all of its content. The mutation guard already
 * flags total destruction; this is the softer shape where a file survives as a
 * husk, which is the form the real-world regression took.
 */
const GUTTING_RETAINED_LINE_BUDGET = 2;
const GUTTING_REMOVAL_RATIO = 0.8;

export function analyzeRepairOutcome(
  input: AnalyzeRepairOutcomeInput,
): ReadonlyArray<RepairSafetyFinding> {
  const findings: RepairSafetyFinding[] = [];
  const { objective } = input;
  const deletionAuthorized = objective.allowedOperations.includes('DELETE');

  for (const result of input.mutationLedger?.results ?? []) {
    const file = normalizeObjectivePath(result.path);
    const category = classifyRepairFile(file);

    const destroyed = result.findings.some(finding => finding.code === 'CONTENT_DESTROYED');
    const removedFile = result.beforeState === 'PRESENT' && result.afterState === 'ABSENT';
    const gutted = isGutted(result.diffSummary);

    if ((destroyed || removedFile || gutted) && !deletionAuthorized) {
      findings.push({
        kind: 'ACCEPTANCE_CHASING',
        severity: 'BLOCKING',
        subject: file,
        reason: removedFile
          ? `Repair deleted ${file}, but the original task (${objective.intent}) is not a removal task`
          : `Repair emptied the implementation in ${file} `
            + `(${result.diffSummary.linesBefore} lines before, ${result.diffSummary.linesAfter} after); `
            + `the failure would disappear because the code did, not because it was fixed`,
        evidenceRef: destroyed ? 'mutation.CONTENT_DESTROYED' : 'mutation.diffSummary',
      });
    }

    if (category === 'TEST' && removedFile && objective.intent !== 'FIX_TEST') {
      findings.push({
        kind: 'TEST_MANIPULATION',
        severity: 'BLOCKING',
        subject: file,
        reason: `Repair deleted the test ${file}; the original task does not concern tests`,
        evidenceRef: 'mutation.afterState',
      });
    }

    if (category === 'VERIFICATION' && result.changed) {
      findings.push({
        kind: 'VERIFICATION_BYPASS',
        severity: 'BLOCKING',
        subject: file,
        reason: `Repair modified the verification artifact ${file}`,
        evidenceRef: 'mutation.changed',
      });
    }

    if (category === 'CONFIG' && result.changed && !objective.originalFiles.includes(file)) {
      findings.push({
        kind: 'CONFIG_BYPASS',
        severity: 'SUSPICIOUS',
        subject: file,
        reason: `Repair changed configuration ${file}, which was not part of the original task`,
        evidenceRef: 'mutation.changed',
      });
    }
  }

  for (const raw of input.deletedFiles ?? []) {
    const file = normalizeObjectivePath(raw);
    if (deletionAuthorized) continue;
    findings.push({
      kind: 'ACCEPTANCE_CHASING',
      severity: 'BLOCKING',
      subject: file,
      reason: `Workspace evidence shows ${file} was deleted during a non-removal task`,
      evidenceRef: 'workspace.deletedFiles',
    });
  }

  const allowed = new Set(objective.allowedFiles.map(normalizeObjectivePath));
  for (const raw of input.unintendedChangedFiles ?? []) {
    const file = normalizeObjectivePath(raw);
    if (allowed.size === 0 || allowed.has(file)) continue;
    findings.push({
      kind: 'SCOPE_ESCAPE',
      severity: 'BLOCKING',
      subject: file,
      reason: `Workspace evidence shows ${file} changed although it is outside the allowed repair scope`,
      evidenceRef: 'workspace.unintendedChangedFiles',
    });
  }

  // R4.2/R4.10: an acceptance observable that used to be satisfied and is now
  // absent means the repair traded the objective away for a green check.
  for (const observable of input.removedObservables ?? []) {
    findings.push({
      kind: 'ACCEPTANCE_CHASING',
      severity: 'BLOCKING',
      subject: observable,
      reason:
        `Repair removed ${observable}, which the original acceptance criteria require to be present`,
      evidenceRef: 'acceptance.preserve',
    });
  }

  return Object.freeze(dedupe(findings));
}

function isGutted(diff: {
  readonly linesBefore: number;
  readonly linesAfter: number;
}): boolean {
  if (diff.linesBefore <= GUTTING_RETAINED_LINE_BUDGET) return false;
  if (diff.linesAfter > GUTTING_RETAINED_LINE_BUDGET) return false;
  return (diff.linesBefore - diff.linesAfter) / diff.linesBefore >= GUTTING_REMOVAL_RATIO;
}

/* --------------------------------------------------------------- completion */

export interface EvaluateRepairCompletionInput {
  readonly objective: RepairObjective;
  /** Whether the PRIMARY failure's check now passes. Undefined means unknown. */
  readonly primaryResolved: boolean | undefined;
  readonly verificationPassed: boolean | undefined;
  /** Whether the required verification for the failed Todo actually ran. */
  readonly requiredVerificationRan?: boolean;
  readonly scopeRespected: boolean;
  /** Findings from plan validation and outcome analysis, combined. */
  readonly findings: ReadonlyArray<RepairSafetyFinding>;
}

/**
 * R4.28: repair success is a conjunction. Every term below has to hold, and a
 * passing build is only one of them.
 */
export function evaluateRepairCompletion(
  input: EvaluateRepairCompletionInput,
): RepairCompletion {
  const findings = input.findings;
  const chasing = findings.filter(
    item => item.kind === 'ACCEPTANCE_CHASING' && item.severity === 'BLOCKING',
  );
  const blocking = findings.filter(item => item.severity === 'BLOCKING');

  const acceptancePreserved = chasing.length > 0
    ? false
    : input.objective.acceptanceCriteria.length === 0
      ? undefined
      : true;

  let state: RepairCompletionState;
  let reason: string;

  if (chasing.length > 0) {
    // R4.29 and the milestone's central invariant: this outranks a green run.
    state = 'ACCEPTANCE_CHASING_DETECTED';
    reason =
      'Verification outcome is not attributable to a fix: '
      + chasing.map(item => `${item.subject} (${item.reason})`).join('; ');
  } else if (blocking.length > 0) {
    state = 'PRIMARY_NOT_RESOLVED';
    reason = `Repair rejected by safety findings: ${blocking.map(f => f.kind).join(', ')}`;
  } else if (input.primaryResolved === undefined || input.verificationPassed === undefined) {
    // R4.26
    state = 'UNKNOWN';
    reason = 'Insufficient evidence to determine whether the primary failure was resolved';
  } else if (!input.primaryResolved) {
    state = 'PRIMARY_NOT_RESOLVED';
    reason = 'The primary failure is still present after repair';
  } else if (!input.verificationPassed) {
    state = 'PRIMARY_NOT_RESOLVED';
    reason = 'Primary failure resolved but required verification did not pass';
  } else if (input.requiredVerificationRan === false) {
    state = 'UNKNOWN';
    reason = 'Required verification for the failed Todo did not run';
  } else if (!input.scopeRespected) {
    state = 'PRIMARY_NOT_RESOLVED';
    reason = 'Repair left the allowed scope';
  } else {
    state = 'PRIMARY_RESOLVED';
    reason = 'Primary failure resolved within allowed scope with acceptance preserved';
  }

  return Object.freeze({
    state,
    succeeded: state === 'PRIMARY_RESOLVED',
    primaryResolved: input.primaryResolved === true && chasing.length === 0,
    acceptancePreserved,
    verificationPassed: input.verificationPassed,
    scopeRespected: input.scopeRespected,
    findings: Object.freeze([...findings]),
    reason,
  });
}

function dedupe(findings: ReadonlyArray<RepairSafetyFinding>): RepairSafetyFinding[] {
  const seen = new Map<string, RepairSafetyFinding>();
  for (const finding of findings) {
    seen.set(`${finding.kind}|${finding.subject}`, Object.freeze(finding));
  }
  return [...seen.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject),
  );
}
