import { randomUUID } from 'crypto';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';
import {
  FailureClassification,
  FailureContract,
  IncidentalFailure,
  PrimaryFailure,
  SecondaryFailure,
} from '../../domain/failure-contract';
import { expectedBehaviorFromCheck, inferImplicatedFiles } from './infer-source-files';
import { extractApiRouteFromText, normalizeApiRoute, sanitizeImplicatedSourcePath } from './api-route';

function extractAfter(evidence: string, label: string): string[] {
  const match = evidence.split(label);
  if (match.length < 2) return [];
  return match[1].split(';')[0].split('|').map(s => s.trim()).filter(Boolean);
}

function extractUrl(evidence: string): string | undefined {
  const match = evidence.match(/https?:\/\/[^\s;]+/);
  return match ? match[0] : undefined;
}

function extractTestId(evidence: string): string | undefined {
  const match = evidence.match(/test id:\s*([A-Za-z0-9:_-]+)/i)
    || evidence.match(/\[data-testid=["']([^"']+)["']\]/i)
    || evidence.match(/data-testid=["']([^"']+)["']/i);
  return match ? match[1] : undefined;
}

function extractLabeled(evidence: string, label: string): string | undefined {
  const match = evidence.match(new RegExp(label + ':\\s*([^;\\n|]+)', 'i'));
  return match ? match[1].trim() : undefined;
}

