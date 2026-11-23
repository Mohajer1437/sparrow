/**
 * R3: the domain model for repair context expansion.
 *
 * Everything here is pure. The policy that decides whether context may grow,
 * which files are eligible, and when to stop lives in this file so it can be
 * read and tested in one place, and so no LLM output can reach it. Callers
 * supply evidence; these functions supply verdicts.
 */

import { ImpactAnalysis, ImpactConfidence, ImpactRelationType } from '../impact-analysis';

/* ------------------------------------------------------------- decisions */

export const EXPANSION_DECISIONS = [
  /** Evidence on hand is sufficient; the previous attempt simply got it wrong. */
  'REPAIR_WITH_EXISTING_CONTEXT',
  /** Named evidence is missing and at least one evidence-backed candidate exists. */
  'EXPAND_CONTEXT',
  /** Evidence is missing and nothing evidence-backed can supply it. */
  'NEEDS_CONTEXT',
  /** Continuing cannot help; the loop must end. */
  'STOP',
] as const;
export type ExpansionDecision = (typeof EXPANSION_DECISIONS)[number];

export const EXPANSION_STOP_CODES = [
  'NO_NEW_CANDIDATES',
  'NO_NEW_EVIDENCE',
  'EXPANSION_LIMIT_REACHED',
  'REPAIR_LIMIT_REACHED',
  'NEEDS_CONTEXT',
  'BLOCKED',
] as const;
export type ExpansionStopCode = (typeof EXPANSION_STOP_CODES)[number];

/* -------------------------------------------------------- missing evidence */

/**
 * What the failure says is absent. Each kind must be derivable from a
 * structured field, never from prose the model produced.
 */
export const MISSING_EVIDENCE_KINDS = [
  'MISSING_REFERENCED_FILE',
  'MISSING_DEPENDENCY',
  'MISSING_REVERSE_DEPENDENCY',
  'MISSING_FAILING_TEST',
  'MISSING_ROUTE_DEFINITION',
  'MISSING_CONFIG',
  'MISSING_ERROR_ORIGIN',
  'MISSING_MUTATION_TARGET',
] as const;
export type MissingEvidenceKind = (typeof MISSING_EVIDENCE_KINDS)[number];

export interface MissingEvidence {
  readonly kind: MissingEvidenceKind;
  /** The artifact the failure referred to, verbatim. Never invented. */
  readonly reference: string;
  /** Which structured field this was read out of. */
  readonly evidenceRef: string;
  /** True when the referenced artifact does not exist on disk (R3 Case 1). */
  readonly resolved: boolean;
}

/* ------------------------------------------------------------- candidates */

/**
 * Ranked by how directly evidence ties the file to the failure. Lower rank
 * wins. The ordering is the policy: it is why a file was chosen over another,
 * and it never depends on model output.
 */
