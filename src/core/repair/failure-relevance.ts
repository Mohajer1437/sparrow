import { ImpactAnalysis } from '../../domain/impact-analysis';
import { VerificationCheck } from '../../domain/verification-check';
import { RepairObjective, normalizeObjectivePath } from '../../domain/repair/repair-objective';

/**
 * R4.9: decide whether a verification failure is actually about the task being
 * repaired.
 *
 * A failing check is evidence, not an assignment. A footer regression that
 * surfaces during a run about the login page does not make the footer part of
 * the repair. Relevance has to be established through a structured link —
 * the failed Todo, an affected artifact in scope, an import edge from impact
 * analysis, or a stated acceptance criterion — and if none of those hold the
 * answer is INCIDENTAL or UNKNOWN rather than a widened scope.
 */

export const FAILURE_RELEVANCES = ['RELEVANT', 'INCIDENTAL', 'UNKNOWN'] as const;
export type FailureRelevance = (typeof FAILURE_RELEVANCES)[number];

export interface FailureRelevanceVerdict {
  readonly checkId: string;
  readonly relevance: FailureRelevance;
  readonly reason: string;
  /** The structured field that established the link, when there is one. */
  readonly evidenceRef?: string;
  readonly artifact?: string;
}

export interface ClassifyFailureRelevanceInput {
  readonly objective: RepairObjective;
  readonly check: VerificationCheck;
  /** Files the check itself named, if the verifier reported any. */
  readonly affectedArtifacts?: ReadonlyArray<string>;
  readonly failedTodoId?: string;
  readonly impactAnalysis?: ImpactAnalysis;
}

export function classifyFailureRelevance(
  input: ClassifyFailureRelevanceInput,
): FailureRelevanceVerdict {
  const { objective, check } = input;

  // R1.6: `todoId` is the only trustworthy check-to-Todo mapping.
  const checkTodoId = check.todoId ?? input.failedTodoId;
  if (checkTodoId && objective.originalTodoId && checkTodoId === objective.originalTodoId) {
    return verdict(check.id, 'RELEVANT', 'Check belongs to the failed Todo', 'failedTodoId');
  }

  // R4.10: a check that verifies a stated acceptance criterion is relevant
  // even when it names no file.
  const criterion = (check.acceptanceCriterion || '').trim();
  if (criterion && objective.acceptanceCriteria.some(item => sameCriterion(item, criterion))) {
    return verdict(
      check.id,
      'RELEVANT',
      'Check verifies a stated original acceptance criterion',
      'acceptanceCriteria',
    );
  }

  const artifacts = (input.affectedArtifacts ?? extractArtifactsFromCheck(check))
    .map(normalizeObjectivePath)
    .filter(Boolean);
  if (artifacts.length === 0) {
    return verdict(
      check.id,
      'UNKNOWN',
      'Check names no artifact and matches no acceptance criterion; relevance cannot be established',
    );
  }

  const inScope = new Set([
    ...objective.originalFiles,
    ...objective.allowedFiles,
    ...objective.evidence.mutationTargets,
    ...objective.evidence.missingExpectedChanges,
  ]);
  const direct = artifacts.find(artifact => inScope.has(artifact));
  if (direct) {
    return verdict(check.id, 'RELEVANT', 'Check names an artifact inside the repair scope', 'allowedFiles', direct);
  }

  // R4.19: an import edge from an original file to the failing artifact is
  // real evidence. An unrelated file failing at the same time is not.
  const related = artifacts.find(artifact => impactRelates(input.impactAnalysis, objective, artifact));
  if (related) {
    return verdict(
      check.id,
      'RELEVANT',
      'Impact analysis links the failing artifact to a file in the original scope',
      'impactAnalysis',
      related,
    );
  }

  return verdict(
    check.id,
    'INCIDENTAL',
    `Failing artifact ${artifacts[0]} has no established relation to the original task`,
    undefined,
    artifacts[0],
  );
}

export function classifyFailureRelevances(
  objective: RepairObjective,
  checks: ReadonlyArray<VerificationCheck>,
  options?: {
    readonly failedTodoId?: string;
    readonly impactAnalysis?: ImpactAnalysis;
    readonly artifactsByCheckId?: Readonly<Record<string, ReadonlyArray<string>>>;
  },
): ReadonlyArray<FailureRelevanceVerdict> {
  return Object.freeze(
    checks.map(check =>
      classifyFailureRelevance({
        objective,
        check,
        failedTodoId: options?.failedTodoId,
        impactAnalysis: options?.impactAnalysis,
        affectedArtifacts: options?.artifactsByCheckId?.[check.id],
      }),
    ),
  );
}

/**
 * Pull file paths out of a check's own evidence. Only path-shaped tokens are
 * accepted, so prose cannot nominate files.
 */
const PATH_TOKEN =
  /\b((?:[\w.@-]+\/)+[\w.-]+\.[a-z0-9]{1,5})\b/gi;

export function extractArtifactsFromCheck(check: VerificationCheck): ReadonlyArray<string> {
  const text = [check.evidence, check.name].filter(Boolean).join(' ');
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_TOKEN)) {
    found.add(normalizeObjectivePath(match[1]));
  }
  return Object.freeze([...found].sort());
}

function impactRelates(
  impact: ImpactAnalysis | undefined,
  objective: RepairObjective,
  artifact: string,
): boolean {
  if (!impact) return false;
  const originals = new Set(objective.originalFiles);
  const nodes = [
    ...(impact.directlyAffected ?? []),
    ...(impact.indirectlyAffected ?? []),
    ...(impact.affectedTests ?? []),
  ].map(normalizeObjectivePath);

  if (!nodes.includes(artifact)) return false;
  // The artifact participates in the impact graph; it only counts when that
  // graph was rooted in the original scope.
  const roots = (impact.changedFiles ?? []).map(normalizeObjectivePath);
  return roots.some(root => originals.has(root));
}

function sameCriterion(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function verdict(
  checkId: string,
  relevance: FailureRelevance,
  reason: string,
  evidenceRef?: string,
  artifact?: string,
): FailureRelevanceVerdict {
  return Object.freeze({ checkId, relevance, reason, evidenceRef, artifact });
}
