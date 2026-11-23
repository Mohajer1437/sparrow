import { ReadOnlyDatabase } from '../../contracts/read-only-database';
import { Skill } from '../../domain/skill';
import { TodoPlan } from '../../domain/todo-plan';
import { QualityProfile } from '../../domain/quality-profile';
import { BackendEndpoint } from '../../domain/backend-endpoint';
import {
  BackendVerificationLimits,
  resolveBackendVerificationLimits,
} from '../../domain/backend-verification-limits';
import {
  BackendVerificationReport,
  EndpointCaseResult,
  EndpointFailureType,
  EndpointVerificationResult,
  EndpointVerificationStatus,
  PersistenceAssertion,
  overallEndpointStatus,
  summarizeCoverage,
} from '../../domain/endpoint-verification';
import {
  TestCredentialRequest,
  freezeTestCredentialRequest,
} from '../../domain/test-credential';
import { redactText } from '../security/secret-redaction';
import { generateEndpointCases, PlannedEndpointCase } from './case-generator';
import { EndpointDiscoveryService } from './endpoint-discovery';
import { classifyBaseUrl, isSafeTestBaseUrl } from './environment';
import { looksLikeUnhandledException, probeHttp, redactHeaders, summarizeBody } from './http-probe';
import { ReadOnlyDatabaseVerifier } from './read-only-database';
import { RuntimeSecretHolder } from './runtime-secrets';
import { mapEndpointToTodo } from './todo-endpoint-mapping';

export interface BackendVerifierInput {
  readonly workspacePath: string;
  readonly profile: QualityProfile;
  readonly task?: string;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly todoPlan?: TodoPlan;
  readonly skills?: ReadonlyArray<Skill>;
  readonly baseUrl?: string;
  readonly persistenceAssertions?: ReadonlyArray<{
    readonly endpointId: string;
    readonly assertion: PersistenceAssertion;
  }>;
  readonly referencedEndpoints?: ReadonlyArray<{ readonly method: string; readonly path: string }>;
  readonly limits?: Partial<BackendVerificationLimits>;
}

export class BackendVerificationEngine {
  private readonly discovery: EndpointDiscoveryService;
  private readonly database: ReadOnlyDatabaseVerifier;

  constructor(
    private readonly secrets: RuntimeSecretHolder = new RuntimeSecretHolder(),
    database?: ReadOnlyDatabase,
    discovery?: EndpointDiscoveryService,
  ) {
    this.discovery = discovery ?? new EndpointDiscoveryService();
    this.database = new ReadOnlyDatabaseVerifier(database);
  }

  async verify(input: BackendVerifierInput): Promise<BackendVerificationReport> {
    const limits = resolveBackendVerificationLimits(input.limits);
    const skills = input.skills ?? [];
    const hints = skills.flatMap(skill => skill.verificationRules.backendVerification?.discoveryHints ?? []);
    const frameworks = skills.flatMap(skill => skill.applicability.frameworks ?? []);
    const discovered = await this.discovery.discover({
      workspacePath: input.workspacePath,
      limits,
      frameworks,
      discoveryHints: hints,
    });
    const referencedMissing = missingReferenced(discovered, input.referencedEndpoints ?? [], input.task);
    const scoped = scopeEndpoints(discovered, input);
    const results: EndpointVerificationResult[] = [];
    let credentialRequest: TestCredentialRequest | undefined;
    let testedCount = 0;

    for (const endpoint of discovered) {
      const inScope = scoped.has(endpoint.id);
      if (!inScope) {
        results.push(skipped(endpoint, 'out of task/file scope', input.todoPlan));
        continue;
      }
      if (testedCount >= limits.maxEndpointsPerRun) {
        results.push(blocked(endpoint, 'LIMIT_REACHED', 'maxEndpointsPerRun reached', input.todoPlan));
        continue;
      }
      const outcome = await this.verifyEndpoint(endpoint, input, limits, skills);
      if (outcome.credentialRequest && !credentialRequest) {
        credentialRequest = outcome.credentialRequest;
      }
      results.push(outcome.result);
      if (outcome.result.status === 'PASS' || outcome.result.status === 'FAIL') testedCount += 1;
    }

    for (const missing of referencedMissing) {
      results.push(Object.freeze({
        endpointId: missing,
        method: missing.split(' ')[0] as BackendEndpoint['method'],
        path: missing.slice(missing.indexOf(' ') + 1),
        status: 'NOT_TESTED',
        requestSummary: 'NOT_FOUND',
        responseSummary: '',
        expected: 'grounded endpoint',
        actual: 'not discovered',
        authResult: 'NOT_APPLICABLE',
        unhandledError: false,
        evidenceRefs: Object.freeze([missing]),
        failureType: 'NOT_FOUND',
        skipReason: 'referenced by task but not found in project evidence',
        cases: Object.freeze([]),
        authRequirement: 'UNKNOWN',
        adminRequired: false,
        timestamp: new Date().toISOString(),
      }));
    }

    return Object.freeze({
      endpoints: discovered,
      results: Object.freeze(results),
      coverage: summarizeCoverage(results),
      credentialRequest: credentialRequest
        ? {
            kind: 'REQUIRES_TEST_CREDENTIAL' as const,
            environment: credentialRequest.environment,
            scope: credentialRequest.scope,
            endpoints: credentialRequest.endpoints.map(item => `${item.method} ${item.path}`),
            requiredCredential: credentialRequest.requiredCredential,
          }
        : undefined,
    });
  }