function collapseDuplicateBrowserFailures(failed: VerificationCheck[]): VerificationCheck[] {
  const seen = new Set<string>();
  const out: VerificationCheck[] = [];
  for (const check of failed) {
    if (check.id.startsWith('browser-pageerror-') || check.id.startsWith('browser-console-error-')) {
      const kind = check.id.startsWith('browser-pageerror-') ? 'pageerror' : 'console-error';
      const err = (
        check.evidence.match(/pageerror:\s*(.+?)(?:;|$)/i)
        || check.evidence.match(/console\.error:\s*(.+?)(?:\s*\||$)/i)
        || [undefined, check.evidence]
      )[1];
      const key = kind + '::' + String(err).trim().slice(0, 160);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(check);
  }
  return out;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
}

function isAuthzText(value: string): boolean {
  return /\b(unauthenticated|unauthorized|authorization|only authenticated|401|403)\b/i.test(value);
}

function isRegressionReplay(check: VerificationCheck): boolean {
  return check.id.startsWith('regression-replay-');
}

function isDomIncidental(check: VerificationCheck): boolean {
  return check.category === 'browser' && /browser-dom/i.test(check.id);
}

export function criterionMatchesCheck(check: VerificationCheck, criterion: string): boolean {
  const nCrit = normalizeText(criterion);
  if (!nCrit) return false;
  const nAc = normalizeText(check.acceptanceCriterion || '');
  if (nAc && (nAc === nCrit || (nAc.length > 12 && (nCrit.includes(nAc) || nAc.includes(nCrit))))) {
    return true;
  }
  const nName = normalizeText(check.name);
  if (nName.length > 16 && nCrit.includes(nName)) return true;
  const routeC = extractApiRouteFromText(criterion);
  const routeK = extractApiRouteFromText(
    [check.acceptanceCriterion, check.name, check.evidence].filter(Boolean).join('\n'),
  );
  if (
    routeC
    && routeK
    && normalizeApiRoute(routeC) === normalizeApiRoute(routeK)
    && isAuthzText(criterion)
    && isAuthzText([check.id, check.name, check.acceptanceCriterion || ''].join(' '))
  ) {
    return true;
  }
  return false;
}

export function checkMatchesAcceptance(
  check: VerificationCheck,
  criteria: ReadonlyArray<string>,
): boolean {
  return criteria.some(criterion => criterionMatchesCheck(check, criterion));
}

/**
 * Lower rank = higher priority.
 * 0 intent/acceptance checks
 * 1 matching Product QA authz/security criterion
 * 2 matching Product QA criterion (non-DOM)
 * 3 uncaught pageerror (product-critical)
 * 4 matching Product QA DOM criterion
 * 5 other CRITICAL product verification
 * 6 deterministic runtime / console / network
 * 7 API happy-path and other API
 * 8 browser/DOM incidental
 * 9 historical regression replay
 */
export function rankFailedCheck(
  check: VerificationCheck,
  criteria: ReadonlyArray<string> = [],
): number {
  const replay = isRegressionReplay(check);
  const matchesAc = !replay && checkMatchesAcceptance(check, criteria);
  const authz = isAuthzText([check.id, check.name, check.acceptanceCriterion || ''].join(' '));

  if (check.id.startsWith('intent-') || check.id.startsWith('acceptance-')) return 0;
  if (matchesAc && authz) return 1;
  if (matchesAc && !isDomIncidental(check)) return 2;
  if (!replay && (check.id.includes('pageerror') || /pageerror:/i.test(check.evidence))) return 3;
  if (matchesAc) return 4;
  if (!replay && check.severity === 'CRITICAL' && check.category === 'deterministic') return 5;
  if (!replay && (
    check.id.includes('runtime')
    || check.id.includes('console-error')
    || /console\.error:/i.test(check.evidence)
    || check.id.includes('network')
    || /requestfailed:|http5xx:|unexpected network failure:/i.test(check.evidence)
    || check.id.includes('nav')
  )) {
    return 6;
  }
  if (!replay && check.id.startsWith('endpoint-')) return 7;
  if (!replay && check.category === 'api' && (check.id.startsWith('api-') || check.id.includes('happy-path'))) {
    return 7;
  }
  if (!replay && check.category === 'browser') return 8;
  if (replay) return 9;
  return 10;
}

/** Ranks at or above this value are incidental / noise, not secondary product failures. */
export const INCIDENTAL_RANK_MIN = 8;

export interface PrioritizedFailure {
  readonly classification: FailureClassification;
  readonly rank: number;
  readonly check: VerificationCheck;
  readonly order: number;
}

/**
 * Deterministic PRIMARY / SECONDARY / INCIDENTAL classification.
 * Reuses rankFailedCheck. Does not consult an LLM.
 */
export function prioritizeFailures(
  checks: ReadonlyArray<VerificationCheck>,
  criteria: ReadonlyArray<string> = [],
): ReadonlyArray<PrioritizedFailure> {
  const failed = checks.filter(check => !check.passed).slice().sort((a, b) => {
    const rankDiff = rankFailedCheck(a, criteria) - rankFailedCheck(b, criteria);
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });

  return Object.freeze(failed.map((check, index) => {
    const rank = rankFailedCheck(check, criteria);
    const classification: FailureClassification = index === 0
      ? 'PRIMARY'
      : rank >= INCIDENTAL_RANK_MIN
        ? 'INCIDENTAL'
        : 'SECONDARY';
    return Object.freeze({ classification, rank, check, order: index });
  }));
}

function requiredOutcomeFor(
  primary: VerificationCheck,
  criteria: ReadonlyArray<string>,
): string {
  const matched = criteria.find(criterion => criterionMatchesCheck(primary, criterion));
  if (matched) return matched;
  if (
    (primary.id.startsWith('intent-') || primary.id.startsWith('acceptance-'))
    && primary.acceptanceCriterion
  ) {
    return primary.acceptanceCriterion;
  }
  return expectedBehaviorFromCheck(primary.id, primary.evidence, primary.acceptanceCriterion);
}

function authzUnderTest(
  primary: VerificationCheck,
  criteria: ReadonlyArray<string>,
): boolean {
  const blob = [
    primary.id,
    primary.name,
    primary.acceptanceCriterion || '',
    primary.evidence,
    ...criteria,
  ].join('\n');
  return isAuthzText(blob);
}

function mustNotChangeFor(
  primary: VerificationCheck,
  criteria: ReadonlyArray<string>,
): string[] {
  const items = [
    'payment',
    'unrelated routes',
    'root layout structure unless it is the throwing file',
  ];
  if (!authzUnderTest(primary, criteria)) {
    items.unshift('authentication');
  }
  return items;
}

export function buildFailureContract(input: {
  readonly profile: QualityProfile;
  readonly checks: ReadonlyArray<VerificationCheck>;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly attempt?: number;
  readonly workspacePath?: string;
}): FailureContract | undefined {
  const criteria = input.acceptanceCriteria ?? [];
  const failed = collapseDuplicateBrowserFailures(
    input.checks.filter(c => !c.passed).slice().sort((a, b) => {
      const rankDiff = rankFailedCheck(a, criteria) - rankFailedCheck(b, criteria);
      if (rankDiff !== 0) return rankDiff;
      return a.id.localeCompare(b.id);
    }),
  );
  if (failed.length === 0) return undefined;

  const prioritized = prioritizeFailures(failed, criteria);
  const primary = failed[0];
  const secondaryChecks = prioritized.filter(item => item.classification === 'SECONDARY').map(item => item.check);
  const incidentalChecks = prioritized.filter(item => item.classification === 'INCIDENTAL').map(item => item.check);
  const expectedBehavior = requiredOutcomeFor(primary, criteria);
  const requiredOutcome = expectedBehavior;

  const primaryBlock = [
    'PRIMARY FAILURE (this is why the result was rejected):',
    '- Fix ' + primary.category + '/' + primary.name + '. Evidence: ' + primary.evidence + '.',
    'Required outcome: ' + requiredOutcome + '.',
  ].join('\n');
  const secondaryBlock = secondaryChecks.length > 0
    ? 'SECONDARY FAILURES (relevant, but must not override the primary):\n'
      + secondaryChecks.map(c =>
        '- [' + c.severity + '] ' + c.category + '/' + c.name + '. Evidence: ' + c.evidence + '.',
      ).join('\n')
    : '';
  const incidentalBlock = incidentalChecks.length > 0
    ? 'INCIDENTAL FAILURES (do not override the primary product objective):\n'
      + incidentalChecks.map(c =>
        '- [' + c.severity + '] ' + c.category + '/' + c.name + '. Evidence: ' + c.evidence + '.',
      ).join('\n')
    : 'INCIDENTAL FAILURES: none.';

  const url = extractUrl(primary.evidence);
  const pageErrors = failed.flatMap(c => extractAfter(c.evidence, 'pageerror:'));
  const consoleEntries = failed.flatMap(c => extractAfter(c.evidence, 'console.error:'));
  const failedRequests = [
    ...failed.flatMap(c => extractAfter(c.evidence, 'requestfailed:')),
    ...failed.flatMap(c => extractAfter(c.evidence, 'http5xx:')),
    ...failed.flatMap(c => extractAfter(c.evidence, 'unexpected network failure:')),
  ];
  const source = extractLabeled(primary.evidence, 'source');
  const implicated = inferImplicatedFiles(
    [primary.evidence, source || ''].join('\n'),
    input.workspacePath,
  ).map(sanitizeImplicatedSourcePath);
  const uniqueImplicated = [...new Set(implicated)];
  const method = extractLabeled(primary.evidence, 'method');
  const selector = extractLabeled(primary.evidence, 'selector');
  const requestData = extractLabeled(primary.evidence, 'request')
    || (primary.evidence.match(/\{[^{}]{0,400}\}/) || [])[0];
  const rawRoute = extractLabeled(primary.evidence, 'route')
    || extractApiRouteFromText(primary.evidence + ' ' + (primary.acceptanceCriterion || ''))
    || (url ? new URL(url, 'http://127.0.0.1').pathname : undefined);
  const route = rawRoute && rawRoute.startsWith('/api')
    ? normalizeApiRoute(rawRoute)
    : rawRoute;

  const primaryFailure: PrimaryFailure = Object.freeze({
    role: 'PRIMARY',
    check: primary,
    category: primary.category,
    acceptanceCriterion: primary.acceptanceCriterion,
    expectedBehavior,
    actualBehavior: primary.evidence,
    requiredOutcome,
  });
  const secondaryFailures: ReadonlyArray<SecondaryFailure> = Object.freeze(
    secondaryChecks.map(check => Object.freeze({
      role: 'SECONDARY' as const,
      check,
      category: check.category,
      severity: check.severity,
      evidence: check.evidence,
      acceptanceCriterion: check.acceptanceCriterion,
    })),
  );
  const incidentalFailures: ReadonlyArray<IncidentalFailure> = Object.freeze(
    incidentalChecks.map(check => Object.freeze({
      role: 'INCIDENTAL' as const,
      check,
      category: check.category,
      severity: check.severity,
      evidence: check.evidence,
      acceptanceCriterion: check.acceptanceCriterion,
    })),
  );

  return Object.freeze({
    id: 'fail-' + randomUUID(),
    createdAt: new Date().toISOString(),
    qualityProfile: input.profile,
    summary: failed.length + ' verification check(s) failed',
    category: primary.category,
    severity: primary.severity,
    failedChecks: Object.freeze(failed),
    acceptanceCriteria: Object.freeze(
      criteria.length > 0
        ? criteria
        : failed.map(c => expectedBehaviorFromCheck(c.id, c.evidence, c.acceptanceCriterion)),
    ),
    repairInstructions: 'Do not patch around verification. Repair the PRIMARY failure.\n'
      + primaryBlock + '\n'
      + (secondaryBlock ? secondaryBlock + '\n' : '')
      + incidentalBlock
      + (uniqueImplicated.length
        ? '\nImplicated files (must be in the repair plan): ' + uniqueImplicated.join(', ')
        : ''),
    attempt: Math.max(1, input.attempt ?? 1),
    expectation: Object.freeze({
      acceptanceCriterion: primary.acceptanceCriterion,
      expectedBehavior,
    }),
    actual: Object.freeze({
      actualBehavior: primary.evidence,
      observedState: failed.map(c => c.id + '=' + (c.passed ? 'PASS' : 'FAIL')).join(', '),
    }),
    location: Object.freeze({
      url,
      route,
      file: uniqueImplicated[0] || (source ? sanitizeImplicatedSourcePath(source) : undefined),
      testId: extractTestId(primary.evidence),
      selector,
      method,
    }),
    reproduction: Object.freeze({
      preconditions: Object.freeze(['workspace under verification', 'quality profile ' + input.profile]),
      actions: Object.freeze(failed.map(c => 'Re-run ' + c.category + '/' + c.name)),
      requestData,
      environment: 'profile=' + input.profile + ' attempt=' + Math.max(1, input.attempt ?? 1)
        + (extractLabeled(primary.evidence, 'scenario') ? ' scenario=' + extractLabeled(primary.evidence, 'scenario') : ''),
    }),
    evidencePack: Object.freeze({
      pageErrors: Object.freeze(pageErrors),
      consoleEntries: Object.freeze(consoleEntries),
      failedRequests: Object.freeze(failedRequests),
      logRefs: Object.freeze(failed.map(c => c.id)),
    }),
    repairContract: Object.freeze({
      requiredOutcome,
      constraints: Object.freeze([
        'Do not patch around verification',
        'Keep out-of-scope behavior unchanged',
        'Original task file list is not a scope lock',
        'Repair the throwing source module; do not rewrite the parent layout unless the throw is in the layout file',
        'Do not add an Error Boundary or swallow the defect as a substitute for removing it',
        'Do not convert the root layout into a Client Component',
        'Do not remove previously satisfied acceptance markers unless the failed check names that marker as the defect',
        'Repair the PRIMARY failure; incidental failures must not override the primary product objective',
      ]),
      mustNotChange: Object.freeze(mustNotChangeFor(primary, criteria)),
    }),
    verification: Object.freeze({
      originalCheck: primary.id,
      regressionScope: failed.map(c => c.id).join(', '),
    }),
    implicatedFiles: Object.freeze(uniqueImplicated),
    primaryFailure,
    secondaryFailures,
    incidentalFailures,
    failureType: extractLabeled(primary.evidence, 'failureType') || primary.category,
    attemptId: 'attempt-' + String(Math.max(1, input.attempt ?? 1)),
    classification: 'PRIMARY',
    evidenceRefs: Object.freeze(failed.map(c => c.id)),
    endpointId: extractLabeled(primary.evidence, 'endpointId'),
    expectedStatus: extractLabeled(primary.evidence, 'expectedStatus'),
    actualStatus: parseStatus(extractLabeled(primary.evidence, 'actualStatus')),
    databaseVerificationStatus: extractPersistenceStatus(primary.evidence),
    impactEvidence: extractImpactEvidence(primary.evidence),
    affectedArtifact: extractLabeled(primary.evidence, 'affectedArtifact'),
    regressionCheck: extractLabeled(primary.evidence, 'regressionCheck'),
    failedTodoId: extractFailedTodoId(primary.evidence),
  });
}

function extractImpactEvidence(evidence: string): string[] | undefined {
  const labeled = extractLabeled(evidence, 'impactEvidence') || extractLabeled(evidence, 'impact');
  if (!labeled) return undefined;
  return labeled.split(';').map(s => s.trim()).filter(Boolean);
}

function parseStatus(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function extractPersistenceStatus(evidence: string): string | undefined {
  return extractLabeled(evidence, 'databaseVerificationStatus')
    || extractLabeled(evidence, 'persistenceResult')
    || extractLabeled(evidence, 'persistence');
}

function extractFailedTodoId(evidence: string): string | undefined {
  const labeled = extractLabeled(evidence, 'failedTodoId');
  if (!labeled || labeled === 'UNKNOWN') return undefined;
  return /^todo-[1-9][0-9]*$/.test(labeled) ? labeled : undefined;
}
