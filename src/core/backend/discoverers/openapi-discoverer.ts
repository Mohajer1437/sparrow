import { promises as fs } from 'fs';
import * as path from 'path';
import { EndpointDiscoverer, EndpointDiscoveryInput } from '../../../contracts/endpoint-discoverer';
import {
  AuthRequirement,
  BackendEndpoint,
  endpointIdentity,
  freezeBackendEndpoint,
  HttpMethod,
  isHttpMethod,
  normalizeEndpointPath,
} from '../../../domain/backend-endpoint';

const CANDIDATES = [
  'openapi.json',
  'swagger.json',
  'public/openapi.json',
  'docs/openapi.json',
  'src/openapi.json',
];

export class OpenApiDiscoverer implements EndpointDiscoverer {
  readonly id = 'openapi';

  async discover(input: EndpointDiscoveryInput): Promise<ReadonlyArray<BackendEndpoint>> {
    for (const rel of CANDIDATES) {
      const full = path.join(input.workspacePath, rel);
      try {
        const json = JSON.parse(await fs.readFile(full, 'utf8'));
        return parseOpenApi(json, rel);
      } catch {
        // next candidate
      }
    }
    return [];
  }
}

function parseOpenApi(json: Record<string, any>, source: string): BackendEndpoint[] {
  const paths = json.paths || {};
  const endpoints: BackendEndpoint[] = [];
  for (const [rawPath, spec] of Object.entries(paths as Record<string, any>)) {
    if (!spec || typeof spec !== 'object') continue;
    for (const [methodKey, operation] of Object.entries(spec as Record<string, any>)) {
      const method = methodKey.toUpperCase();
      if (!isHttpMethod(method) || method === 'HEAD' || method === 'OPTIONS') continue;
      const pathName = normalizeEndpointPath(rawPath);
      const security = JSON.stringify(operation?.security ?? spec.security ?? json.security ?? '');
      const adminRequired = /admin/i.test(pathName) || /admin/i.test(security) || /admin/i.test(JSON.stringify(operation?.tags ?? []));
      const authRequirement = deriveAuth(security, adminRequired);
      const fields = extractJsonFields(operation);
      endpoints.push(freezeBackendEndpoint({
        id: endpointIdentity(method, pathName),
        method: method as HttpMethod,
        path: pathName,
        source,
        discoverySource: 'OPENAPI',
        domain: Array.isArray(operation?.tags) ? String(operation.tags[0] || '') : undefined,
        authRequirement,
        adminRequired,
        requestSchema: fields.length > 0 ? { fields, contentType: 'application/json' } : undefined,
        hasJsonBody: method === 'POST' || method === 'PUT' || method === 'PATCH',
      }));
    }
  }
  return endpoints;
}

function deriveAuth(security: string, adminRequired: boolean): AuthRequirement {
  if (adminRequired) return 'ADMIN';
  if (security && security !== '""' && security !== 'null' && security !== '[]') return 'AUTHENTICATED';
  return 'UNKNOWN';
}

function extractJsonFields(operation: any): string[] {
  const schema = operation?.requestBody?.content?.['application/json']?.schema
    || operation?.requestBody?.content?.['application/json']
    || {};
  const properties = schema.properties || schema.schema?.properties || {};
  return Object.keys(properties).filter(key => typeof key === 'string').slice(0, 16);
}
