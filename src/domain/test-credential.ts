/**
 * Application-level credential request. The value itself never belongs here.
 * Runtime secrets live only in RuntimeSecretHolder.
 */

export const TEST_CREDENTIAL_KINDS = [
  'admin_access_token',
  'user_access_token',
  'database',
] as const;
export type TestCredentialKind = (typeof TEST_CREDENTIAL_KINDS)[number];

export const TEST_ENVIRONMENTS = ['test', 'unknown'] as const;
export type TestEnvironmentClass = (typeof TEST_ENVIRONMENTS)[number];

export interface TestCredentialRequest {
  readonly kind: 'REQUIRES_TEST_CREDENTIAL';
  readonly environment: TestEnvironmentClass;
  readonly scope: string;
  readonly endpoints: ReadonlyArray<{ readonly method: string; readonly path: string }>;
  readonly requiredCredential: TestCredentialKind;
  readonly reason: string;
}

export function freezeTestCredentialRequest(request: TestCredentialRequest): TestCredentialRequest {
  return Object.freeze({
    kind: 'REQUIRES_TEST_CREDENTIAL',
    environment: request.environment,
    scope: request.scope,
    endpoints: Object.freeze(request.endpoints.map(item => Object.freeze({ ...item }))),
    requiredCredential: request.requiredCredential,
    reason: request.reason,
  });
}

export function formatTestCredentialRequest(request: TestCredentialRequest): string {
  return [
    'REQUIRES_TEST_CREDENTIAL',
    `environment=${request.environment}`,
    `scope=${request.scope}`,
    `credential=${request.requiredCredential}`,
    'value=[REDACTED]',
    `endpoints=${request.endpoints.map(item => `${item.method} ${item.path}`).join(', ')}`,
    `reason=${request.reason}`,
  ].join('\n');
}
