/**
 * Reliability Hardening R2 — executor mutation safety (R2.3-R2.30).
 *
 * This module is the deterministic half of the mutation safety boundary. It
 * owns the vocabulary (status, failure code, decision), the diff arithmetic
 * and the policy that turns evidence into ALLOW / WARN / BLOCK / ROLLBACK.
 *
 * Nothing here performs IO and nothing here consults a model. The policy is a
 * pure function of recorded evidence so the same evidence always produces the
 * same decision, which is what lets R2 claim a bad write is *contained* rather
 * than merely noticed later by V&V.
 */

/* ------------------------------------------------------------- vocabulary */

/** R2.19: explicit mutation outcomes; a write never just returns "success". */
export const MUTATION_STATUSES = [
  'APPLIED',
  'REJECTED',
  'BLOCKED',
  'ROLLED_BACK',
  'FAILED',
] as const;
export type MutationStatus = (typeof MUTATION_STATUSES)[number];

/** R2.20: why a mutation was not cleanly applied. */
export const MUTATION_FAILURE_CODES = [
  'TARGET_OUT_OF_SCOPE',
  'READ_ONLY',
  'FILE_CREATION_NOT_PERMITTED',
  'PATH_TRAVERSAL',
  'SYNTAX_INVALID',
  'EXPECTED_CHANGE_MISSING',
  'DIFF_SUSPICIOUS',
  'CONTENT_DESTROYED',
  'NO_CHANGE',
  'WRITE_FAILED',
  'READBACK_FAILED',
  'ROLLBACK_FAILED',
] as const;
export type MutationFailureCode = (typeof MUTATION_FAILURE_CODES)[number];

/** R2.30: the only four things the policy may ask the guard to do. */
export const MUTATION_DECISIONS = ['ALLOW', 'WARN', 'BLOCK', 'ROLLBACK'] as const;
export type MutationDecision = (typeof MUTATION_DECISIONS)[number];

export const MUTATION_OPERATIONS = ['create', 'modify', 'delete'] as const;
export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];

/** R2.28: cheap deterministic checks run first; V&V (level 5) runs last. */
export const MUTATION_VALIDATION_LEVELS = [
  'LEVEL_1_SCOPE',
  'LEVEL_2_STATE',
  'LEVEL_3_SYNTAX',
  'LEVEL_4_DIFF',
] as const;
export type MutationValidationLevel = (typeof MUTATION_VALIDATION_LEVELS)[number];

/* ------------------------------------------------------------- evidence */

/** R2.11: what actually changed on disk, in bounded numeric terms. */
export interface MutationDiffSummary {
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly linesBefore: number;
  readonly linesAfter: number;
}

export const EMPTY_DIFF_SUMMARY: MutationDiffSummary = Object.freeze({
  linesAdded: 0,
  linesRemoved: 0,
  bytesBefore: 0,
  bytesAfter: 0,
  linesBefore: 0,
  linesAfter: 0,
});

export interface MutationFinding {
  readonly level: MutationValidationLevel;
  readonly code: MutationFailureCode;
  readonly detail: string;
}

/** R2.18: structured per-file evidence. Never carries raw file bodies. */
export interface MutationResult {
  readonly path: string;
  readonly operation: MutationOperation;
  readonly toolName: string;
  readonly status: MutationStatus;
  readonly beforeState: 'PRESENT' | 'ABSENT';
  readonly afterState: 'PRESENT' | 'ABSENT';
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changed: boolean;
  readonly syntaxValid: boolean | null;
  readonly syntaxDetail?: string;
  readonly expectedChangePresent: boolean | null;
  readonly expectedMarkers: ReadonlyArray<string>;
  readonly diffSummary: MutationDiffSummary;
  readonly suspicious: boolean;
  readonly rolledBack: boolean;
  readonly rollbackVerified: boolean | null;
  readonly afterRollbackHash?: string;
  readonly decision: MutationDecision;
  readonly findings: ReadonlyArray<MutationFinding>;
}

/** R2.13/R2.14: one tool call may touch several files; the unit is the call. */
export interface MutationUnitResult {
  readonly toolName: string;
  readonly status: MutationStatus;
  readonly results: ReadonlyArray<MutationResult>;
  readonly findings: ReadonlyArray<MutationFinding>;
  readonly blockedBeforeWrite: boolean;
}

