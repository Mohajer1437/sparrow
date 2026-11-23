import { FailureContract } from '../../domain/failure-contract';
import { RegressionCase } from '../../domain/regression-case';
import { VerificationCheck } from '../../domain/verification-check';
import { VerificationRequest } from '../../domain/verification-report';
import { parseBrowserAssertions } from './browser-assertions';
import { extractApiRouteFromText, normalizeApiRoute } from './api-route';

export function isMeaningfulFailure(contract: FailureContract): boolean {
  if (contract.severity === 'HIGH' || contract.severity === 'CRITICAL') return true;
  return contract.failedChecks.some(check =>
    check.severity === 'HIGH' || check.severity === 'CRITICAL',
  );
}

export function regressionCaseFromFailure(
  contract: FailureContract,
  request: VerificationRequest,
): RegressionCase | undefined {
  const primary = contract.primaryFailure?.check || contract.failedChecks[0];
  if (!primary || !isMeaningfulFailure(contract)) return undefined;
  const evidence = primary.evidence + '\n' + (contract.actual?.actualBehavior || '');
  const method = labeled(evidence, 'method') || contract.location?.method;
  const scenario = labeled(evidence, 'scenario');
  const expected = labeled(evidence, 'Expected') || contract.expectation?.expectedBehavior;
  const expectedStatuses = parseExpectedStatuses(expected || '')
    || parseExpectedStatuses(primary.acceptanceCriterion || '');
  const sameCase = isSameVerificationCase(contract, request, primary);
  const priorAssertions = parseBrowserAssertions(
    [primary.acceptanceCriterion, contract.expectation?.expectedBehavior, primary.evidence]
      .filter(Boolean)
      .join('\n'),
    contract.acceptanceCriteria,
  );
  const currentAssertions = parseBrowserAssertions(request.task, request.acceptanceCriteria);
  const assertions = primary.category === 'browser'
    ? (sameCase && currentAssertions.length > 0 ? currentAssertions : priorAssertions)
    : [];
  return Object.freeze({
    id: 'reg-' + contract.id,
    createdAt: new Date().toISOString(),
    qualityProfile: contract.qualityProfile,
    category: primary.category,
    checkId: primary.id,
    name: primary.name,
    acceptanceCriterion: primary.acceptanceCriterion,
    expectedBehavior: contract.expectation?.expectedBehavior
      || primary.acceptanceCriterion
      || expected
      || 'Previously failed check must keep passing',
    method,
    url: contract.location?.url || extractUrl(evidence),
    route: contract.location?.route || labeled(evidence, 'route'),
    requestData: contract.reproduction?.requestData || labeled(evidence, 'request') || extractJsonBody(evidence),
    scenario,
    expectedStatuses,
    browserRoute: primary.category === 'browser' ? (contract.location?.route || labeled(evidence, 'route')) : undefined,
    browserAssertions: assertions.length > 0
      ? assertions.map(item => ({ kind: item.kind, value: item.value }))
      : undefined,
    expectedState: expected,
    relevantFiles: contract.implicatedFiles,
    evidence: primary.evidence,
  });
}

function isSameVerificationCase(
  contract: FailureContract,
  request: VerificationRequest,
  primary: VerificationCheck,
): boolean {
  const blob = [request.task, ...(request.acceptanceCriteria || [])].filter(Boolean).join('\n');
  const category = contract.category || primary.category;
  const route = contract.location?.route;
  const currentRoute = extractApiRouteFromText(blob);
  if (category === 'api') {
    if (route && currentRoute) return normalizeApiRoute(route) === normalizeApiRoute(currentRoute);
    return !!(route && blob.includes(route));
  }
  if (category === 'browser') {
    const current = parseBrowserAssertions(request.task, request.acceptanceCriteria);
    const prior = parseBrowserAssertions(
      [primary.acceptanceCriterion, contract.expectation?.expectedBehavior, primary.evidence]
        .filter(Boolean)
        .join('\n'),
      contract.acceptanceCriteria,
    );
    if (current.length === 0 || prior.length === 0) return false;
    return current.some(item =>
      prior.some(other => other.kind === item.kind && other.value === item.value),
    );
  }
  return false;
}

export function toReplayCheck(regressionCase: RegressionCase, check: VerificationCheck): VerificationCheck {
  return Object.freeze({
    ...check,
    id: 'regression-replay-' + regressionCase.id,
    name: 'Regression replay: ' + regressionCase.name,
    acceptanceCriterion: regressionCase.expectedBehavior,
  });
}

export function assertionsAsCriteria(regressionCase: RegressionCase): string[] {
  const lines: string[] = [];
  if (regressionCase.acceptanceCriterion) lines.push(regressionCase.acceptanceCriterion);
  if (regressionCase.expectedBehavior) lines.push(regressionCase.expectedBehavior);
  for (const assertion of regressionCase.browserAssertions || []) {
    if (assertion.kind === 'testid') lines.push('data-testid=' + assertion.value);
    else if (assertion.kind === 'text') lines.push('exact visible text ' + assertion.value);
    else if (assertion.kind === 'contains-text') lines.push('contains text ' + assertion.value);
    else if (assertion.kind === 'absent-text') lines.push('must not contain ' + assertion.value);
    else if (assertion.kind === 'selector') lines.push('selector="' + assertion.value + '"');
    else if (assertion.kind === 'role') lines.push('role=' + assertion.value);
    else if (assertion.kind === 'visible') lines.push('visible selector="' + assertion.value + '"');
    else if (assertion.kind === 'not-visible') lines.push('selector="' + assertion.value + '" must not be visible');
    else if (assertion.kind === 'page-state') {
      const [state, id] = assertion.value.split(':');
      lines.push(state + ' state data-testid=' + id);
    }
  }
  if (regressionCase.browserRoute) lines.push(regressionCase.browserRoute);
  return lines;
}

function labeled(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(label + ':\\s*([^;\\n]+)', 'i'));
  return match ? match[1].trim() : undefined;
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s;]+/);
  return match ? match[0] : undefined;
}

function extractJsonBody(text: string): string | undefined {
  const match = text.match(/\{[^{}]{0,400}\}/);
  return match ? match[0] : undefined;
}

function parseExpectedStatuses(text: string): number[] | undefined {
  const codes = [...text.matchAll(/\b([1-5]\d\d)\b/g)].map(match => Number(match[1]));
  const unique = [...new Set(codes)];
  return unique.length > 0 ? unique : undefined;
}
