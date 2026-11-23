/**
 * R3.4/R3.5/R3.21/R3.22/R3.23: turn structured failure evidence into a set of
 * candidate files, each carrying the reason it was chosen.
 *
 * The rule this module exists to enforce: a file becomes a candidate only
 * because some structured field or impact relation points at it. Nothing here
 * reads prose, guesses at naming conventions, or walks the repository.
 */

import { FailureContract } from '../../domain/failure-contract';
import { ImpactAnalysis } from '../../domain/impact-analysis';
import { MutationLedger } from '../../domain/execution/mutation-safety';
import {
  CANDIDATE_SOURCE_RANK,
  CandidateSource,
  ContextRef,
  ExpansionCandidate,
  MissingEvidence,
  MissingEvidenceKind,
  normalizeContextPath,
  relationsFor,
} from '../../domain/repair/context-expansion';

/** Mutation failures that say something about *where* the change should have gone. */
const MUTATION_CODES_WORTH_CONTEXT = Object.freeze([
  'EXPECTED_CHANGE_MISSING',
  'TARGET_OUT_OF_SCOPE',
  'SYNTAX_INVALID',
  'CONTENT_DESTROYED',
]);

export interface CandidateGenerationInput {
  readonly failureContract?: FailureContract;
  readonly failedTodoFiles?: ReadonlyArray<string>;
  readonly impactAnalysis?: ImpactAnalysis;
  readonly mutationLedger?: MutationLedger;
  /** Files the planner already holds, with the content fingerprint it holds. */
  readonly previousContext?: ReadonlyArray<ContextRef>;
  /** Deterministic existence check against the workspace. */
  readonly fileExists: (relativePath: string) => boolean;
  /** Current content fingerprint, used to spot a candidate whose content moved on. */
  readonly fingerprintOf?: (relativePath: string) => string | undefined;
}

export interface CandidateGenerationResult {
  readonly candidates: ReadonlyArray<ExpansionCandidate>;
  readonly missingEvidence: ReadonlyArray<MissingEvidence>;
}

export function generateExpansionCandidates(
  input: CandidateGenerationInput,
): CandidateGenerationResult {
  const seeds = collectSeeds(input);
  const previous = new Map(
    (input.previousContext ?? []).map(ref => [normalizeContextPath(ref.path), ref.fingerprint]),
  );

  const candidates: ExpansionCandidate[] = [];
  const missing: MissingEvidence[] = [];
  const emitted = new Set<string>();

  const emit = (seed: Seed): void => {
    const path = normalizeContextPath(seed.path);
    if (!path || emitted.has(path)) return;
    emitted.add(path);

    const exists = safeExists(input.fileExists, path);
    // A file we already hold is only new evidence if its content moved on.
    const heldFingerprint = previous.get(path);
    const currentFingerprint = exists ? input.fingerprintOf?.(path) : undefined;
    const alreadyInContext = heldFingerprint !== undefined
      && (currentFingerprint === undefined || currentFingerprint === heldFingerprint);

    candidates.push(Object.freeze({
      path,
      source: seed.source,
      rank: CANDIDATE_SOURCE_RANK[seed.source],
      confidence: seed.confidence,
      reason: seed.reason,
      evidenceRef: seed.evidenceRef,
      relationType: seed.relationType,
      exists,
      alreadyInContext,
    }));

    if (!exists && seed.missingKind) {
      missing.push(Object.freeze({
        kind: seed.missingKind,
        reference: path,
        evidenceRef: seed.evidenceRef,
        resolved: false,
      }));
    } else if (exists && seed.missingKind && !alreadyInContext) {
      missing.push(Object.freeze({
        kind: seed.missingKind,
        reference: path,
        evidenceRef: seed.evidenceRef,
        resolved: true,
      }));
    }
  };

  for (const seed of seeds) emit(seed);

  return Object.freeze({
    candidates: Object.freeze(candidates),
    missingEvidence: Object.freeze(missing),
  });
}

/* ------------------------------------------------------------------- seeds */

interface Seed {
  readonly path: string;
  readonly source: CandidateSource;
  readonly confidence: 'CONFIRMED' | 'INFERRED' | 'UNKNOWN';
  readonly reason: string;
  readonly evidenceRef: string;
  readonly relationType?: ExpansionCandidate['relationType'];
  /** Set when the absence of this file is itself the missing evidence. */
  readonly missingKind?: MissingEvidenceKind;
}

