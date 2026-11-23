import { EndpointDiscoverer, EndpointDiscoveryInput } from '../../contracts/endpoint-discoverer';
import { BackendEndpoint, endpointIdentity, freezeBackendEndpoint } from '../../domain/backend-endpoint';
import { BackendVerificationLimits } from '../../domain/backend-verification-limits';
import { frameworksFromPackage, readPackageJson } from './bounded-walk';
import { ExpressDiscoverer } from './discoverers/express-discoverer';
import { NestJsDiscoverer } from './discoverers/nestjs-discoverer';
import { NextRouteDiscoverer } from './discoverers/next-route-discoverer';
import { OpenApiDiscoverer } from './discoverers/openapi-discoverer';

export class EndpointDiscoveryService {
  constructor(
    private readonly discoverers: ReadonlyArray<EndpointDiscoverer> = [
      new OpenApiDiscoverer(),
      new NestJsDiscoverer(),
      new ExpressDiscoverer(),
      new NextRouteDiscoverer(),
    ],
  ) {}

  async discover(input: {
    readonly workspacePath: string;
    readonly limits: BackendVerificationLimits;
    readonly frameworks?: ReadonlyArray<string>;
    readonly discoveryHints?: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<BackendEndpoint>> {
    const pkg = await readPackageJson(input.workspacePath);
    const frameworks = unique([
      ...(input.frameworks ?? []),
      ...frameworksFromPackage(pkg),
    ]);
    const discoveryInput: EndpointDiscoveryInput = {
      workspacePath: input.workspacePath,
      limits: input.limits,
      frameworks,
      discoveryHints: input.discoveryHints,
    };
    const collected: BackendEndpoint[] = [];
    for (const discoverer of this.discoverers) {
      collected.push(...await discoverer.discover(discoveryInput));
    }
    return mergeEndpoints(collected);
  }
}

export function mergeEndpoints(endpoints: ReadonlyArray<BackendEndpoint>): ReadonlyArray<BackendEndpoint> {
  const byId = new Map<string, BackendEndpoint>();
  for (const endpoint of endpoints) {
    const id = endpointIdentity(endpoint.method, endpoint.path);
    const next = freezeBackendEndpoint({ ...endpoint, id, path: endpoint.path });
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, next);
      continue;
    }
    byId.set(id, freezeBackendEndpoint({
      ...existing,
      source: existing.source || next.source,
      domain: existing.domain || next.domain,
      adminRequired: existing.adminRequired || next.adminRequired,
      authRequirement: strongerAuth(existing.authRequirement, next.authRequirement),
      hasJsonBody: existing.hasJsonBody || next.hasJsonBody,
      requestSchema: existing.requestSchema ?? next.requestSchema,
      responseExpectation: existing.responseExpectation ?? next.responseExpectation,
    }));
  }
  return Object.freeze([...byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

function strongerAuth(
  a: BackendEndpoint['authRequirement'],
  b: BackendEndpoint['authRequirement'],
): BackendEndpoint['authRequirement'] {
  const rank = { NONE: 0, UNKNOWN: 1, AUTHENTICATED: 2, ADMIN: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}
