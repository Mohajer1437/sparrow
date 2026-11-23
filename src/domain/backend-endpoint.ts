/**
 * Deterministic HTTP endpoint inventory.
 *
 * Identities are derived from method + normalized path. Discovery must ground
 * every entry in project evidence (source patterns, OpenAPI, metadata).
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const AUTH_REQUIREMENTS = ['NONE', 'AUTHENTICATED', 'ADMIN', 'UNKNOWN'] as const;
export type AuthRequirement = (typeof AUTH_REQUIREMENTS)[number];

export const ENDPOINT_DISCOVERY_SOURCES = [
  'OPENAPI',
  'NESTJS_DECORATOR',
  'EXPRESS_ROUTE',
  'FASTIFY_ROUTE',
  'NEXT_ROUTE_MODULE',
  'TASK_SCOPE',
] as const;
export type EndpointDiscoverySource = (typeof ENDPOINT_DISCOVERY_SOURCES)[number];

export interface EndpointSchemaHint {
  readonly fields: ReadonlyArray<string>;
  readonly contentType?: string;
}

export interface BackendEndpoint {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly source: string;
  readonly discoverySource: EndpointDiscoverySource;
  readonly domain?: string;
  readonly authRequirement: AuthRequirement;
  readonly adminRequired: boolean;
  readonly requestSchema?: EndpointSchemaHint;
  readonly responseExpectation?: EndpointSchemaHint;
  readonly hasJsonBody: boolean;
}

export function isHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === 'string' && (HTTP_METHODS as ReadonlyArray<string>).includes(value);
}

export function normalizeEndpointPath(path: string): string {
  let normalized = path.replace(/\\/g, '/').split(/[?\s,#;]/)[0].trim();
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  normalized = normalized.replace(/\{([^}]+)\}/g, ':$1');
  normalized = normalized.replace(/\[([^\]]+)\]/g, ':$1');
  normalized = normalized.replace(/:([A-Za-z_][\w]*)/g, ':$1');
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

export function endpointIdentity(method: string, path: string): string {
  return `${String(method).toUpperCase()} ${normalizeEndpointPath(path)}`;
}

export function freezeBackendEndpoint(endpoint: BackendEndpoint): BackendEndpoint {
  return Object.freeze({
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    source: endpoint.source,
    discoverySource: endpoint.discoverySource,
    domain: endpoint.domain,
    authRequirement: endpoint.authRequirement,
    adminRequired: endpoint.adminRequired,
    requestSchema: endpoint.requestSchema
      ? Object.freeze({
          fields: Object.freeze([...endpoint.requestSchema.fields]),
          contentType: endpoint.requestSchema.contentType,
        })
      : undefined,
    responseExpectation: endpoint.responseExpectation
      ? Object.freeze({
          fields: Object.freeze([...endpoint.responseExpectation.fields]),
          contentType: endpoint.responseExpectation.contentType,
        })
      : undefined,
    hasJsonBody: endpoint.hasJsonBody,
  });
}
