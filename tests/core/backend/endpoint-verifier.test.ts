import * as http from 'http';
import { BackendVerificationEngine } from '../../../src/core/backend/endpoint-verifier';
import { RuntimeSecretHolder } from '../../../src/core/backend/runtime-secrets';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { InMemoryReadOnlyDatabase } from '../../../src/core/backend/in-memory-read-only-database';
import { OpenApiDiscoverer } from '../../../src/core/backend/discoverers/openapi-discoverer';
import { EndpointDiscoveryService } from '../../../src/core/backend/endpoint-discovery';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await fn('http://127.0.0.1:' + port);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function openApiWorkspace(paths: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-be-'));
  await fs.writeFile(path.join(dir, 'openapi.json'), JSON.stringify({ paths }), 'utf8');
  return dir;
}

const skills = createDefaultSkillRegistry().list().filter(skill => skill.id.startsWith('backend.'));

describe('endpoint-by-endpoint verification', () => {
  it('tests each discovered endpoint individually', async () => {
    const dir = await openApiWorkspace({
      '/api/users': { get: {}, post: {} },
      '/api/health': { get: {} },
    });
    await withServer((req, res) => {
      if (req.url === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/api/users' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
        return;
      }
      if (req.url === '/api/users' && req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{"id":"1"}');
        return;
      }
      res.writeHead(404);
      res.end();
    }, async baseUrl => {
      const engine = new BackendVerificationEngine();
      const report = await engine.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        task: 'Verify GET /api/users POST /api/users GET /api/health',
        skills,
        baseUrl,
      });
      expect(report.results.map(item => item.endpointId).sort()).toEqual([
        'GET /api/health',
        'GET /api/users',
        'POST /api/users',
      ]);
      expect(report.results.every(item => item.cases.length > 0 || item.status !== 'PASS')).toBe(true);
      expect(report.coverage.discovered).toBe(3);
      expect(report.coverage.tested).toBeGreaterThanOrEqual(3);
    });
  });

  it('classifies expected 4xx, unexpected 4xx, 5xx, timeout and malformed responses', async () => {
    const dir = await openApiWorkspace({
      '/ok': { get: {} },
      '/auth': { get: { security: [{ bearer: [] }] } },
      '/boom': { get: {} },
      '/slow': { get: {} },
      '/html-error': { get: {} },
    });
    await withServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/auth') {
        const auth = String(req.headers.authorization || '');
        if (!auth) {
          res.writeHead(401);
          res.end('{"error":"unauthenticated"}');
          return;
        }
        if (auth.includes('invalid-test-token')) {
          res.writeHead(401);
          res.end('{"error":"invalid"}');
          return;
        }
        res.writeHead(200);
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/boom') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('TypeError: Cannot read properties of undefined\n    at UsersController.findAll');
        return;
      }
      if (req.url === '/html-error') {
        res.writeHead(500, { 'content-type': 'text/html' });
        res.end('<html><body>Whitelabel Error Page stack trace</body></html>');
        return;
      }
      if (req.url === '/slow') {
        return;
      }
      res.writeHead(418);
      res.end('teapot');
    }, async baseUrl => {
      const secrets = new RuntimeSecretHolder({ userAccessToken: 'user-test-token', adminAccessToken: 'admin-test-token' });
      const engine = new BackendVerificationEngine(secrets);
      const report = await engine.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        skills,
        baseUrl,
        limits: { requestTimeoutMs: 80, maxEndpointsPerRun: 8, maxRequestsPerEndpoint: 4 },
      });
      const byId = Object.fromEntries(report.results.map(item => [item.endpointId, item]));
      expect(byId['GET /ok'].status).toBe('PASS');
      expect(byId['GET /auth'].cases.find(item => item.kind === 'auth-none')?.actualStatus).toBe(401);
      expect(byId['GET /auth'].cases.find(item => item.kind === 'auth-none')?.status).toBe('PASS');
      expect(byId['GET /boom'].unhandledError).toBe(true);
      expect(byId['GET /boom'].failureType).toBe('UNHANDLED_EXCEPTION');
      expect(byId['GET /html-error'].unhandledError).toBe(true);
      expect(byId['GET /slow'].cases.some(item => item.failureType === 'TIMEOUT')).toBe(true);
    });
  });

  it('reports LIMIT_REACHED instead of looping forever', async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 6; i += 1) paths['/n' + i] = { get: {} };
    const dir = await openApiWorkspace(paths);
    await withServer((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    }, async baseUrl => {
      const engine = new BackendVerificationEngine();
      const report = await engine.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        skills,
        baseUrl,
        limits: { maxEndpointsPerRun: 2, maxRequestsPerEndpoint: 1 },
      });
      expect(report.results.some(item => item.failureType === 'LIMIT_REACHED')).toBe(true);
      expect(report.coverage.blocked).toBeGreaterThan(0);
    });
  });
});