export const CANDIDATE_SOURCES = [
  'FAILURE_REFERENCE',
  'FAILED_TODO_FILE',
  'MUTATION_TARGET',
  'IMPACT_DEPENDENCY',
  'IMPACT_REVERSE_DEPENDENCY',
  'FAILING_TEST',
  'AFFECTED_ENDPOINT',
  'CONFIG_REFERENCE',
  'IMPACT_INDIRECT',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const CANDIDATE_SOURCE_RANK: Readonly<Record<CandidateSource, number>> = Object.freeze({
  FAILURE_REFERENCE: 1,
  FAILED_TODO_FILE: 2,
  MUTATION_TARGET: 3,
  IMPACT_DEPENDENCY: 4,
  IMPACT_REVERSE_DEPENDENCY: 5,
  FAILING_TEST: 6,
  AFFECTED_ENDPOINT: 7,
  CONFIG_REFERENCE: 8,
  IMPACT_INDIRECT: 9,
});

export interface ExpansionCandidate {
  readonly path: string;
  readonly source: CandidateSource;
  readonly rank: number;
  readonly confidence: ImpactConfidence;
  /** Why this file is connected to the failure, in one line. */
  readonly reason: string;
  /** The structured field or relation this came from. */
  readonly evidenceRef: string;
  readonly relationType?: ImpactRelationType;
  /** False when the path does not exist in the workspace. */
  readonly exists: boolean;
  /** True when this path was already in the previous context. */
  readonly alreadyInContext: boolean;
}

export const CANDIDATE_REJECTIONS = [
  'NOT_FOUND',
  'ALREADY_IN_CONTEXT',
  'OUT_OF_WORKSPACE',
  'BUDGET_EXCEEDED',
  'UNCONFIRMED_RELATION',
] as const;
export type CandidateRejection = (typeof CANDIDATE_REJECTIONS)[number];

export interface RejectedCandidate {
  readonly path: string;
  readonly source: CandidateSource;
  readonly rejection: CandidateRejection;
  readonly reason: string;
}

export interface CandidateSelection {
  readonly selected: ReadonlyArray<ExpansionCandidate>;
  readonly rejected: ReadonlyArray<RejectedCandidate>;
  readonly budget: number;
  readonly budgetExceeded: boolean;
}

/* ------------------------------------------------------------ context refs */

/** One file in a planner context, identified by content, not by name alone. */
export interface ContextRef {
  readonly path: string;
  readonly fingerprint: string;
}

export interface ContextDelta {
  readonly previousFingerprint: string;
  readonly nextFingerprint: string;
  readonly newFiles: ReadonlyArray<string>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly unchangedFiles: ReadonlyArray<string>;
  readonly removedFiles: ReadonlyArray<string>;
  /**
   * True only when the context gained a file or one of its files changed
   * content. A larger file list with identical content is not new evidence.
   */
  readonly hasNewEvidence: boolean;
}

/* ------------------------------------------------------------- the verdict */

export interface ExpansionVerdict {
  readonly decision: ExpansionDecision;
  readonly reason: string;
  readonly missingEvidence: ReadonlyArray<MissingEvidence>;
  readonly stopCode?: ExpansionStopCode;
  readonly nextExpansionLevel: number;
}

/* ------------------------------------------------------------- fingerprints */

/**
 * A context fingerprint is the set of (path, content fingerprint) pairs, so it
 * changes when a file is added, removed, or edited, and does not change when
 * the same files are simply re-read.
 */
export function computeContextFingerprint(refs: ReadonlyArray<ContextRef>): string {
  const parts = [...refs]
    .filter(ref => ref.path)
    .map(ref => `${normalizeContextPath(ref.path)}@${ref.fingerprint || 'unknown'}`)
    .sort((a, b) => a.localeCompare(b));
  const unique = [...new Set(parts)];
  return unique.length === 0 ? 'empty' : hashString(unique.join('|'));
}

export function computeContextDelta(
  previous: ReadonlyArray<ContextRef>,
  next: ReadonlyArray<ContextRef>,
): ContextDelta {
  const before = new Map(previous.map(ref => [normalizeContextPath(ref.path), ref.fingerprint]));
  const after = new Map(next.map(ref => [normalizeContextPath(ref.path), ref.fingerprint]));

  const newFiles: string[] = [];
  const changedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const [path, fingerprint] of after) {
    if (!before.has(path)) newFiles.push(path);
    else if (before.get(path) !== fingerprint) changedFiles.push(path);
    else unchangedFiles.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removedFiles.push(path);
  }

  return Object.freeze({
    previousFingerprint: computeContextFingerprint(previous),
    nextFingerprint: computeContextFingerprint(next),
    newFiles: Object.freeze(newFiles.sort((a, b) => a.localeCompare(b))),
    changedFiles: Object.freeze(changedFiles.sort((a, b) => a.localeCompare(b))),
    unchangedFiles: Object.freeze(unchangedFiles.sort((a, b) => a.localeCompare(b))),
    removedFiles: Object.freeze(removedFiles.sort((a, b) => a.localeCompare(b))),
    hasNewEvidence: newFiles.length > 0 || changedFiles.length > 0,
  });
}

/* ----------------------------------------------------------------- ranking */

/**
 * Deterministic total order: evidence strength, then confirmed before
 * inferred, then path. Ties never depend on input order, so the same evidence
 * always yields the same selection.
 */
export function rankCandidates(
  candidates: ReadonlyArray<ExpansionCandidate>,
): ReadonlyArray<ExpansionCandidate> {
  return Object.freeze([...candidates].sort(compareCandidates));
}

function compareCandidates(a: ExpansionCandidate, b: ExpansionCandidate): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const confidence = confidenceOrder(a.confidence) - confidenceOrder(b.confidence);
  if (confidence !== 0) return confidence;
  return a.path.localeCompare(b.path);
}

