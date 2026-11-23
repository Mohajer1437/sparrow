import { AuthRequirement, BackendEndpoint, HttpMethod } from './backend-endpoint';

export const ENDPOINT_VERIFICATION_STATUSES = [
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_TESTED',
  'SKIPPED_WITH_REASON',
] as const;
export type EndpointVerificationStatus = (typeof ENDPOINT_VERIFICATION_STATUSES)[number];

export const ENDPOINT_CASE_KINDS = [
  'positive',
  'auth-none',
  'auth-invalid',
  'auth-valid',
  'authz-insufficient',
  'validation-negative',
  'boundary',
  'error-handling',
] as const;
export type EndpointCaseKind = (typeof ENDPOINT_CASE_KINDS)[number];

export const ENDPOINT_FAILURE_TYPES = [
  'UNEXPECTED_STATUS',
  'UNHANDLED_EXCEPTION',
  'MALFORMED_RESPONSE',
  'AUTH_DEFECT',
  'AUTHORIZATION_DEFECT',
  'VALIDATION_DEFECT',
  'PERSISTENCE_MISMATCH',
  'TIMEOUT',
  'CONNECTION_FAILURE',
  'REQUIRES_TEST_CREDENTIAL',
  'UNSAFE_ENVIRONMENT',
  'LIMIT_REACHED',
  'NOT_FOUND',
] as const;
export type EndpointFailureType = (typeof ENDPOINT_FAILURE_TYPES)[number];

export interface EndpointCaseResult {
  readonly kind: EndpointCaseKind;
  readonly status: EndpointVerificationStatus;
  readonly expectedStatuses: ReadonlyArray<number>;
  readonly actualStatus?: number;
  readonly failureType?: EndpointFailureType;
  readonly evidence: string;
}

export interface PersistenceAssertion {
  readonly table: string;
  readonly expectedFields: Readonly<Record<string, unknown>>;
  readonly keyField?: string;
  readonly keyValue?: string;
}

export interface PersistenceResult {
  readonly status: EndpointVerificationStatus;
  readonly queried: boolean;
  readonly reason?: string;
  readonly evidence: string;
}

export interface EndpointVerificationResult {
  readonly endpointId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: EndpointVerificationStatus;
  readonly requestSummary: string;
  readonly responseSummary: string;
  readonly expected: string;
  readonly actual: string;
  readonly authResult: EndpointVerificationStatus | 'NOT_APPLICABLE';
  readonly persistenceResult?: PersistenceResult;
  readonly unhandledError: boolean;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly failureType?: EndpointFailureType;
  readonly failedTodoId?: string;
  readonly skipReason?: string;
  readonly cases: ReadonlyArray<EndpointCaseResult>;
  readonly authRequirement: AuthRequirement;
  readonly adminRequired: boolean;
  readonly timestamp: string;
}

export interface EndpointCoverageSummary {
  readonly discovered: number;
  readonly tested: number;
  readonly passed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly skipped: number;
  readonly notTested: number;
  readonly skippedReasons: ReadonlyArray<{ readonly endpointId: string; readonly reason: string }>;
}

export interface BackendVerificationReport {
  readonly endpoints: ReadonlyArray<BackendEndpoint>;
  readonly results: ReadonlyArray<EndpointVerificationResult>;
  readonly coverage: EndpointCoverageSummary;
  readonly credentialRequest?: {
    readonly kind: 'REQUIRES_TEST_CREDENTIAL';
    readonly environment: string;
    readonly scope: string;
    readonly endpoints: ReadonlyArray<string>;
    readonly requiredCredential: string;
  };
}

export function overallEndpointStatus(
  cases: ReadonlyArray<EndpointCaseResult>,
  persistence?: PersistenceResult,
): EndpointVerificationStatus {
  if (cases.some(item => item.status === 'FAIL') || persistence?.status === 'FAIL') return 'FAIL';
  if (cases.some(item => item.status === 'BLOCKED') || persistence?.status === 'BLOCKED') return 'BLOCKED';
  if (cases.length === 0) return 'NOT_TESTED';
  if (cases.every(item => item.status === 'SKIPPED_WITH_REASON')) return 'SKIPPED_WITH_REASON';
  if (cases.some(item => item.status === 'NOT_TESTED')) return 'NOT_TESTED';
  return 'PASS';
}

export function summarizeCoverage(
  results: ReadonlyArray<EndpointVerificationResult>,
): EndpointCoverageSummary {
  const skippedReasons: Array<{ endpointId: string; reason: string }> = [];
  let tested = 0;
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let notTested = 0;
  for (const result of results) {
    if (result.status === 'PASS') {
      tested += 1;
      passed += 1;
    } else if (result.status === 'FAIL') {
      tested += 1;
      failed += 1;
    } else if (result.status === 'BLOCKED') {
      blocked += 1;
    } else if (result.status === 'SKIPPED_WITH_REASON') {
      skipped += 1;
      skippedReasons.push({
        endpointId: result.endpointId,
        reason: result.skipReason || 'skipped',
      });
    } else {
      notTested += 1;
      skippedReasons.push({
        endpointId: result.endpointId,
        reason: result.skipReason || 'not tested',
      });
    }
  }
  return Object.freeze({
    discovered: results.length,
    tested,
    passed,
    failed,
    blocked,
    skipped,
    notTested,
    skippedReasons: Object.freeze(skippedReasons),
  });
}
