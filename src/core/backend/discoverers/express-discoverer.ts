import { promises as fs } from 'fs';
import * as path from 'path';
import { EndpointDiscoverer, EndpointDiscoveryInput } from '../../../contracts/endpoint-discoverer';
import {
  BackendEndpoint,
  endpointIdentity,
  freezeBackendEndpoint,
  HttpMethod,
  isHttpMethod,
  normalizeEndpointPath,
} from '../../../domain/backend-endpoint';
import { boundedWalk } from '../bounded-walk';

const ROUTE_RE = /\b(?:app|router|fastify|server|this\.app|this\.router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

export class ExpressDiscoverer implements EndpointDiscoverer {
  readonly id = 'express-fastify';

  async discover(input: EndpointDiscoveryInput): Promise<ReadonlyArray<BackendEndpoint>> {
    const frameworks = input.frameworks ?? [];
    if (!frameworks.includes('express') && !frameworks.includes('fastify')) {
      return [];
    }
    const files = await boundedWalk({
      root: path.join(input.workspacePath, 'src'),
      limits: input.limits,
      extensions: ['.ts', '.js'],
    });
    const extra = await boundedWalk({
      root: input.workspacePath,
      limits: input.limits,
      extensions: ['.ts', '.js'],
    });
    const unique = [...new Set([...files, ...extra])];
    const endpoints: BackendEndpoint[] = [];
    for (const file of unique) {
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const relative = path.relative(input.workspacePath, file).replace(/\\/g, '/');
      endpoints.push(...parseExpressRoutes(relative, content, frameworks.includes('fastify') ? 'FASTIFY_ROUTE' : 'EXPRESS_ROUTE'));
    }
    return endpoints;
  }
}

export function parseExpressRoutes(
  source: string,
  content: string,
  discoverySource: 'EXPRESS_ROUTE' | 'FASTIFY_ROUTE',
): BackendEndpoint[] {
  const endpoints: BackendEndpoint[] = [];
  for (const match of content.matchAll(ROUTE_RE)) {
    const method = match[1].toUpperCase();
    if (!isHttpMethod(method)) continue;
    const routePath = normalizeEndpointPath(match[2]);
    const window = content.slice(Math.max(0, (match.index ?? 0) - 200), (match.index ?? 0) + 240);
    const adminRequired = /admin/i.test(routePath) || /requireAdmin|isAdmin|role\s*===?\s*['"]admin['"]/i.test(window);
    const authenticated = adminRequired
      || /auth|jwt|bearer|requireUser|isAuthenticated/i.test(window);
    endpoints.push(freezeBackendEndpoint({
      id: endpointIdentity(method, routePath),
      method: method as HttpMethod,
      path: routePath,
      source,
      discoverySource,
      authRequirement: adminRequired ? 'ADMIN' : (authenticated ? 'AUTHENTICATED' : 'NONE'),
      adminRequired,
      hasJsonBody: method === 'POST' || method === 'PUT' || method === 'PATCH',
    }));
  }
  return endpoints;
}