/** R2.23: run-level mutation accounting. */
export interface MutationLedger {
  readonly mutationAttempts: number;
  readonly successfulMutations: number;
  readonly rejectedMutations: number;
  readonly blockedMutations: number;
  readonly rolledBackMutations: number;
  readonly failedMutations: number;
  readonly syntaxFailures: number;
  readonly unexpectedDiffs: number;
  readonly expectedChangeFailures: number;
  readonly rollbackFailures: number;
  readonly outOfScopeAttempts: number;
  readonly results: ReadonlyArray<MutationResult>;
}

export const EMPTY_MUTATION_LEDGER: MutationLedger = Object.freeze({
  mutationAttempts: 0,
  successfulMutations: 0,
  rejectedMutations: 0,
  blockedMutations: 0,
  rolledBackMutations: 0,
  failedMutations: 0,
  syntaxFailures: 0,
  unexpectedDiffs: 0,
  expectedChangeFailures: 0,
  rollbackFailures: 0,
  outOfScopeAttempts: 0,
  results: Object.freeze([]),
});

/**
 * R2.23: one logical tool call contributes exactly one attempt per target
 * file, so a multi-file patch is not counted as a single write and a retried
 * step is not counted as one.
 */
export function buildMutationLedger(units: ReadonlyArray<MutationUnitResult>): MutationLedger {
  const results = units.flatMap(unit => unit.results);
  const count = (predicate: (result: MutationResult) => boolean) => results.filter(predicate).length;
  const hasCode = (result: MutationResult, code: MutationFailureCode) =>
    result.findings.some(finding => finding.code === code);

  return Object.freeze({
    mutationAttempts: results.length,
    successfulMutations: count(r => r.status === 'APPLIED'),
    rejectedMutations: count(r => r.status === 'REJECTED'),
    blockedMutations: count(r => r.status === 'BLOCKED'),
    rolledBackMutations: count(r => r.status === 'ROLLED_BACK'),
    failedMutations: count(r => r.status === 'FAILED'),
    syntaxFailures: count(r => hasCode(r, 'SYNTAX_INVALID')),
    unexpectedDiffs: count(r => r.suspicious),
    expectedChangeFailures: count(r => hasCode(r, 'EXPECTED_CHANGE_MISSING')),
    rollbackFailures: count(r => hasCode(r, 'ROLLBACK_FAILED')),
    outOfScopeAttempts: count(r =>
      hasCode(r, 'TARGET_OUT_OF_SCOPE')
      || hasCode(r, 'PATH_TRAVERSAL')
      || hasCode(r, 'FILE_CREATION_NOT_PERMITTED')),
    results: Object.freeze(results),
  });
}

/* ------------------------------------------------------------------ diff */

/**
 * R2.11: line accounting from a common prefix/suffix reduction.
 *
 * This is intentionally not a minimal-edit diff. It bounds the change — the
 * reported added/removed counts are never smaller than the true edit — which
 * is exactly the property the suspicion policy needs.
 */
export function summarizeDiff(before: string | null, after: string | null): MutationDiffSummary {
  const beforeText = before ?? '';
  const afterText = after ?? '';
  const beforeNorm = beforeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const afterNorm = afterText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const beforeLines = before === null ? [] : beforeNorm.split('\n');
  const afterLines = after === null ? [] : afterNorm.split('\n');

  let prefix = 0;
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;

  return Object.freeze({
    linesRemoved: Math.max(0, beforeLines.length - prefix - suffix),
    linesAdded: Math.max(0, afterLines.length - prefix - suffix),
    bytesBefore: before === null ? 0 : Buffer.byteLength(beforeText, 'utf8'),
    bytesAfter: after === null ? 0 : Buffer.byteLength(afterText, 'utf8'),
    linesBefore: beforeLines.length,
    linesAfter: afterLines.length,
  });
}

/* ---------------------------------------------------------------- policy */

/**
 * R2.12 thresholds. These are deliberately generous: the point is to catch a
 * write that clearly exceeded a tightly scoped todo, not to police normal
 * feature work. They only ever escalate to ROLLBACK when the todo declared an
 * explicit expected marker, which is the only case where "one small change"
 * is a machine-checkable claim rather than an assumption.
 */
export interface SuspicionThresholds {
  /** Changed-line budget for a mutation whose todo declared an explicit marker. */
  readonly markerScopedChangedLines: number;
  /** Fraction of the original file that may disappear before it looks like a clobber. */
  readonly maxRemovalRatio: number;
  /** Files under this line count are too small for ratio reasoning to mean anything. */
  readonly minLinesForRatio: number;
}

export const DEFAULT_SUSPICION_THRESHOLDS: SuspicionThresholds = Object.freeze({
  markerScopedChangedLines: 20,
  maxRemovalRatio: 0.5,
  minLinesForRatio: 10,
});