describe('authentication and admin credentials', () => {
  it('covers no token, invalid token and valid token', async () => {
    const dir = await openApiWorkspace({
      '/api/private': { get: { security: [{ bearer: [] }] } },
    });
    await withServer((req, res) => {
      const auth = String(req.headers.authorization || '');
      if (!auth || auth === 'Bearer missing-test-token') {
        res.writeHead(401);
        res.end('no');
        return;
      }
      if (auth.includes('invalid-test-token')) {
        res.writeHead(401);
        res.end('bad');
        return;
      }
      res.writeHead(200);
      res.end('ok');
    }, async baseUrl => {
      const secrets = new RuntimeSecretHolder({ userAccessToken: 'good-token', adminAccessToken: 'good-token' });
      const engine = new BackendVerificationEngine(secrets);
      const report = await engine.verify({ workspacePath: dir, profile: 'STANDARD', skills, baseUrl });
      const result = report.results[0];
      const kinds = result.cases.map(item => item.kind);
      expect(kinds).toEqual(expect.arrayContaining(['auth-none', 'auth-invalid', 'auth-valid']));
      expect(result.cases.filter(item => item.kind.startsWith('auth')).every(item => item.status === 'PASS')).toBe(true);
    });
  });

  it('requests a test admin token and never serializes it', async () => {
    const dir = await openApiWorkspace({
      '/api/admin/users': { post: { tags: ['admin'], security: [{ bearer: [] }] } },
    });
    const secrets = new RuntimeSecretHolder({ adminAccessToken: 'super-secret-admin-token' });
    const engine = new BackendVerificationEngine(secrets);
    const blocked = await engine.verify({
      workspacePath: dir,
      profile: 'STANDARD',
      skills,
      baseUrl: 'http://127.0.0.1:3999',
    });
    // First without token.
    const empty = new BackendVerificationEngine();
    const missing = await empty.verify({
      workspacePath: dir,
      profile: 'STANDARD',
      skills,
      baseUrl: 'http://127.0.0.1:3999',
    });
    expect(missing.credentialRequest?.kind).toBe('REQUIRES_TEST_CREDENTIAL');
    expect(missing.credentialRequest?.requiredCredential).toBe('admin_access_token');
    expect(missing.results[0].status).toBe('BLOCKED');
    expect(JSON.stringify(missing)).not.toMatch(/super-secret-admin-token/);
    expect(JSON.stringify(secrets.toJSON())).toBe(JSON.stringify({
      adminAccessToken: '[REDACTED]',
      userAccessToken: '[REDACTED]',
      databaseUrl: '[REDACTED]',
    }));
    expect(blocked.results[0].status).toBe('BLOCKED');
    void blocked;
  });

  it('blocks admin testing against a non-local host', async () => {
    const dir = await openApiWorkspace({
      '/api/admin/users': { get: { tags: ['admin'] } },
    });
    const secrets = new RuntimeSecretHolder({ adminAccessToken: 'test-admin' });
    const engine = new BackendVerificationEngine(secrets);
    const report = await engine.verify({
      workspacePath: dir,
      profile: 'STANDARD',
      skills,
      baseUrl: 'https://api.example.com',
    });
    expect(report.results[0].failureType).toBe('UNSAFE_ENVIRONMENT');
    expect(report.results[0].status).toBe('BLOCKED');
  });
});

describe('database verification', () => {
  it('asserts read-only persistence and fails on mismatch', async () => {
    const dir = await openApiWorkspace({ '/api/users': { post: {} } });
    const db = new InMemoryReadOnlyDatabase({
      users: [{ id: '1', email: 'a@example.com' }],
    });
    await withServer((req, res) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!body || body.includes('__invalid')) {
            res.writeHead(400);
            res.end('{"error":"invalid"}');
            return;
          }
          res.writeHead(201);
          res.end('{"id":"1"}');
        });
        return;
      }
      res.writeHead(404);
      res.end();
    }, async baseUrl => {
      const engine = new BackendVerificationEngine(new RuntimeSecretHolder(), db, new EndpointDiscoveryService([new OpenApiDiscoverer()]));
      const pass = await engine.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        skills,
        baseUrl,
        persistenceAssertions: [{
          endpointId: 'POST /api/users',
          assertion: { table: 'users', keyField: 'id', keyValue: '1', expectedFields: { email: 'a@example.com' } },
        }],
      });
      expect(pass.results[0].persistenceResult?.status).toBe('PASS');
      expect(pass.results[0].status).toBe('PASS');

      const failEngine = new BackendVerificationEngine(
        new RuntimeSecretHolder(),
        new InMemoryReadOnlyDatabase({ users: [] }),
        new EndpointDiscoveryService([new OpenApiDiscoverer()]),
      );
      const fail = await failEngine.verify({
        workspacePath: dir,
        profile: 'STANDARD',
        skills,
        baseUrl,
        persistenceAssertions: [{
          endpointId: 'POST /api/users',
          assertion: { table: 'users', keyField: 'id', keyValue: '1', expectedFields: { email: 'a@example.com' } },
        }],
      });
      expect(fail.results[0].persistenceResult?.status).toBe('FAIL');
      expect(fail.results[0].status).toBe('FAIL');
      expect(fail.results[0].failureType).toBe('PERSISTENCE_MISMATCH');
    });
  });
});