function collectSeeds(input: CandidateGenerationInput): Seed[] {
  const seeds: Seed[] = [];
  const contract = input.failureContract;

  // 1. Files the failure itself names. These are the strongest evidence there
  //    is: the system under test told us where it broke.
  if (contract?.location?.file) {
    seeds.push({
      path: contract.location.file,
      source: 'FAILURE_REFERENCE',
      confidence: 'CONFIRMED',
      reason: 'failure location reported by verification',
      evidenceRef: 'failureContract.location.file',
      missingKind: 'MISSING_ERROR_ORIGIN',
    });
  }
  if (contract?.affectedArtifact) {
    seeds.push({
      path: contract.affectedArtifact,
      source: 'FAILURE_REFERENCE',
      confidence: 'CONFIRMED',
      reason: 'artifact the failure contract holds responsible',
      evidenceRef: 'failureContract.affectedArtifact',
      missingKind: 'MISSING_REFERENCED_FILE',
    });
  }
  for (const file of contract?.implicatedFiles ?? []) {
    seeds.push({
      path: file,
      source: 'FAILURE_REFERENCE',
      confidence: 'CONFIRMED',
      reason: 'implicated by the failure contract',
      evidenceRef: 'failureContract.implicatedFiles',
      missingKind: 'MISSING_REFERENCED_FILE',
    });
  }

  // 2. The todo that failed. Its declared files are in scope by construction.
  for (const file of input.failedTodoFiles ?? []) {
    seeds.push({
      path: file,
      source: 'FAILED_TODO_FILE',
      confidence: 'CONFIRMED',
      reason: 'declared file of the todo that failed',
      evidenceRef: 'todo.files',
    });
  }

  // 3. R3.22: mutation targets, but only for failures that actually say
  //    something about where the change belonged. A write that failed for an
  //    unrelated reason does not justify reading more of the project.
  for (const result of input.mutationLedger?.results ?? []) {
    const codes = result.findings.map(finding => finding.code);
    if (!codes.some(code => MUTATION_CODES_WORTH_CONTEXT.includes(code))) continue;
    seeds.push({
      path: result.path,
      source: 'MUTATION_TARGET',
      confidence: 'CONFIRMED',
      reason: `mutation on this file was refused [${codes.join(', ')}]`,
      evidenceRef: `mutationLedger.${result.status}`,
      missingKind: codes.includes('EXPECTED_CHANGE_MISSING')
        ? 'MISSING_MUTATION_TARGET'
        : undefined,
    });
  }

  // 4. R3.23: dependency direction, read from Milestone F's relations. Only
  //    files related to something the failure already named are eligible, so
  //    this widens the view by one hop rather than opening the repository.
  const anchors = [...new Set(seeds.map(seed => normalizeContextPath(seed.path)))];
  for (const anchor of anchors) {
    for (const relation of relationsFor(input.impactAnalysis, anchor)) {
      seeds.push({
        path: relation.path,
        source: sourceForRelation(relation.relationType),
        confidence: relation.confidence,
        reason: `${relation.relationType} of ${anchor}: ${relation.reason}`,
        evidenceRef: `impactAnalysis.relations.${relation.relationType}`,
        relationType: relation.relationType,
        missingKind: missingKindForRelation(relation.relationType),
      });
    }
  }

  // 5. Tests and endpoints impact analysis already tied to the change.
  for (const test of input.impactAnalysis?.affectedTests ?? []) {
    seeds.push({
      path: test,
      source: 'FAILING_TEST',
      confidence: 'CONFIRMED',
      reason: 'test impact analysis tied to the changed files',
      evidenceRef: 'impactAnalysis.affectedTests',
      missingKind: 'MISSING_FAILING_TEST',
    });
  }

  return seeds;
}

function sourceForRelation(relationType: ExpansionCandidate['relationType']): CandidateSource {
  switch (relationType) {
    case 'imports':
    case 'service_dependency':
    case 'dependency_reference':
      return 'IMPACT_DEPENDENCY';
    case 'imported_by':
      return 'IMPACT_REVERSE_DEPENDENCY';
    case 'test_reference':
      return 'FAILING_TEST';
    case 'route_handler':
    case 'controller_endpoint':
    case 'page_component':
      return 'AFFECTED_ENDPOINT';
    case 'config_reference':
      return 'CONFIG_REFERENCE';
    default:
      return 'IMPACT_INDIRECT';
  }
}

function missingKindForRelation(
  relationType: ExpansionCandidate['relationType'],
): MissingEvidenceKind | undefined {
  switch (relationType) {
    case 'imports':
    case 'service_dependency':
    case 'dependency_reference':
      return 'MISSING_DEPENDENCY';
    case 'imported_by':
      return 'MISSING_REVERSE_DEPENDENCY';
    case 'route_handler':
    case 'controller_endpoint':
      return 'MISSING_ROUTE_DEFINITION';
    case 'config_reference':
      return 'MISSING_CONFIG';
    case 'test_reference':
      return 'MISSING_FAILING_TEST';
    default:
      return undefined;
  }
}

function safeExists(check: (path: string) => boolean, path: string): boolean {
  try {
    return check(path) === true;
  } catch {
    return false;
  }
}