export interface SuspicionAssessment {
  readonly suspicious: boolean;
  readonly reasons: ReadonlyArray<string>;
  /** True only when the todo pinned the change to an explicit marker. */
  readonly markerScoped: boolean;
  /**
   * True when the write removed so much of the original file that it looks
   * like a clobber rather than an edit. Size alone is a soft signal;
   * destruction is not.
   */
  readonly destructive: boolean;
}

/** R2.12: deterministic suspicion detection; raising it is not a verdict. */
export function assessDiffSuspicion(input: {
  readonly diff: MutationDiffSummary;
  readonly operation: MutationOperation;
  readonly markerScoped: boolean;
  readonly thresholds?: SuspicionThresholds;
}): SuspicionAssessment {
  const thresholds = input.thresholds ?? DEFAULT_SUSPICION_THRESHOLDS;
  const reasons: string[] = [];
  let destructive = false;

  // A declared delete is supposed to remove the whole file.
  if (input.operation === 'delete') {
    return Object.freeze({
      suspicious: false,
      reasons: Object.freeze([]),
      markerScoped: input.markerScoped,
      destructive: false,
    });
  }

  const changedLines = input.diff.linesAdded + input.diff.linesRemoved;
  if (input.markerScoped && changedLines > thresholds.markerScopedChangedLines) {
    reasons.push(
      `todo declared an explicit expected marker but the write changed ${changedLines} lines `
      + `(+${input.diff.linesAdded}/-${input.diff.linesRemoved}), over the ${thresholds.markerScopedChangedLines}-line budget`,
    );
  }

  if (
    input.operation === 'modify'
    && input.diff.linesBefore >= thresholds.minLinesForRatio
    && input.diff.linesRemoved > input.diff.linesBefore * thresholds.maxRemovalRatio
  ) {
    destructive = true;
    reasons.push(
      `write removed ${input.diff.linesRemoved} of ${input.diff.linesBefore} existing lines, `
      + `over the ${Math.round(thresholds.maxRemovalRatio * 100)}% removal limit`,
    );
  }

  return Object.freeze({
    suspicious: reasons.length > 0,
    reasons: Object.freeze(reasons),
    markerScoped: input.markerScoped,
    destructive,
  });
}

export interface MutationPolicyInput {
  readonly outOfScope: boolean;
  readonly pathTraversal: boolean;
  readonly creationNotPermitted: boolean;
  readonly readOnly: boolean;
  readonly writeFailed: boolean;
  readonly readBackFailed: boolean;
  /** An existing file was reduced to nothing by an operation that was not a delete. */
  readonly contentDestroyed: boolean;
  readonly syntaxValid: boolean | null;
  readonly expectedChangePresent: boolean | null;
  readonly suspicion: SuspicionAssessment;
}

export interface MutationPolicyOutcome {
  readonly decision: MutationDecision;
  readonly primaryCode?: MutationFailureCode;
  readonly reason: string;
}

/**
 * R2.30: the whole ALLOW/WARN/BLOCK/ROLLBACK policy, in one deterministic
 * function. Ordered cheapest-first so a scope violation never reaches disk.
 */