function confidenceOrder(confidence: ImpactConfidence): number {
  if (confidence === 'CONFIRMED') return 0;
  if (confidence === 'INFERRED') return 1;
  return 2;
}

/* --------------------------------------------------------------- selection */

/**
 * Applies the budget. Candidates that do not exist, that repeat context we
 * already hold, or that overflow the budget are rejected with a reason rather
 * than silently dropped, so the run can explain what it did not read.
 */
export function selectCandidates(input: {
  readonly candidates: ReadonlyArray<ExpansionCandidate>;
  readonly budget: number;
  /** Relations weaker than CONFIRMED are only eligible above this rank. */
  readonly allowInferred?: boolean;
}): CandidateSelection {
  const budget = Math.max(0, input.budget);
  const ranked = rankCandidates(input.candidates);
  const selected: ExpansionCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const seen = new Set<string>();
  let budgetExceeded = false;

  for (const candidate of ranked) {
    const path = normalizeContextPath(candidate.path);
    if (seen.has(path)) continue;
    seen.add(path);

    if (!candidate.exists) {
      rejected.push(reject(candidate, 'NOT_FOUND',
        `referenced by ${candidate.evidenceRef} but no such file exists in the workspace`));
      continue;
    }
    if (candidate.alreadyInContext) {
      rejected.push(reject(candidate, 'ALREADY_IN_CONTEXT',
        'unchanged file already present in the previous context'));
      continue;
    }
    if (path.includes('..') || path.startsWith('/')) {
      rejected.push(reject(candidate, 'OUT_OF_WORKSPACE', 'path escapes the workspace root'));
      continue;
    }
    if (candidate.confidence === 'UNKNOWN' && input.allowInferred !== true) {
      rejected.push(reject(candidate, 'UNCONFIRMED_RELATION',
        'relation to the failure is not confirmed or inferred by impact analysis'));
      continue;
    }
    if (selected.length >= budget) {
      budgetExceeded = true;
      rejected.push(reject(candidate, 'BUDGET_EXCEEDED',
        `candidate budget of ${budget} file(s) already filled by higher-ranked evidence`));
      continue;
    }
    selected.push(candidate);
  }

  return Object.freeze({
    selected: Object.freeze(selected),
    rejected: Object.freeze(rejected),
    budget,
    budgetExceeded,
  });
}

function reject(
  candidate: ExpansionCandidate,
  rejection: CandidateRejection,
  reason: string,
): RejectedCandidate {
  return Object.freeze({ path: candidate.path, source: candidate.source, rejection, reason });
}

/* ------------------------------------------------------------------ policy */

export interface ExpansionPolicyInput {
  /** Attempts already recorded, used for the repair-attempt ceiling. */
  readonly completedRepairAttempts: number;
  readonly maxRepairAttempts: number;
  readonly expansionLevel: number;
  readonly maxContextExpansion: number;
  readonly missingEvidence: ReadonlyArray<MissingEvidence>;
  /** Evidence-backed candidates that are not already in context. */
  readonly newCandidateCount: number;
  /** True when the last two attempts produced the same plan fingerprint. */
  readonly duplicatePlan: boolean;
  /** True when the previous expansion actually changed the context. */
  readonly previousExpansionYieldedEvidence?: boolean;
  /** Safety verdict from the existing repair policy. */
  readonly safety?: 'PROCEED' | 'BLOCKED' | 'NEEDS_CONTEXT' | 'NEEDS_CONFIRMATION'
  | 'REPAIR_LIMIT_REACHED' | 'DUPLICATE_REPAIR_PLAN';
}

/**
 * R3.2/R3.3/R3.18/R3.19: the single deterministic answer to "may this repair
 * read more of the project, and if not, why not". Ordered so that hard limits
 * always beat opportunity, and so a plain failure never expands on its own.
 */
