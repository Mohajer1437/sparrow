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
import { boundedWalk } from '../bounded-walk';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const CONTROLLER_RE = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|{\s*path\s*:\s*'([^']*)'|{\s*path\s*:\s*"([^"]*)")?/g;
const METHOD_RE = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/gi;
const ROLES_RE = /@Roles\(([^)]*)\)/;
const GUARDS_RE = /@UseGuards\(([^)]*)\)/;

export class NestJsDiscoverer implements EndpointDiscoverer {
  readonly id = 'nestjs';

  async discover(input: EndpointDiscoveryInput): Promise<ReadonlyArray<BackendEndpoint>> {
    const frameworks = input.frameworks ?? [];
    if (!frameworks.includes('nestjs') && !(input.discoveryHints ?? []).some(hint => /@Controller/i.test(hint))) {
      return [];
    }
    const roots = [path.join(input.workspacePath, 'src'), input.workspacePath];
    const files: string[] = [];
    for (const root of roots) {
      const found = await boundedWalk({
        root,
        limits: input.limits,
        extensions: ['.ts', '.js'],
        fileNameHint: /\.controller\.(ts|js)$/i,
      });
      for (const file of found) {
        if (!files.includes(file)) files.push(file);
      }
      if (files.length >= input.limits.maxDiscoveryFiles) break;
    }
    const endpoints: BackendEndpoint[] = [];
    for (const file of files) {
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const relative = path.relative(input.workspacePath, file).replace(/\\/g, '/');
      endpoints.push(...parseNestController(relative, content));
    }
    return endpoints;
  }
}

export function parseNestController(source: string, content: string): BackendEndpoint[] {
  const controllerMatch = [...content.matchAll(CONTROLLER_RE)][0];
  const controllerPath = normalizeEndpointPath(
    controllerMatch?.[1] || controllerMatch?.[2] || controllerMatch?.[3] || controllerMatch?.[4] || '/',
  );
  const classAdmin = /admin/i.test(controllerPath)
    || ROLES_RE.test(content) && /admin/i.test(content.match(ROLES_RE)?.[1] || '')
    || /AdminGuard|RolesGuard/.test(content.match(GUARDS_RE)?.[1] || '');
  const endpoints: BackendEndpoint[] = [];
  for (const match of content.matchAll(METHOD_RE)) {
    const method = match[1].toUpperCase() as HttpMethod;
    if (!HTTP_METHODS.includes(method)) continue;
    const methodPath = match[2] || match[3] || '';
    const joined = joinPaths(controllerPath, methodPath);
    const window = surrounding(content, match.index ?? 0);
    const adminRequired = classAdmin
      || /admin/i.test(joined)
      || /admin/i.test(window.match(ROLES_RE)?.[1] || '')
      || /AdminGuard/.test(window);
    const authenticated = adminRequired
      || /JwtAuthGuard|AuthGuard|@UseGuards/.test(window)
      || /JwtAuthGuard|AuthGuard/.test(content);
    endpoints.push(freezeBackendEndpoint({
      id: endpointIdentity(method, joined),
      method,
      path: joined,
      source,
      discoverySource: 'NESTJS_DECORATOR',
      domain: inferDomain(source, controllerPath),
      authRequirement: adminRequired ? 'ADMIN' : (authenticated ? 'AUTHENTICATED' : 'NONE'),
      adminRequired,
      hasJsonBody: method === 'POST' || method === 'PUT' || method === 'PATCH',
      requestSchema: bodyFields(window),
    }));
  }
  return endpoints;
}

function joinPaths(base: string, leaf: string): string {
  const left = normalizeEndpointPath(base || '/');
  const right = String(leaf || '').replace(/^\//, '');
  if (!right) return left;
  return normalizeEndpointPath(left === '/' ? '/' + right : left + '/' + right);
}

function surrounding(content: string, index: number): string {
  return content.slice(Math.max(0, index - 400), Math.min(content.length, index + 400));
}

function inferDomain(source: string, controllerPath: string): string | undefined {
  const fromPath = controllerPath.replace(/^\//, '').split('/')[0];
  if (fromPath && fromPath !== ':id') return fromPath;
  const file = source.replace(/\\/g, '/').split('/').pop() || '';
  const name = file.replace(/\.controller\.(ts|js)$/i, '');
  return name || undefined;
}

function bodyFields(window: string): { fields: ReadonlyArray<string>; contentType: string } | undefined {
  const dto = window.match(/@Body\(\)\s+\w+\s*:\s*([A-Za-z_][\w]*)/);
  if (!dto) return undefined;
  return { fields: Object.freeze([dto[1]]), contentType: 'application/json' };
}
