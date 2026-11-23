import { TodoItem, TodoPlan } from '../../domain/todo-plan';
import {
  OPERATIONS_BY_INTENT,
  OriginalIntent,
  RepairObjective,
  RepairObjectiveEvidence,
  RepairOperation,
  RepairSafetyFinding,
  RepairTargetDecision,
  RepairTargetValidation,
  normalizeObjectivePath,
  summarizeFindings,
} from '../../domain/repair/repair-objective';
import { classifyOriginalIntent } from './original-intent';
import { classifyRepairFile } from './file-classification';
import { uniqueSortedPaths } from '../vv/repair-scope';

/**
 * R4: build the repair objective, then judge proposed repair plans against it.
 *
 * The planner may propose anything. This module decides whether what it
 * proposed is a repair of the user's task or merely a way to stop the check
 * from failing. That judgement is deterministic and happens here, not in the
 * model (R4.25).
 */

/* ------------------------------------------------------------ vocabularies */

/** Language that removes rather than fixes. */
const DESTRUCTIVE_TEXT =
  /\b(delete|remove|drop|strip|gut|erase|purge|get\s+rid\s+of|take\s+out)\b/i;

/** Language that suppresses a signal rather than satisfying it. */
const SUPPRESSION_TEXT =
  /\b(disable|skip|bypass|ignore|suppress|comment\s+out|turn\s+off|opt\s+out|exclude|silence|stub\s+out|short[-\s]?circuit)\b/i;

/** Language that lowers the bar instead of meeting it. */
const WEAKENING_TEXT =
  /\b(weaken|loosen|relax|soften|lower|reduce)\b|\b(change|update|adjust)\s+(the\s+)?(expected|assertion|assert|threshold)\b/i;

const RENAME_TEXT = /\brenam(e|ing)\b/i;
const MOVE_TEXT = /\b(move|relocate|migrate)\b[^.]{0,30}?\b(file|component|module)\b/i;
const CREATE_TEXT = /\b(create|add)\b[^.]{0,30}?\b(new\s+)?(file|component|module|endpoint|route)\b/i;

/* ---------------------------------------------------------------- building */

export interface BuildRepairObjectiveInput {
  /** R4.1: carried from the original request, never regenerated. */
  readonly originalTask: string;
  /** R4.2: from Product QA. Absent stays absent. */
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  /** R4.3: the plan from the original attempt, if it is still available. */
  readonly originalTodoPlan?: TodoPlan;
  readonly failedTodoId?: string;
  readonly primaryFailure?: string;
  readonly primaryFailureCheckId?: string;
  /** Files R3 expansion added, already evidence-backed. */
  readonly expandedFiles?: ReadonlyArray<string>;
  readonly missingExpectedChanges?: ReadonlyArray<string>;
  readonly unintendedChangedFiles?: ReadonlyArray<string>;
  readonly mutationTargets?: ReadonlyArray<string>;
  /** Files the FailureContract explicitly implicated. */
  readonly implicatedFiles?: ReadonlyArray<string>;
  /** Observables the acceptance contract requires to survive. */
  readonly requiredObservables?: ReadonlyArray<string>;
}

export function buildRepairObjective(input: BuildRepairObjectiveInput): RepairObjective {
  const classification = classifyOriginalIntent(input.originalTask);
  const intent = classification.intent;

  const failedTodo = findFailedTodo(input.originalTodoPlan, input.failedTodoId);

  // R4.5: the allow-list is the original Todo's own scope, widened only by
  // evidence that another file is involved. A failure message naming a file is
  // not by itself evidence; it has to arrive through one of these channels.
  const originalFiles = uniqueSortedPaths([
    ...(failedTodo?.files ?? []),
    ...(failedTodo ? [] : input.originalTodoPlan?.affectedFiles ?? []),
  ]).map(normalizeObjectivePath);

  const evidence: RepairObjectiveEvidence = Object.freeze({
    missingExpectedChanges: normalizeAll(input.missingExpectedChanges),
    unintendedChangedFiles: normalizeAll(input.unintendedChangedFiles),
    mutationTargets: normalizeAll(input.mutationTargets),
    expandedFiles: normalizeAll(input.expandedFiles),
  });

  const allowedFiles = uniqueSortedPaths([
    ...originalFiles,
    ...evidence.mutationTargets,
    ...evidence.missingExpectedChanges,
    ...evidence.expandedFiles,
    ...normalizeAll(input.implicatedFiles),
  ]).map(normalizeObjectivePath);

  return Object.freeze({
    originalTask: input.originalTask,
    acceptanceCriteria: Object.freeze([...(input.acceptanceCriteria ?? [])]),
    intent,
    intentConfidence: classification.confidence,
    intentEvidence: classification.evidence,
    originalTodoId: failedTodo?.id ?? input.failedTodoId,
    originalFiles: Object.freeze(originalFiles),
    originalConstraints: Object.freeze([...(input.originalTodoPlan?.constraints ?? [])]),
    primaryFailure: input.primaryFailure,
    primaryFailureCheckId: input.primaryFailureCheckId,
    allowedFiles: Object.freeze(allowedFiles),
    allowedOperations: OPERATIONS_BY_INTENT[intent],
    forbiddenChanges: Object.freeze([...(input.requiredObservables ?? [])]),
    evidence,
  });
}

