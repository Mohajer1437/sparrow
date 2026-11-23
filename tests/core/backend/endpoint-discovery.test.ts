import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EndpointDiscoveryService, mergeEndpoints } from '../../../src/core/backend/endpoint-discovery';
import { parseNestController } from '../../../src/core/backend/discoverers/nestjs-discoverer';
import { parseExpressRoutes } from '../../../src/core/backend/discoverers/express-discoverer';
import { endpointIdentity, normalizeEndpointPath } from '../../../src/domain/backend-endpoint';
import { DEFAULT_BACKEND_VERIFICATION_LIMITS } from '../../../src/domain/backend-verification-limits';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-ep-'));
}

describe('endpoint identity', () => {
  it('is deterministic across repeated discovery', () => {
    expect(endpointIdentity('post', '/api/users/')).toBe('POST /api/users');
    expect(endpointIdentity('POST', 'api/users')).toBe('POST /api/users');
    expect(endpointIdentity('get', '/api/users/{id}')).toBe(endpointIdentity('GET', '/api/users/:id'));
    expect(endpointIdentity('GET', '/api/users/[id]')).toBe('GET /api/users/:id');
  });

  it('normalizes methods and paths', () => {
    expect(normalizeEndpointPath('\\api\\users\\')).toBe('/api/users');
    expect(normalizeEndpointPath('/api/users?x=1')).toBe('/api/users');
  });
});

describe('endpoint discovery', () => {
  const limits = DEFAULT_BACKEND_VERIFICATION_LIMITS;
  const discovery = new EndpointDiscoveryService();

  afterEach(() => {
    // temp dirs are unique; leave OS to clean
  });

  it('discovers NestJS controller routes with auth and admin metadata', async () => {
    const dir = workspace();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'api',
      dependencies: { '@nestjs/core': '10.0.0' },
    }));
    const moduleDir = path.join(dir, 'src', 'users');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'users.controller.ts'), `
import { Controller, Get, Post, Patch, Delete, UseGuards } from '@nestjs/common';
@Controller('api/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get() findAll() {}
  @Post() create() {}
  @Get(':id') findOne() {}
  @Patch(':id') update() {}
  @Delete(':id') remove() {}
}
`);
    const adminDir = path.join(dir, 'src', 'admin');
    fs.mkdirSync(adminDir, { recursive: true });
    fs.writeFileSync(path.join(adminDir, 'users.controller.ts'), `
@Controller('api/admin/users')
@Roles('admin')
export class AdminUsersController {
  @Post() create() {}
  @Get() list() {}
}
`);
    const endpoints = await discovery.discover({ workspacePath: dir, limits });
    const ids = endpoints.map(item => item.id);
    expect(ids).toEqual(expect.arrayContaining([
      'GET /api/users',
      'POST /api/users',
      'GET /api/users/:id',
      'PATCH /api/users/:id',
      'DELETE /api/users/:id',
      'POST /api/admin/users',
      'GET /api/admin/users',
    ]));
    const admin = endpoints.find(item => item.id === 'POST /api/admin/users');
    expect(admin?.adminRequired).toBe(true);
    expect(admin?.authRequirement).toBe('ADMIN');
    const list = endpoints.find(item => item.id === 'GET /api/users');
    expect(list?.authRequirement).toBe('AUTHENTICATED');
    expect(list?.discoverySource).toBe('NESTJS_DECORATOR');
  });

  it('discovers OpenAPI paths and does not invent extra routes', async () => {
    const dir = workspace();
    fs.writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify({
      paths: {
        '/api/users': {
          get: { tags: ['users'] },
          post: { security: [{ bearer: [] }], requestBody: { content: { 'application/json': { schema: { properties: { email: {} } } } } } },
        },
      },
    }));
    const endpoints = await discovery.discover({ workspacePath: dir, limits });
    expect(endpoints.map(item => item.id).sort()).toEqual(['GET /api/users', 'POST /api/users']);
    expect(endpoints.find(item => item.id === 'POST /api/users')?.requestSchema?.fields).toContain('email');
  });

  it('merges duplicates to a single deterministic id', () => {
    const parsed = parseNestController('src/users.controller.ts', `
@Controller('api/users')
export class UsersController { @Get() findAll() {} }
`);
    const merged = mergeEndpoints([
      ...parsed,
      ...parsed,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('GET /api/users');
  });

  it('parses express routes from source and skips unknown files without routes', () => {
    const routes = parseExpressRoutes('src/app.ts', `
app.get('/health', handler);
router.post('/api/items', auth, handler);
`, 'EXPRESS_ROUTE');
    expect(routes.map(item => item.id)).toEqual(['GET /health', 'POST /api/items']);
    expect(parseExpressRoutes('src/util.ts', 'export const name = "users";', 'EXPRESS_ROUTE')).toEqual([]);
  });

  it('does not invent endpoints from a controller filename', () => {
    const empty = parseNestController('src/billing.controller.ts', 'export class BillingController {}');
    expect(empty).toEqual([]);
  });
});
