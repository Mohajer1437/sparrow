import { BackendEndpoint } from '../../domain/backend-endpoint';
import { EndpointCaseKind } from '../../domain/endpoint-verification';
import { Skill } from '../../domain/skill';
import { TodoItem, TodoPlan } from '../../domain/todo-plan';

export interface PlannedEndpointCase {
  readonly kind: EndpointCaseKind;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly expectedStatuses: ReadonlyArray<number>;
  readonly description: string;
}

export function requiredBackendChecks(
  skills: ReadonlyArray<Skill>,
  todos?: ReadonlyArray<TodoItem>,
): ReadonlySet<string> {
  const checks = new Set<string>();
  for (const skill of skills) {
    for (const check of skill.verificationRules.requiredChecks) checks.add(check);
    for (const check of skill.verificationRules.backendVerification?.requiredChecks ?? []) {
      checks.add(check);
    }
    const rules = skill.verificationRules.backendVerification;
    if (rules?.authentication) checks.add('auth');
    if (rules?.authorization) checks.add('authorization');
    if (rules?.errorHandling) checks.add('error-handling');
    if (rules?.databaseVerification) checks.add('database-read-check');
    if (rules?.endpointDiscovery || rules?.responseAssertions) checks.add('endpoint');
  }
  for (const todo of todos ?? []) {
    for (const check of todo.verificationRequirements) checks.add(check);
  }
  return checks;
}

export function generateEndpointCases(
  endpoint: BackendEndpoint,
  skills: ReadonlyArray<Skill>,
  todos?: TodoPlan,
): ReadonlyArray<PlannedEndpointCase> {
  const checks = requiredBackendChecks(skills, todos?.todos);
  const cases: PlannedEndpointCase[] = [];
  const authKnown = endpoint.authRequirement === 'AUTHENTICATED' || endpoint.authRequirement === 'ADMIN';
  const needsAuth = (checks.has('auth') || checks.has('api') || authKnown) && authKnown;
  const needsAuthz = (checks.has('authorization') || endpoint.adminRequired) && endpoint.adminRequired;
  const needsValidation = checks.has('validation') || endpoint.hasJsonBody;
  const needsError = checks.has('error-handling') || checks.has('api') || checks.has('endpoint');

  cases.push(positive(endpoint));
  if (needsAuth) {
    cases.push(authNone(endpoint));
    cases.push(authInvalid(endpoint));
    cases.push(authValid(endpoint));
  }
  if (needsAuthz && endpoint.adminRequired) {
    cases.push(authzInsufficient(endpoint));
  }
  if (needsValidation && endpoint.hasJsonBody) {
    cases.push(validationNegative(endpoint));
  }
  if (needsError && looksDynamic(endpoint.path)) {
    cases.push(boundaryMissing(endpoint));
  }
  return Object.freeze(cases);
}

function positive(endpoint: BackendEndpoint): PlannedEndpointCase {
  const headers: Record<string, string> = {};
  if (endpoint.hasJsonBody) headers['content-type'] = 'application/json';
  if (endpoint.authRequirement !== 'NONE') headers.Authorization = 'Bearer ${VALID}';
  return {
    kind: 'positive',
    method: endpoint.method,
    path: endpoint.path,
    headers,
    body: endpoint.hasJsonBody ? happyBody(endpoint) : undefined,
    expectedStatuses: [200, 201, 204],
    description: 'Valid request with expected success',
  };
}

function authNone(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'auth-none',
    method: endpoint.method,
    path: endpoint.path,
    headers: endpoint.hasJsonBody ? { 'content-type': 'application/json' } : {},
    body: endpoint.hasJsonBody ? happyBody(endpoint) : undefined,
    expectedStatuses: [401, 403],
    description: 'Request with no token',
  };
}

function authInvalid(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'auth-invalid',
    method: endpoint.method,
    path: endpoint.path,
    headers: {
      Authorization: 'Bearer ${INVALID}',
      ...(endpoint.hasJsonBody ? { 'content-type': 'application/json' } : {}),
    },
    body: endpoint.hasJsonBody ? happyBody(endpoint) : undefined,
    expectedStatuses: [401, 403],
    description: 'Request with invalid token',
  };
}

function authValid(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'auth-valid',
    method: endpoint.method,
    path: endpoint.path,
    headers: {
      Authorization: 'Bearer ${VALID}',
      ...(endpoint.hasJsonBody ? { 'content-type': 'application/json' } : {}),
    },
    body: endpoint.hasJsonBody ? happyBody(endpoint) : undefined,
    expectedStatuses: endpoint.adminRequired ? [200, 201, 204, 403] : [200, 201, 204],
    description: 'Request with valid token',
  };
}

function authzInsufficient(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'authz-insufficient',
    method: endpoint.method,
    path: endpoint.path,
    headers: {
      Authorization: 'Bearer ${USER}',
      ...(endpoint.hasJsonBody ? { 'content-type': 'application/json' } : {}),
    },
    body: endpoint.hasJsonBody ? happyBody(endpoint) : undefined,
    expectedStatuses: [401, 403],
    description: 'Authenticated user without admin permission',
  };
}

function validationNegative(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'validation-negative',
    method: endpoint.method,
    path: endpoint.path,
    headers: {
      'content-type': 'application/json',
      ...(endpoint.authRequirement !== 'NONE' ? { Authorization: 'Bearer ${VALID}' } : {}),
    },
    body: '{"__invalid": true}',
    expectedStatuses: [400, 422],
    description: 'Invalid request body',
  };
}

function boundaryMissing(endpoint: BackendEndpoint): PlannedEndpointCase {
  return {
    kind: 'boundary',
    method: endpoint.method,
    path: endpoint.path.replace(/:[\w]+/g, 'missing-vv-id'),
    headers: endpoint.authRequirement !== 'NONE' ? { Authorization: 'Bearer ${VALID}' } : {},
    expectedStatuses: [400, 404],
    description: 'Missing resource boundary',
  };
}

function happyBody(endpoint: BackendEndpoint): string {
  const fields = endpoint.requestSchema?.fields ?? ['id'];
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    obj[field] = /id/i.test(field) ? 'vv-probe' : 'ok';
  }
  return JSON.stringify(obj);
}

function looksDynamic(route: string): boolean {
  return /:[\w]+/.test(route);
}
