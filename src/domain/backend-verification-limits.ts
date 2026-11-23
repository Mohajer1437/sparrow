export interface BackendVerificationLimits {
  readonly maxEndpointsPerRun: number;
  readonly maxRequestsPerEndpoint: number;
  readonly maxResponseBytes: number;
  readonly maxDatabaseRowsChecked: number;
  readonly requestTimeoutMs: number;
  readonly databaseTimeoutMs: number;
  readonly maxDiscoveryFiles: number;
}

export const DEFAULT_BACKEND_VERIFICATION_LIMITS: BackendVerificationLimits = Object.freeze({
  maxEndpointsPerRun: 32,
  maxRequestsPerEndpoint: 8,
  maxResponseBytes: 65536,
  maxDatabaseRowsChecked: 50,
  requestTimeoutMs: 4000,
  databaseTimeoutMs: 3000,
  maxDiscoveryFiles: 64,
});

export function resolveBackendVerificationLimits(
  overrides?: Partial<BackendVerificationLimits>,
): BackendVerificationLimits {
  return Object.freeze({
    ...DEFAULT_BACKEND_VERIFICATION_LIMITS,
    ...overrides,
  });
}
