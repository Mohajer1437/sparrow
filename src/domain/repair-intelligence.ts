import { ExecutionPlan } from './execution-plan';
import { FailureClassification, FailureContract } from './failure-contract';
import { TodoPlan } from './todo-plan';
import {
  ContextDelta,
  ExpansionCandidate,
  ExpansionDecision,
  ExpansionStopCode,
  MissingEvidence,
  RejectedCandidate,
} from './repair/context-expansion';

export type { FailureClassification };

export const FAILURE_CLASSIFICATIONS = ['PRIMARY', 'SECONDARY', 'INCIDENTAL'] as const;

export const REPAIR_SAFETY_STATES = [
  'PROCEED',
  'BLOCKED',
  'NEEDS_CONTEXT',
  'NEEDS_CONFIRMATION',
  'REPAIR_LIMIT_REACHED',
  'DUPLICATE_REPAIR_PLAN',
  /** R4.22: the proposed repair plan failed deterministic target validation. */
  'REPAIR_TARGET_REJECTED',
  /** R4.11: the repair made the failure disappear instead of fixing it. */
  'REPAIR_ACCEPTANCE_CHASING',
  /** R4.27: the repair proposes something only a human should authorise. */
  'REPAIR_NEEDS_CONFIRMATION',
] as const;
export type RepairSafetyState = (typeof REPAIR_SAFETY_STATES)[number];

export const TODO_VERIFICATION_SCOPES = ['TODO_SPECIFIC', 'WHOLE_RUN'] as const;
export type TodoVerificationScope = (typeof TODO_VERIFICATION_SCOPES)[number];

export const TODO_VERIFICATION_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type TodoVerificationVerdictKind = (typeof TODO_VERIFICATION_VERDICTS)[number];

export const REPAIR_ATTEMPT_OUTCOMES = [
  'FAILED',
  'SUCCEEDED',
  'BLOCKED',
  'DUPLICATE',
  'LIMIT_REACHED',
] as const;
export type RepairAttemptOutcome = (typeof REPAIR_ATTEMPT_OUTCOMES)[number];

export interface RepairLimits {
  readonly maxRepairAttempts: number;
  readonly maxContextExpansion: number;
  readonly maxRepairFiles: number;
}

export const DEFAULT_REPAIR_LIMITS: RepairLimits = Object.freeze({
  maxRepairAttempts: 2,
  maxContextExpansion: 2,
  maxRepairFiles: 8,
});

export interface RepairAttempt {
  readonly attemptId: string;
  readonly kind: 'ORIGINAL' | 'REPAIR';
  readonly failedTodoId?: string;
  readonly failedStepId?: string;
  readonly todoIds: ReadonlyArray<string>;
  readonly planFingerprint: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly filesTouched: ReadonlyArray<string>;
  readonly verificationPassed?: boolean;
  readonly verificationScope: TodoVerificationScope;
  readonly failureContractId?: string;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly expansionLevel: number;
  readonly outcome: RepairAttemptOutcome;
  /** R3.9/R3.14: identifies the context this attempt actually planned from. */
  readonly contextFingerprint?: string;
  /** R3.10: what the expansion that preceded this attempt added. */
  readonly contextDelta?: ContextDelta;
  /** R3.2: why the expansion before this attempt was allowed. */
  readonly expansionReason?: string;
}

export interface RepairAttemptHistory {
  readonly attempts: ReadonlyArray<RepairAttempt>;
}

export interface TodoVerificationVerdict {
  readonly todoId: string;
  readonly scope: TodoVerificationScope;
  readonly verdict: TodoVerificationVerdictKind;
}

export interface TodoVerificationTrace {
  readonly scope: TodoVerificationScope;
  readonly verdicts: ReadonlyArray<TodoVerificationVerdict>;
}

export interface RepairContext {
  readonly failureContract?: FailureContract;
  readonly failedTodoId?: string;
  readonly failedStepId?: string;
  readonly history: RepairAttemptHistory;
  readonly candidateFiles: ReadonlyArray<string>;
  readonly expansionLevel: number;
  readonly originalTask: string;
  readonly safety: RepairSafetyState;
  readonly limitState?: 'REPAIR_LIMIT_REACHED';
  /** R3: every candidate considered, with the evidence that produced it. */
  readonly candidates?: ReadonlyArray<ExpansionCandidate>;
  /** R3: candidates deliberately not read, and why. */
  readonly rejectedCandidates?: ReadonlyArray<RejectedCandidate>;
  /** R3: files this expansion added on top of what the planner already held. */
  readonly expandedFiles?: ReadonlyArray<string>;
  /** R3.4: artifacts the failure named that the context did not contain. */
  readonly missingEvidence?: ReadonlyArray<MissingEvidence>;
  /** R3.2: why expansion was or was not allowed. */
  readonly expansionDecision?: ExpansionDecision;
  readonly expansionReason?: string;
  readonly expansionStopCode?: ExpansionStopCode;
}

export interface RepairPlanFingerprintInput {
  readonly affectedFiles: ReadonlyArray<string>;
  readonly todos: ReadonlyArray<{
    readonly title: string;
    readonly action?: string;
    readonly files: ReadonlyArray<string>;
  }>;
}

export function emptyRepairHistory(): RepairAttemptHistory {
  return Object.freeze({ attempts: Object.freeze([]) });
}

export function freezeRepairAttempt(attempt: RepairAttempt): RepairAttempt {
  return Object.freeze({
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    failedTodoId: attempt.failedTodoId,
    failedStepId: attempt.failedStepId,
    todoIds: Object.freeze([...attempt.todoIds]),
    planFingerprint: attempt.planFingerprint,
    expected: attempt.expected,
    actual: attempt.actual,
    filesTouched: Object.freeze([...attempt.filesTouched]),
    verificationPassed: attempt.verificationPassed,
    verificationScope: attempt.verificationScope,
    failureContractId: attempt.failureContractId,
    evidenceRefs: Object.freeze([...attempt.evidenceRefs]),
    expansionLevel: attempt.expansionLevel,
    outcome: attempt.outcome,
    contextFingerprint: attempt.contextFingerprint,
    contextDelta: attempt.contextDelta,
    expansionReason: attempt.expansionReason,
  });
}

export function freezeRepairHistory(history: RepairAttemptHistory): RepairAttemptHistory {
  return Object.freeze({
    attempts: Object.freeze(history.attempts.map(freezeRepairAttempt)),
  });
}

export function nextAttemptId(history: RepairAttemptHistory): string {
  return `attempt-${history.attempts.length + 1}`;
}

export function fingerprintRepairPlan(input: RepairPlanFingerprintInput | TodoPlan | ExecutionPlan): string {
  const affected = 'affectedFiles' in input && Array.isArray(input.affectedFiles)
    ? input.affectedFiles
    : ('todoPlan' in input && input.todoPlan
      ? input.todoPlan.affectedFiles
      : []);
  const todos = 'todos' in input && Array.isArray((input as RepairPlanFingerprintInput).todos)
    ? (input as RepairPlanFingerprintInput).todos
    : ('todoPlan' in input && input.todoPlan
      ? input.todoPlan.todos
      : []);
  const files = uniqueSorted(affected.map(normalizeRepairFile));
  const todoKeys = uniqueSorted(
    todos.map(todo =>
      `${todo.action ?? ''}|${todo.title}|${uniqueSorted(todo.files.map(normalizeRepairFile)).join(',')}`
    ),
  );
  return `${files.join(';')}::${todoKeys.join('||')}`;
}

export function normalizeRepairFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