function findFailedTodo(plan?: TodoPlan, failedTodoId?: string): TodoItem | undefined {
  if (!plan) return undefined;
  if (failedTodoId) {
    const match = plan.todos.find(todo => todo.id === failedTodoId);
    if (match) return match;
  }
  if (plan.failedTodoId) {
    return plan.todos.find(todo => todo.id === plan.failedTodoId);
  }
  return undefined;
}

/* -------------------------------------------------------------- operations */

export interface ProposedChange {
  readonly file: string;
  readonly operations: ReadonlyArray<RepairOperation>;
  /** The plan text that produced these operations. */
  readonly intentText: string;
}

/**
 * R4.6: read the operations a repair plan intends to perform. Derived from the
 * todo's declared action plus its own description of what it will do, so a
 * plan that says it will delete something is treated as a deletion even if it
 * declares itself a "modify".
 */
export function inferProposedChanges(plan: TodoPlan): ReadonlyArray<ProposedChange> {
  const byFile = new Map<string, { ops: Set<RepairOperation>; texts: string[] }>();

  for (const todo of plan.todos) {
    // Read-only steps propose no mutation.
    if (todo.action === 'inspect' || todo.action === 'verify') continue;

    const text = [todo.title, todo.description, todo.reason].filter(Boolean).join(' ');
    const ops = operationsFromText(text);
    for (const file of todo.files) {
      const key = normalizeObjectivePath(file);
      const entry = byFile.get(key) ?? { ops: new Set<RepairOperation>(), texts: [] };
      for (const op of ops) entry.ops.add(op);
      entry.texts.push(text);
      byFile.set(key, entry);
    }
  }

  // Files listed on the plan but claimed by no mutating todo still count as
  // proposed scope; we just cannot say more than MODIFY about them.
  for (const file of plan.affectedFiles) {
    const key = normalizeObjectivePath(file);
    if (!byFile.has(key)) byFile.set(key, { ops: new Set<RepairOperation>(['MODIFY']), texts: [] });
  }

  return Object.freeze(
    [...byFile.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([file, entry]) =>
        Object.freeze({
          file,
          operations: Object.freeze([...entry.ops].sort()),
          intentText: entry.texts.join(' | '),
        }),
      ),
  );
}

function operationsFromText(text: string): ReadonlyArray<RepairOperation> {
  const ops = new Set<RepairOperation>();
  if (DESTRUCTIVE_TEXT.test(text)) ops.add('DELETE');
  if (RENAME_TEXT.test(text)) ops.add('RENAME');
  if (MOVE_TEXT.test(text)) ops.add('MOVE');
  if (CREATE_TEXT.test(text)) ops.add('ADD');
  if (ops.size === 0) ops.add('MODIFY');
  return [...ops];
}

/* -------------------------------------------------------------- validation */

export interface ValidateRepairPlanInput {
  readonly objective: RepairObjective;
  readonly repairPlan: TodoPlan;
}

/**
 * R4.22/R4.23: judge a proposed repair plan against the objective.
 *
 * Findings are additive and always reported; the decision is derived from
 * their severity so that the reason a repair was refused is never hidden.
 */