  private async verifyEndpoint(
    endpoint: BackendEndpoint,
    input: BackendVerifierInput,
    limits: BackendVerificationLimits,
    skills: ReadonlyArray<Skill>,
  ): Promise<{ result: EndpointVerificationResult; credentialRequest?: TestCredentialRequest }> {
    const baseUrl = input.baseUrl || process.env.AGENT_VV_BASE_URL || 'http://127.0.0.1:3000';
    const todoId = mapEndpointToTodo(endpoint, input.todoPlan);

    if (endpoint.adminRequired) {
      const env = classifyBaseUrl(baseUrl);
      if (env !== 'test' || !isSafeTestBaseUrl(baseUrl)) {
        return {
          result: blocked(
            endpoint,
            'UNSAFE_ENVIRONMENT',
            'admin endpoints are only tested against an explicit local test environment',
            input.todoPlan,
          ),
        };
      }
      if (!this.secrets.get().adminAccessToken) {
        const request = freezeTestCredentialRequest({
          kind: 'REQUIRES_TEST_CREDENTIAL',
          environment: 'test',
          scope: 'admin API',
          endpoints: [{ method: endpoint.method, path: endpoint.path }],
          requiredCredential: 'admin_access_token',
          reason: 'Admin endpoint detected; provide a test-environment admin token. Do not use a production credential.',
        });
        return {
          credentialRequest: request,
          result: blocked(
            endpoint,
            'REQUIRES_TEST_CREDENTIAL',
            request.reason,
            input.todoPlan,
          ),
        };
      }
    }

    const planned = generateEndpointCases(endpoint, skills, input.todoPlan).slice(0, limits.maxRequestsPerEndpoint);
    const cases: EndpointCaseResult[] = [];
    for (const plannedCase of planned) {
      cases.push(await this.runCase(baseUrl, endpoint, plannedCase, limits));
    }

    let persistence = undefined;
    const assertion = (input.persistenceAssertions ?? []).find(item => item.endpointId === endpoint.id);
    if (assertion && (endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH')) {
      persistence = await this.database.verify({
        assertion: assertion.assertion,
        timeoutMs: limits.databaseTimeoutMs,
        maxRows: limits.maxDatabaseRowsChecked,
      });
    }

    const status = overallEndpointStatus(cases, persistence);
    const failedCase = cases.find(item => item.status === 'FAIL');
    const unhandledError = cases.some(item => item.failureType === 'UNHANDLED_EXCEPTION');
    return {
      result: Object.freeze({
        endpointId: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        status,
        requestSummary: redactText(planned.map(item => item.kind).join(', ')),
        responseSummary: redactText(cases.map(item => `${item.kind}=${item.actualStatus ?? item.status}`).join(', ')),
        expected: cases.map(item => `${item.kind}:${item.expectedStatuses.join('|')}`).join(', '),
        actual: cases.map(item => `${item.kind}:${item.actualStatus ?? item.status}`).join(', '),
        authResult: authRollup(cases),
        persistenceResult: persistence,
        unhandledError,
        evidenceRefs: Object.freeze(cases.map(item => `${endpoint.id}:${item.kind}`)),
        failureType: failedCase?.failureType
          || (persistence?.status === 'FAIL' ? 'PERSISTENCE_MISMATCH' : undefined),
        failedTodoId: todoId,
        skipReason: status === 'SKIPPED_WITH_REASON' ? 'all cases skipped' : undefined,
        cases: Object.freeze(cases),
        authRequirement: endpoint.authRequirement,
        adminRequired: endpoint.adminRequired,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  private async runCase(
    baseUrl: string,
    endpoint: BackendEndpoint,
    planned: PlannedEndpointCase,
    limits: BackendVerificationLimits,
  ): Promise<EndpointCaseResult> {
    const headers = materializeHeaders(planned.headers, this.secrets);
    const url = joinUrl(baseUrl, substitutePath(planned.path));
    const probe = await probeHttp({
      url,
      method: planned.method,
      body: planned.body,
      headers,
      timeoutMs: limits.requestTimeoutMs,
      maxResponseBytes: limits.maxResponseBytes,
    });
    const unhandled = looksLikeUnhandledException(probe);
    let failureType: EndpointFailureType | undefined;
    let status: EndpointVerificationStatus = 'PASS';
    if (probe.timedOut) {
      status = 'FAIL';
      failureType = 'TIMEOUT';
    } else if (probe.connectionError && probe.status === 0) {
      status = 'BLOCKED';
      failureType = 'CONNECTION_FAILURE';
    } else if (unhandled && !planned.expectedStatuses.includes(probe.status)) {
      status = 'FAIL';
      failureType = 'UNHANDLED_EXCEPTION';
    } else if (probe.status > 0 && !casePassed(planned, probe.status, unhandled)) {
      status = 'FAIL';
      failureType = planned.kind.startsWith('auth') ? 'AUTH_DEFECT' : 'UNEXPECTED_STATUS';
    }
    return Object.freeze({
      kind: planned.kind,
      status,
      expectedStatuses: planned.expectedStatuses,
      actualStatus: probe.status || undefined,
      failureType,
      evidence: formatCaseEvidence(endpoint, planned, probe, failureType),
    });
  }
}

function casePassed(planned: PlannedEndpointCase, status: number, unhandled: boolean): boolean {
  if (unhandled && status >= 500) return false;
  return planned.expectedStatuses.includes(status);
}

function materializeHeaders(
  headers: Readonly<Record<string, string>>,
  secrets: RuntimeSecretHolder,
): Record<string, string> {
  const values = secrets.get();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = value
      .replace('${VALID}', values.adminAccessToken || values.userAccessToken || 'missing-test-token')
      .replace('${USER}', values.userAccessToken || 'missing-user-token')
      .replace('${INVALID}', 'invalid-test-token');
  }
  return out;
}

function substitutePath(pathName: string): string {
  return pathName.replace(/:[\w]+/g, '1');
}

function joinUrl(baseUrl: string, pathName: string): string {
  return baseUrl.replace(/\/$/, '') + (pathName.startsWith('/') ? pathName : '/' + pathName);
}

function formatCaseEvidence(
  endpoint: BackendEndpoint,
  planned: PlannedEndpointCase,
  probe: { status: number; body: string; contentType: string; timedOut: boolean; connectionError?: string },
  failureType?: EndpointFailureType,
): string {
  return [
    `endpointId: ${endpoint.id}`,
    `method: ${endpoint.method}`,
    `path: ${endpoint.path}`,
    `scenario: ${planned.kind}`,
    `expectedStatus: ${planned.expectedStatuses.join('|')}`,
    `actualStatus: ${probe.status}`,
    `failureType: ${failureType || (probe.status >= 500 ? 'UNHANDLED_EXCEPTION' : 'none')}`,
    `authHeader: [REDACTED]`,
    `contentType: ${probe.contentType || 'unknown'}`,
    `response: ${summarizeBody(probe.body)}`,
    probe.timedOut ? 'timeout: true' : undefined,
    probe.connectionError ? `connection: ${redactText(probe.connectionError)}` : undefined,
    `headers: ${JSON.stringify(redactHeaders(planned.headers))}`,
    `source: ${endpoint.source}`,
  ].filter(Boolean).join('; ');
}

function skipped(
  endpoint: BackendEndpoint,
  reason: string,
  plan?: TodoPlan,
): EndpointVerificationResult {
  return Object.freeze({
    endpointId: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    status: 'SKIPPED_WITH_REASON',
    requestSummary: 'skipped',
    responseSummary: '',
    expected: 'n/a',
    actual: 'skipped',
    authResult: 'NOT_APPLICABLE',
    unhandledError: false,
    evidenceRefs: Object.freeze([endpoint.id]),
    skipReason: reason,
    cases: Object.freeze([]),
    authRequirement: endpoint.authRequirement,
    adminRequired: endpoint.adminRequired,
    failedTodoId: mapEndpointToTodo(endpoint, plan),
    timestamp: new Date().toISOString(),
  });
}

function blocked(
  endpoint: BackendEndpoint,
  failureType: EndpointFailureType,
  reason: string,
  plan?: TodoPlan,
): EndpointVerificationResult {
  return Object.freeze({
    endpointId: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    status: 'BLOCKED',
    requestSummary: 'blocked',
    responseSummary: '',
    expected: 'testable endpoint',
    actual: reason,
    authResult: failureType === 'REQUIRES_TEST_CREDENTIAL' ? 'BLOCKED' : 'NOT_APPLICABLE',
    unhandledError: false,
    evidenceRefs: Object.freeze([endpoint.id]),
    failureType,
    skipReason: reason,
    cases: Object.freeze([]),
    authRequirement: endpoint.authRequirement,
    adminRequired: endpoint.adminRequired,
    failedTodoId: mapEndpointToTodo(endpoint, plan),
    timestamp: new Date().toISOString(),
  });
}

function authRollup(
  cases: ReadonlyArray<EndpointCaseResult>,
): EndpointVerificationStatus | 'NOT_APPLICABLE' {
  const authCases = cases.filter(item => item.kind.startsWith('auth'));
  if (authCases.length === 0) return 'NOT_APPLICABLE';
  if (authCases.some(item => item.status === 'FAIL')) return 'FAIL';
  if (authCases.some(item => item.status === 'BLOCKED')) return 'BLOCKED';
  if (authCases.every(item => item.status === 'PASS')) return 'PASS';
  return 'NOT_TESTED';
}

function scopeEndpoints(
  endpoints: ReadonlyArray<BackendEndpoint>,
  input: BackendVerifierInput,
): Set<string> {
  const text = [input.task, ...(input.acceptanceCriteria ?? [])].filter(Boolean).join(' ').toLowerCase();
  const files = (input.changedFiles ?? []).map(file => file.replace(/\\/g, '/').toLowerCase());
  const mentioned = endpoints.filter(endpoint =>
    text.includes(endpoint.path.toLowerCase())
    || text.includes(endpoint.id.toLowerCase())
    || files.some(file => endpoint.source.replace(/\\/g, '/').toLowerCase().includes(file) || file.includes(endpoint.source.replace(/\\/g, '/').toLowerCase())),
  );
  if (mentioned.length > 0) return new Set(mentioned.map(item => item.id));
  return new Set(endpoints.map(item => item.id));
}

function missingReferenced(
  discovered: ReadonlyArray<BackendEndpoint>,
  referenced: ReadonlyArray<{ method: string; path: string }>,
  task?: string,
): string[] {
  const known = new Set(discovered.map(item => item.id));
  const wanted: string[] = referenced.map(item => `${item.method.toUpperCase()} ${item.path}`);
  const fromTask = [...(task || '').matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_:-]*)/g)]
    .map(match => `${match[1]} ${match[2]}`);
  const missing: string[] = [];
  for (const id of [...wanted, ...fromTask]) {
    if (!known.has(id) && !missing.includes(id)) missing.push(id);
  }
  return missing;
}
