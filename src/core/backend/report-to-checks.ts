import { VerificationCheck } from '../../domain/verification-check';
import {
  BackendVerificationReport,
  EndpointVerificationResult,
} from '../../domain/endpoint-verification';
import { formatTestCredentialRequest, TestCredentialRequest } from '../../domain/test-credential';
import { redactText } from '../security/secret-redaction';

export function backendReportToChecks(report: BackendVerificationReport): ReadonlyArray<VerificationCheck> {
  const checks: VerificationCheck[] = [];
  checks.push(Object.freeze({
    id: 'api-endpoint-discovery',
    category: 'api' as const,
    name: 'API endpoint discovery',
    passed: true,
    severity: 'LOW' as const,
    evidence: report.endpoints.length > 0
      ? 'Discovered ' + report.endpoints.length + ' endpoint(s): '
        + report.endpoints.slice(0, 12).map(item => item.id).join(', ')
      : 'No backend endpoints discovered from OpenAPI, NestJS, Express/Fastify, or route modules',
  }));

  const coverage = report.coverage;
  const coveragePassed = coverage.failed === 0
    && coverage.blocked === 0
    && coverage.notTested === 0;
  checks.push(Object.freeze({
    id: 'api-endpoint-coverage',
    category: 'api' as const,
    name: 'Endpoint coverage',
    passed: coveragePassed,
    severity: (coveragePassed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    evidence: formatCoverage(report),
    acceptanceCriterion: 'Every discovered in-scope endpoint is tested individually or skipped with an explicit reason',
  }));

  if (report.credentialRequest) {
    const request: TestCredentialRequest = {
      kind: 'REQUIRES_TEST_CREDENTIAL',
      environment: report.credentialRequest.environment === 'test' ? 'test' : 'unknown',
      scope: report.credentialRequest.scope,
      endpoints: report.credentialRequest.endpoints.map(id => {
        const parts = id.split(' ');
        return { method: parts[0], path: parts.slice(1).join(' ') };
      }),
      requiredCredential: report.credentialRequest.requiredCredential as TestCredentialRequest['requiredCredential'],
      reason: 'Admin endpoint detected; provide a test-environment admin token',
    };
    checks.push(Object.freeze({
      id: 'api-admin-credential',
      category: 'api' as const,
      name: 'Admin test credential',
      passed: false,
      severity: 'HIGH' as const,
      evidence: formatTestCredentialRequest(request),
      acceptanceCriterion: 'Admin endpoints require an explicit test-environment token',
    }));
  }

  for (const result of report.results) {
    checks.push(resultToCheck(result));
    const persistenceCheck = persistenceToCheck(result);
    if (persistenceCheck) checks.push(persistenceCheck);
  }
  return Object.freeze(checks);
}

/**
 * R1.9: a database assertion tied to one endpoint carries that endpoint's
 * Todo mapping, so persistence evidence can reach a Todo verdict instead of
 * disappearing into the whole-run pile.
 */
function persistenceToCheck(result: EndpointVerificationResult): VerificationCheck | undefined {
  const persistence = result.persistenceResult;
  if (!persistence) return undefined;
  const passed = persistence.status === 'PASS';
  return Object.freeze({
    id: 'db-' + result.endpointId.replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''),
    category: 'api' as const,
    name: 'database-read-check',
    passed,
    severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    evidence: redactText(`endpointId: ${result.endpointId}; databaseVerificationStatus: ${persistence.status}`),
    acceptanceCriterion: `${result.method} ${result.path} must persist its effect`,
    todoId: result.failedTodoId,
    scope: result.failedTodoId ? ('TODO_SPECIFIC' as const) : ('WHOLE_RUN' as const),
    required: true,
    source: 'database-verification',
  });
}

function resultToCheck(result: EndpointVerificationResult): VerificationCheck {
  const passed = result.status === 'PASS' || result.status === 'SKIPPED_WITH_REASON';
  const todo = result.failedTodoId ? `failedTodoId: ${result.failedTodoId}` : 'failedTodoId: UNKNOWN';
  const persistence = result.persistenceResult
    ? `databaseVerificationStatus: ${result.persistenceResult.status}`
    : 'databaseVerificationStatus: NOT_TESTED';
  const evidence = redactText([
    `endpointId: ${result.endpointId}`,
    `method: ${result.method}`,
    `path: ${result.path}`,
    `status: ${result.status}`,
    `expected: ${result.expected}`,
    `actual: ${result.actual}`,
    `authResult: ${result.authResult}`,
    persistence,
    `unhandledError: ${result.unhandledError}`,
    result.failureType ? `failureType: ${result.failureType}` : undefined,
    todo,
    result.skipReason ? `reason: ${result.skipReason}` : undefined,
    result.cases.map(item => item.evidence).join(' | '),
  ].filter(Boolean).join('; '));
  return Object.freeze({
    id: 'endpoint-' + result.endpointId.replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''),
    category: 'api' as const,
    name: result.method + ' ' + result.path,
    passed,
    severity: (passed ? 'LOW' : 'HIGH') as 'LOW' | 'HIGH',
    evidence,
    acceptanceCriterion: result.method + ' ' + result.path + ' must be verified individually',
    // R1.7: the endpoint verifier resolved this mapping; downstream code must
    // not re-derive it from names.
    todoId: result.failedTodoId,
    scope: result.failedTodoId ? ('TODO_SPECIFIC' as const) : ('WHOLE_RUN' as const),
    required: true,
    expected: result.expected,
    actual: result.actual,
    evidenceRefs: result.evidenceRefs,
    source: 'endpoint-verification',
  });
}

function formatCoverage(report: BackendVerificationReport): string {
  const coverage = report.coverage;
  const skipped = coverage.skippedReasons
    .map(item => `${item.endpointId}: ${item.reason}`)
    .join(' | ') || 'none';
  return [
    `Discovered: ${coverage.discovered}`,
    `Tested: ${coverage.tested}`,
    `Passed: ${coverage.passed}`,
    `Failed: ${coverage.failed}`,
    `Blocked: ${coverage.blocked}`,
    `Skipped: ${coverage.skipped}`,
    `Not tested: ${coverage.notTested}`,
    `reasons: ${skipped}`,
  ].join('; ');
}