export function validateRepairPlan(input: ValidateRepairPlanInput): RepairTargetValidation {
  const { objective } = input;
  const changes = inferProposedChanges(input.repairPlan);
  const findings: RepairSafetyFinding[] = [];

  const allowed = new Set(objective.allowedFiles.map(normalizeObjectivePath));
  const original = new Set(objective.originalFiles.map(normalizeObjectivePath));
  const allowedOps = new Set(objective.allowedOperations);
  const failureFiles = new Set([
    ...objective.evidence.mutationTargets,
    ...objective.originalFiles,
  ]);

  const disallowedFiles: string[] = [];
  const proposedOperations = new Set<RepairOperation>();

  for (const change of changes) {
    for (const op of change.operations) proposedOperations.add(op);
    const category = classifyRepairFile(change.file);

    // R4.5/R4.16: scope. An empty allow-list means we have no basis to judge,
    // so we do not manufacture a violation.
    if (allowed.size > 0 && !allowed.has(change.file)) {
      disallowedFiles.push(change.file);
      findings.push({
        kind: 'SCOPE_ESCAPE',
        severity: 'BLOCKING',
        subject: change.file,
        reason:
          `Repair proposes changing ${change.file}, which is outside the original Todo scope `
          + `and is not supported by mutation, workspace or expansion evidence`,
        evidenceRef: 'objective.allowedFiles',
      });
    }

    // R4.6/R4.12: operations the task never authorised.
    for (const op of change.operations) {
      if (allowedOps.has(op)) continue;
      findings.push({
        kind: 'INTENT_MISMATCH',
        severity: 'BLOCKING',
        subject: change.file,
        reason:
          `Repair proposes ${op} on ${change.file}, but the original intent `
          + `${objective.intent} authorises only ${objective.allowedOperations.join('/')}`,
        evidenceRef: 'objective.allowedOperations',
      });

      // R4.11: deleting the artifact that produced the failure is the
      // canonical way to make a symptom disappear.
      if (op === 'DELETE' && failureFiles.has(change.file)) {
        findings.push({
          kind: 'ACCEPTANCE_CHASING',
          severity: 'BLOCKING',
          subject: change.file,
          reason:
            `Deleting ${change.file} would remove the artifact the original task is about, `
            + `making the failure disappear without satisfying the task`,
          evidenceRef: 'objective.primaryFailure',
        });
      }
    }

    // R4.13: test edits. Legitimate when the task is about tests, or when the
    // test was already in the original scope.
    if (category === 'TEST') {
      const authorised = objective.intent === 'FIX_TEST' || original.has(change.file);
      const manipulative =
        DESTRUCTIVE_TEXT.test(change.intentText)
        || SUPPRESSION_TEXT.test(change.intentText)
        || WEAKENING_TEXT.test(change.intentText)
        || change.operations.includes('DELETE');
      if (!authorised) {
        findings.push({
          kind: 'TEST_MANIPULATION',
          severity: manipulative ? 'BLOCKING' : 'SUSPICIOUS',
          subject: change.file,
          reason: manipulative
            ? `Repair proposes deleting, skipping or weakening the test ${change.file}, `
              + `which the original task (${objective.intent}) does not concern`
            : `Repair touches the test ${change.file} although the original task is not about tests`,
          evidenceRef: 'objective.intent',
        });
      } else if (manipulative && change.operations.includes('DELETE')) {
        // Even a test-fixing task does not authorise removing the test whose
        // failure prompted the repair.
        findings.push({
          kind: 'TEST_MANIPULATION',
          severity: 'BLOCKING',
          subject: change.file,
          reason: `Repair proposes deleting ${change.file} rather than making it pass legitimately`,
          evidenceRef: 'plan.todos',
        });
      }
    }

    // R4.14: config edits used to switch the failing check off.
    if (category === 'CONFIG' && !original.has(change.file)) {
      const bypassing =
        SUPPRESSION_TEXT.test(change.intentText) || DESTRUCTIVE_TEXT.test(change.intentText);
      findings.push({
        kind: 'CONFIG_BYPASS',
        severity: bypassing ? 'BLOCKING' : 'SUSPICIOUS',
        subject: change.file,
        reason: bypassing
          ? `Repair proposes disabling or excluding behaviour via ${change.file} instead of fixing the cause`
          : `Repair modifies configuration ${change.file}, which the original task did not include`,
        evidenceRef: 'objective.originalFiles',
      });
    }

    // R4.15: weakening the verification apparatus itself is never a repair.
    if (category === 'VERIFICATION') {
      findings.push({
        kind: 'VERIFICATION_BYPASS',
        severity: 'BLOCKING',
        subject: change.file,
        reason:
          `Repair proposes modifying the verification artifact ${change.file}; `
          + `repair may not change how success is measured`,
        evidenceRef: 'file.category',
      });
    }

    // R4.11: suppression language against implementation code.
    if (category === 'SOURCE' && SUPPRESSION_TEXT.test(change.intentText)) {
      findings.push({
        kind: 'ACCEPTANCE_CHASING',
        severity: 'BLOCKING',
        subject: change.file,
        reason:
          `Repair proposes disabling or bypassing behaviour in ${change.file} `
          + `rather than fixing the cause of the failure`,
        evidenceRef: 'plan.todos',
      });
    }
  }

  return finalizeValidation({
    objective,
    changes,
    findings,
    disallowedFiles,
    proposedOperations: [...proposedOperations].sort(),
  });
}