export function decideMutation(input: MutationPolicyInput): MutationPolicyOutcome {
  if (input.readOnly) {
    return { decision: 'BLOCK', primaryCode: 'READ_ONLY', reason: 'execution mode is READ_ONLY' };
  }
  if (input.pathTraversal) {
    return {
      decision: 'BLOCK',
      primaryCode: 'PATH_TRAVERSAL',
      reason: 'target path escapes the workspace root',
    };
  }
  if (input.outOfScope) {
    return {
      decision: 'BLOCK',
      primaryCode: 'TARGET_OUT_OF_SCOPE',
      reason: 'target file is outside the scope the todo permits',
    };
  }
  if (input.creationNotPermitted) {
    return {
      decision: 'BLOCK',
      primaryCode: 'FILE_CREATION_NOT_PERMITTED',
      reason: 'todo scope does not permit creating this file',
    };
  }
  if (input.writeFailed) {
    return { decision: 'ROLLBACK', primaryCode: 'WRITE_FAILED', reason: 'mutation tool reported failure' };
  }
  if (input.readBackFailed) {
    return {
      decision: 'ROLLBACK',
      primaryCode: 'READBACK_FAILED',
      reason: 'target file could not be read back after the write reported success',
    };
  }
  // An empty file is syntactically valid and, on the removal-ratio scale, is
  // just a big diff. It is neither: emptying an existing file that was not a
  // declared delete is destruction, and it rolls back unconditionally.
  if (input.contentDestroyed) {
    return {
      decision: 'ROLLBACK',
      primaryCode: 'CONTENT_DESTROYED',
      reason: 'an existing file was emptied by a write that was not a declared delete',
    };
  }
  if (input.syntaxValid === false) {
    return { decision: 'ROLLBACK', primaryCode: 'SYNTAX_INVALID', reason: 'resulting source is not syntactically valid' };
  }
  if (input.expectedChangePresent === false) {
    return {
      decision: 'ROLLBACK',
      primaryCode: 'EXPECTED_CHANGE_MISSING',
      reason: 'the change the todo explicitly asked for is not present in the result',
    };
  }
  if (input.suspicion.suspicious) {
    // A large diff is evidence, not a verdict (R2.12).
    //
    // It only escalates when the todo pinned the change to an explicit marker,
    // because that is the only case where "this should have been small" is a
    // checkable claim. Without a marker a wide rewrite may be exactly the job.
    //
    // Within a pinned todo, an oversized-but-non-destructive diff still gets
    // the benefit of the doubt once the marker is confirmed present in a file
    // that parses: that is direct evidence the requested change landed, and it
    // outranks a size heuristic. A real E2E run rolled back a correct +13/-12
    // edit on the size rule alone. Wholesale removal is not forgiven this way,
    // since that looks like a clobber no matter what else survived.
    // Invalid syntax has already rolled back above.
    const changeConfirmed = input.expectedChangePresent === true && !input.suspicion.destructive;
    return input.suspicion.markerScoped && !changeConfirmed
      ? {
        decision: 'ROLLBACK',
        primaryCode: 'DIFF_SUSPICIOUS',
        reason: input.suspicion.reasons.join('; '),
      }
      : {
        decision: 'WARN',
        primaryCode: 'DIFF_SUSPICIOUS',
        reason: input.suspicion.reasons.join('; '),
      };
  }
  return { decision: 'ALLOW', reason: 'all deterministic mutation checks passed' };
}

/* --------------------------------------------------------------- markers */

/**
 * R2.10/R2.21: pulls literal markers out of task text without asking a model.
 *
 * Only unambiguous literal forms count — a JSX/block comment or a
 * `data-testid` value. Prose like "add a comment" produces no marker, and a
 * mutation with no marker is simply never expected-change validated. Inferring
 * a marker from loose wording would turn a planner sentence into a rollback
 * trigger, which R2.4 explicitly forbids.
 */
export function extractExpectedChangeMarkers(text: string | undefined | null): ReadonlyArray<string> {
  if (!text) return Object.freeze([]);
  const markers = new Set<string>();

  const jsxComment = /\{\s*\/\*([\s\S]{1,200}?)\*\/\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = jsxComment.exec(text)) !== null) {
    const body = match[1].trim();
    if (body) markers.add(body);
  }

  const testId = /data-testid\s*=\s*["']([^"']{1,120})["']/g;
  while ((match = testId.exec(text)) !== null) {
    const body = match[1].trim();
    if (body) markers.add(body);
  }

  return Object.freeze([...markers].sort());
}

/** R2.10: every declared marker must be literally present in the result. */
export function expectedChangeSatisfied(
  content: string,
  markers: ReadonlyArray<string>,
): boolean | null {
  if (markers.length === 0) return null;
  return markers.every(marker => content.includes(marker));
}

/* ----------------------------------------------------------------- paths */

export function normalizeMutationPath(value: string): string {
  return (value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

/**
 * R2.3/R2.24: scope membership. Directory scopes contain their files, but a
 * file scope never contains a sibling — `app/page.tsx` does not authorize
 * `app/layout.tsx`.
 */
export function isPathInScope(
  candidate: string,
  scope: ReadonlyArray<string>,
): boolean {
  if (scope.length === 0) return true;
  const target = normalizeMutationPath(candidate).toLowerCase();
  if (!target) return false;
  return scope.some(entry => {
    const allowed = normalizeMutationPath(entry).toLowerCase();
    if (!allowed) return false;
    if (target === allowed) return true;
    // A declared directory authorizes everything beneath it.
    if (!allowed.includes('.') && target.startsWith(allowed + '/')) return true;
    // Scope entries and tool arguments disagree about how much of the path
    // they spell out, so a suffix match on a full path segment is accepted.
    return target.endsWith('/' + allowed) || allowed.endsWith('/' + target);
  });
}
