import { promises as fs } from 'fs';
import * as path from 'path';
import { EndpointDiscoverer, EndpointDiscoveryInput } from '../../../contracts/endpoint-discoverer';
import {
  BackendEndpoint,
  endpointIdentity,
  freezeBackendEndpoint,
  HttpMethod,
  normalizeEndpointPath,
} from '../../../domain/backend-endpoint';
import { parseRouteModule } from '../../vv/api-scenarios';
import { sourceFileToApiRoute } from '../../vv/api-route';
import { boundedWalk } from '../bounded-walk';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export class NextRouteDiscoverer implements EndpointDiscoverer {
  readonly id = 'next-route';

  async discover(input: EndpointDiscoveryInput): Promise<ReadonlyArray<BackendEndpoint>> {
    const roots = [
      path.join(input.workspacePath, 'src', 'app', 'api'),
      path.join(input.workspacePath, 'app', 'api'),
      path.join(input.workspacePath, 'src', 'pages', 'api'),
      path.join(input.workspacePath, 'pages', 'api'),
    ];
    const files: string[] = [];
    for (const root of roots) {
      files.push(...await boundedWalk({
        root,
        limits: input.limits,
        extensions: ['.ts', '.js', '.tsx', '.jsx'],
      }));
    }
    const endpoints: BackendEndpoint[] = [];
    for (const file of files) {
      const route = sourceFileToApiRoute(file);
      if (!route) continue;
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const relative = path.relative(input.workspacePath, file).replace(/\\/g, '/');
      const parsed = parseRouteModule(relative, content, route);
      for (const method of parsed.methods) {
        if (!HTTP_METHODS.includes(method)) continue;
        const pathName = normalizeEndpointPath(parsed.route);
        endpoints.push(freezeBackendEndpoint({
          id: endpointIdentity(method, pathName),
          method,
          path: pathName,
          source: relative,
          discoverySource: 'NEXT_ROUTE_MODULE',
          authRequirement: parsed.requiresAuth ? 'AUTHENTICATED' : 'NONE',
          adminRequired: /admin/i.test(pathName),
          hasJsonBody: parsed.hasJsonBody,
          requestSchema: parsed.jsonFields.length > 0
            ? { fields: parsed.jsonFields, contentType: 'application/json' }
            : undefined,
        }));
      }
    }
    return endpoints;
  }
}