export function decideExpansion(input: ExpansionPolicyInput): ExpansionVerdict {
  const missing = Object.freeze([...input.missingEvidence]);
  const level = Math.max(0, input.expansionLevel);

  if (input.safety === 'BLOCKED') {
    return verdict('STOP', 'repair safety policy blocked this repair', missing, level, 'BLOCKED');
  }
  if (input.safety === 'REPAIR_LIMIT_REACHED'
    || input.completedRepairAttempts >= input.maxRepairAttempts) {
    return verdict('STOP',
      `repair attempt limit of ${input.maxRepairAttempts} reached`,
      missing, level, 'REPAIR_LIMIT_REACHED');
  }
  if (level >= input.maxContextExpansion) {
    return verdict('STOP',
      `context expansion limit of ${input.maxContextExpansion} level(s) reached`,
      missing, level, 'EXPANSION_LIMIT_REACHED');
  }

  // R3.19: expanding again after an expansion that changed nothing is the
  // blind retry this milestone exists to prevent. It outranks opportunity.
  if (input.duplicatePlan && input.previousExpansionYieldedEvidence === false) {
    return verdict('STOP',
      'plan repeated and the previous expansion produced no new evidence',
      missing, level, 'NO_NEW_EVIDENCE');
  }

  // R3.3: a failure is not by itself evidence that context was insufficient.
  // Expanding needs both a reason (an artifact the failure named, or a plan
  // that repeated) and somewhere evidence-backed to go.
  const unresolved = missing.filter(item => !item.resolved);
  const hasReason = missing.length > 0 || input.duplicatePlan;
  const expandable = input.newCandidateCount > 0;

  if (hasReason && expandable) {
    return verdict('EXPAND_CONTEXT',
      describeExpansionReason(missing, input.duplicatePlan, input.newCandidateCount),
      missing, level + 1);
  }

  // Nothing evidence-backed left to read. Saying so is the correct answer;
  // guessing at more files is not.
  if (unresolved.length > 0) {
    return verdict('NEEDS_CONTEXT',
      `failure references ${unresolved.length} artifact(s) that do not exist in the workspace`,
      missing, level, 'NEEDS_CONTEXT');
  }
  if (input.duplicatePlan) {
    return verdict('STOP',
      'repair plan repeated and no evidence-backed candidate remains to read',
      missing, level, 'NO_NEW_CANDIDATES');
  }
  return verdict('REPAIR_WITH_EXISTING_CONTEXT',
    'failure evidence names no artifact outside the current context',
    missing, level);
}

function describeExpansionReason(
  missing: ReadonlyArray<MissingEvidence>,
  duplicatePlan: boolean,
  candidateCount: number,
): string {
  const parts: string[] = [];
  if (missing.length > 0) {
    const kinds = [...new Set(missing.map(item => item.kind))].sort();
    parts.push(`failure evidence names missing ${kinds.join(', ')}`);
  }
  if (duplicatePlan) parts.push('repair plan repeated without new evidence');
  parts.push(`${candidateCount} evidence-backed candidate(s) available`);
  return parts.join('; ');
}

function verdict(
  decision: ExpansionDecision,
  reason: string,
  missingEvidence: ReadonlyArray<MissingEvidence>,
  nextExpansionLevel: number,
  stopCode?: ExpansionStopCode,
): ExpansionVerdict {
  return Object.freeze({ decision, reason, missingEvidence, stopCode, nextExpansionLevel });
}

/* ------------------------------------------------------------ impact reuse */

/**
 * R3.23: reads dependency direction straight out of Milestone F's relations.
 * Repair does not get its own dependency analyzer.
 */
export function relationsFor(
  analysis: ImpactAnalysis | undefined,
  file: string,
): ReadonlyArray<{ path: string; relationType: ImpactRelationType; confidence: ImpactConfidence; reason: string }> {
  if (!analysis) return Object.freeze([]);
  const target = normalizeContextPath(file);
  const out: Array<{ path: string; relationType: ImpactRelationType; confidence: ImpactConfidence; reason: string }> = [];
  for (const relation of analysis.relations) {
    const source = normalizeContextPath(relation.source);
    const dest = normalizeContextPath(relation.target);
    if (source === target) {
      out.push({ path: dest, relationType: relation.relationType, confidence: relation.confidence, reason: relation.reason });
    } else if (dest === target) {
      out.push({ path: source, relationType: relation.relationType, confidence: relation.confidence, reason: relation.reason });
    }
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ shared */

export function normalizeContextPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** Small stable digest; this identifies context, it does not secure anything. */
function hashString(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 + code, 0x85ebca6b) ^ (h2 >>> 13);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}
