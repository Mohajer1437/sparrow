import * as path from 'path';
import * as http from 'http';
import { EndpointDiscoveryService } from '../../../src/core/backend/endpoint-discovery';
import { BackendVerificationEngine } from '../../../src/core/backend/endpoint-verifier';
import { SqliteReadOnlyDatabase } from '../../../src/core/backend/sqlite-read-only-database';
import { RuntimeSecretHolder } from '../../../src/core/backend/runtime-secrets';
import { resolveBackendVerificationLimits } from '../../../src/domain/backend-verification-limits';
import { checkBackendHealth, validateBackendEnvironmentConfig } from '../../../src/domain/backend-test-environment';
import { DEFAULT_SKILLS } from '../../../src/core/skill/default-skills';

const BACKEND_DIR = 'E:\\agentic-r7-backend-test';
const dbPath = path.join(BACKEND_DIR, 'data', 'db-env.sqlite');
process.env.DB_PATH = dbPath;

describe('R7 Real Backend Environment & Verification Suite', () => {
  jest.setTimeout(30000);

  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let sqliteDb: SqliteReadOnlyDatabase;
  const backendApp = require(path.join(BACKEND_DIR, 'src', 'app.js'));
  const backendDb = require(path.join(BACKEND_DIR, 'src', 'db.js'));

  beforeAll(async () => {
    // Start real backend server
    server = backendApp.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    sqliteDb = new SqliteReadOnlyDatabase(dbPath);
  });

  afterAll(async () => {
    sqliteDb.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    backendDb.closeDb();
  });

  beforeEach(() => {
    backendDb.clearUsers();
  });

  it('R7.1 & R7.2: validates configuration and verifies health of real backend process', async () => {
    validateBackendEnvironmentConfig({
      root: BACKEND_DIR,
      baseUrl,
      port,
      host: '127.0.0.1',
      healthEndpoint: '/api/health',
      databasePath: dbPath,
      auth: {
        userToken: backendApp.TEST_USER_TOKEN,
        adminToken: backendApp.TEST_ADMIN_TOKEN,
      },
      adminCredentialRequirement: 'admin_access_token',
      startupCommand: 'node src/server.js',
    });

    const health = await checkBackendHealth(baseUrl, '/api/health');
    expect(health.healthy).toBe(true);
    expect(health.status).toBe(200);
  });

  it('R7.6 & R7.7: discovers real endpoints and builds deterministic inventory', async () => {
    const discovery = new EndpointDiscoveryService();
    const endpoints = await discovery.discover({
      workspacePath: BACKEND_DIR,
      limits: resolveBackendVerificationLimits({}),
    });

    expect(endpoints.length).toBe(8);
    const ids = endpoints.map(e => e.id);
    expect(ids).toContain('GET /api/health');
    expect(ids).toContain('POST /api/users');
    expect(ids).toContain('GET /api/users/:id');
    expect(ids).toContain('POST /api/admin/users');
    expect(ids).toContain('GET /api/admin/users/:id');
    expect(ids).toContain('GET /api/boom');
    expect(ids).toContain('POST /api/mismatch-user');
    expect(ids).toContain('GET /api/slow');

    const adminUserPost = endpoints.find(e => e.id === 'POST /api/admin/users');
    expect(adminUserPost?.adminRequired).toBe(true);
    expect(adminUserPost?.authRequirement).toBe('ADMIN');

    const authUserGet = endpoints.find(e => e.id === 'GET /api/users/:id');
    expect(authUserGet?.adminRequired).toBe(false);
    expect(authUserGet?.authRequirement).toBe('AUTHENTICATED');

    const publicHealth = endpoints.find(e => e.id === 'GET /api/health');
    expect(publicHealth?.adminRequired).toBe(false);
    expect(publicHealth?.authRequirement).toBe('NONE');
  });

  it('R7.8 & R7.9: performs real HTTP verification for public endpoint', async () => {
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'GET', path: '/api/health' }],
      skills: DEFAULT_SKILLS,
    });

    const healthResult = report.results.find(r => r.endpointId === 'GET /api/health');
    expect(healthResult).toBeDefined();
    expect(healthResult?.status).toBe('PASS');
  });

  it('R7.10: verifies authenticated endpoint with auth-none and auth-valid cases', async () => {
    // Create a user in the real DB first
    const created = backendDb.createUser({
      id: 'u-auth-test',
      email: 'authtest@example.com',
      name: 'Auth Test User',
    });

    const secrets = new RuntimeSecretHolder({
      userAccessToken: backendApp.TEST_USER_TOKEN,
    });
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'GET', path: '/api/users/:id' }],
      skills: DEFAULT_SKILLS,
    });

    const userGetResult = report.results.find(r => r.endpointId === 'GET /api/users/:id');
    expect(userGetResult).toBeDefined();
    expect(userGetResult?.authRequirement).toBe('AUTHENTICATED');
    expect(userGetResult?.cases.some(c => c.kind === 'auth-none')).toBe(true);
  });

  it('R7.11 & R7.12: requests admin credential when token is missing, and passes when provided', async () => {
    // 1. Missing token -> BLOCKED with REQUIRES_TEST_CREDENTIAL
    const secretsWithoutToken = new RuntimeSecretHolder();
    const engineNoToken = new BackendVerificationEngine(secretsWithoutToken, sqliteDb);

    const reportNoToken = await engineNoToken.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/admin/users' }],
      skills: DEFAULT_SKILLS,
    });

    const adminResultBlocked = reportNoToken.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminResultBlocked?.status).toBe('BLOCKED');
    expect(adminResultBlocked?.failureType).toBe('REQUIRES_TEST_CREDENTIAL');
    expect(reportNoToken.credentialRequest?.requiredCredential).toBe('admin_access_token');

    // 2. Token provided -> verification runs
    const secretsWithToken = new RuntimeSecretHolder({
      adminAccessToken: backendApp.TEST_ADMIN_TOKEN,
    });
    const engineWithToken = new BackendVerificationEngine(secretsWithToken, sqliteDb);

    const reportWithToken = await engineWithToken.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/admin/users' }],
      skills: DEFAULT_SKILLS,
    });

    const adminResultPass = reportWithToken.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminResultPass?.status).not.toBe('BLOCKED');
  });

  it('R7.15 & R7.16: verifies real database write via read-only SELECT (Positive Persistence)', async () => {
    // Issue real HTTP POST /api/users to write to SQLite DB
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'user-persist-1',
        email: 'persist1@example.com',
        name: 'Persistence User',
      }),
    });
    expect(res.status).toBe(201);

    // Sparrow verifies via ReadOnlyDatabase with pure SELECT query
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/users' }],
      persistenceAssertions: [{
        endpointId: 'POST /api/users',
        assertion: {
          table: 'users',
          keyField: 'id',
          keyValue: 'user-persist-1',
          expectedFields: {
            id: 'user-persist-1',
            email: 'persist1@example.com',
            name: 'Persistence User',
          },
        },
      }],
      skills: DEFAULT_SKILLS,
    });

    const userPostResult = report.results.find(r => r.endpointId === 'POST /api/users');
    expect(userPostResult).toBeDefined();
    expect(userPostResult?.persistenceResult?.status).toBe('PASS');
    expect(userPostResult?.persistenceResult?.queried).toBe(true);
  });

  it('R7.17: detects persistence mismatch when expected DB record is missing', async () => {
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/mismatch-user' }],
      persistenceAssertions: [{
        endpointId: 'POST /api/mismatch-user',
        assertion: {
          table: 'users',
          keyField: 'id',
          keyValue: 'mismatch-999',
          expectedFields: {
            id: 'mismatch-999',
            email: 'ghost@example.com',
          },
        },
      }],
      skills: DEFAULT_SKILLS,
    });

    const mismatchResult = report.results.find(r => r.endpointId === 'POST /api/mismatch-user');
    expect(mismatchResult).toBeDefined();
    expect(mismatchResult?.status).toBe('FAIL');
    expect(mismatchResult?.persistenceResult?.status).toBe('FAIL');
    expect(mismatchResult?.failureType).toBe('PERSISTENCE_MISMATCH');
  });

  it('R7.18 & R7.19: detects unhandled 500 exception and HTML error responses', async () => {
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'GET', path: '/api/boom' }],
      skills: DEFAULT_SKILLS,
    });

    const boomResult = report.results.find(r => r.endpointId === 'GET /api/boom');
    expect(boomResult).toBeDefined();
    expect(boomResult?.status).toBe('FAIL');
    expect(boomResult?.unhandledError).toBe(true);
    expect(boomResult?.failureType).toBe('UNHANDLED_EXCEPTION');
  });

  it('R7.20: detects timeout on slow endpoint without hanging', async () => {
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'GET', path: '/api/slow' }],
      limits: { requestTimeoutMs: 300 },
      skills: DEFAULT_SKILLS,
    });

    const slowResult = report.results.find(r => r.endpointId === 'GET /api/slow');
    expect(slowResult).toBeDefined();
    expect(slowResult?.status).toBe('FAIL');
    expect(slowResult?.failureType).toBe('TIMEOUT');
  });
});