function finalizeValidation(input: {
  readonly objective: RepairObjective;
  readonly changes: ReadonlyArray<ProposedChange>;
  readonly findings: ReadonlyArray<RepairSafetyFinding>;
  readonly disallowedFiles: ReadonlyArray<string>;
  readonly proposedOperations: ReadonlyArray<RepairOperation>;
}): RepairTargetValidation {
  const findings = dedupeFindings(input.findings);
  const proposedFiles = input.changes.map(change => change.file);

  let decision: RepairTargetDecision;
  let reason: string;

  if (findings.some(item => item.severity === 'BLOCKING')) {
    decision = 'BLOCK';
    reason = `Blocked by ${summarizeFindings(findings.filter(f => f.severity === 'BLOCKING'))}`;
  } else if (findings.some(item => item.severity === 'SUSPICIOUS')) {
    // R4.27: suspicious but not proven unsafe is exactly where a human decides.
    decision = 'NEEDS_CONFIRMATION';
    reason = `Requires confirmation: ${summarizeFindings(findings)}`;
  } else if (proposedFiles.length === 0) {
    // R4.26: nothing proposed is not the same as nothing wrong.
    decision = 'UNKNOWN';
    reason = 'Repair plan proposes no file changes; repair target cannot be validated';
  } else if (
    input.objective.intentConfidence === 'UNKNOWN'
    && input.objective.acceptanceCriteria.length === 0
    && input.proposedOperations.some(op => op === 'DELETE' || op === 'RENAME' || op === 'MOVE')
  ) {
    // R4.26/R4.27: a destructive operation with neither a known intent nor
    // acceptance criteria to judge it against is unresolvable, not fine.
    decision = 'NEEDS_CONFIRMATION';
    reason =
      'Destructive operation proposed while original intent and acceptance criteria are UNKNOWN';
  } else {
    decision = 'ALLOW';
    reason = 'Repair stays within allowed scope and operations for the original task';
  }

  return Object.freeze({
    decision,
    findings: Object.freeze(findings),
    proposedFiles: Object.freeze(proposedFiles),
    proposedOperations: Object.freeze(input.proposedOperations),
    disallowedFiles: Object.freeze(uniqueSortedPaths(input.disallowedFiles)),
    reason,
  });
}

function dedupeFindings(
  findings: ReadonlyArray<RepairSafetyFinding>,
): ReadonlyArray<RepairSafetyFinding> {
  const seen = new Map<string, RepairSafetyFinding>();
  for (const finding of findings) {
    const key = `${finding.kind}|${finding.subject}`;
    const existing = seen.get(key);
    if (!existing || rank(finding.severity) > rank(existing.severity)) {
      seen.set(key, Object.freeze(finding));
    }
  }
  return [...seen.values()].sort(
    (a, b) => rank(b.severity) - rank(a.severity) || a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject),
  );
}

function rank(severity: RepairSafetyFinding['severity']): number {
  return severity === 'BLOCKING' ? 2 : severity === 'SUSPICIOUS' ? 1 : 0;
}

function normalizeAll(files?: ReadonlyArray<string>): ReadonlyArray<string> {
  return Object.freeze(uniqueSortedPaths([...(files ?? [])]).map(normalizeObjectivePath));
}

export function intentAuthorizesDeletion(intent: OriginalIntent): boolean {
  return OPERATIONS_BY_INTENT[intent].includes('DELETE');
}
