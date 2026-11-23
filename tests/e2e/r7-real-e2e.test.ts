import * as path from 'path';
import * as http from 'http';
import { EndpointDiscoveryService } from '../../src/core/backend/endpoint-discovery';
import { BackendVerificationEngine } from '../../src/core/backend/endpoint-verifier';
import { SqliteReadOnlyDatabase } from '../../src/core/backend/sqlite-read-only-database';
import { RuntimeSecretHolder } from '../../src/core/backend/runtime-secrets';
import { resolveBackendVerificationLimits } from '../../src/domain/backend-verification-limits';
import { checkBackendHealth, validateBackendEnvironmentConfig } from '../../src/domain/backend-test-environment';
import { DEFAULT_SKILLS } from '../../src/core/skill/default-skills';
import { backendReportToChecks } from '../../src/core/backend/report-to-checks';
import { buildFailureContract } from '../../src/core/vv/failure-contract-builder';
import { ConfirmationService } from '../../src/app/confirmation-service';
import { ConfirmationStore, ConfirmationListFilter } from '../../src/contracts/confirmation-store';
import { ConfirmationRequest } from '../../src/domain/confirmation';
import { DefaultApiVerifier } from '../../src/core/vv/default-api-verifier';
import { buildReliabilityRecord } from '../../src/core/reliability/reliability-record-builder';
import { TaskRunSnapshot, TaskRunSkill } from '../../src/domain/task-run';
import { buildRepairObjective, validateRepairPlan } from '../../src/core/repair/repair-target-policy';
import { buildTaskId, buildRunId, buildSessionId, CorrelationContext, validateCorrelationContext } from '../../src/domain/correlation';

const BACKEND_DIR = 'E:\\agentic-r7-backend-test';
const dbPath = path.join(BACKEND_DIR, 'data', 'db-e2e.sqlite');
process.env.DB_PATH = dbPath;

class InMemoryStore implements ConfirmationStore {
  private items = new Map<string, ConfirmationRequest>();
  async save(req: ConfirmationRequest): Promise<void> { this.items.set(req.id, req); }
  async get(id: string): Promise<ConfirmationRequest | null> { return this.items.get(id) ?? null; }
  async list(filter?: ConfirmationListFilter): Promise<ReadonlyArray<ConfirmationRequest>> {
    let arr = [...this.items.values()];
    if (filter?.status) arr = arr.filter(r => r.status === filter.status);
    if (filter?.taskId) arr = arr.filter(r => r.taskId === filter.taskId);
    return Object.freeze(arr);
  }
  async lastModified(): Promise<number> { return Date.now(); }
}

describe('R7 Real Backend + Database E2E Scenarios (A through J)', () => {
  jest.setTimeout(60000);

  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let sqliteDb: SqliteReadOnlyDatabase;
  const backendApp = require(path.join(BACKEND_DIR, 'src', 'app.js'));
  const backendDb = require(path.join(BACKEND_DIR, 'src', 'db.js'));

  beforeAll(async () => {
    // 1. Initialize DB and start real HTTP server process
    backendDb.getDb();
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
  });

  afterAll(async () => {
    sqliteDb.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    backendDb.closeDb();
  });

  beforeEach(() => {
    backendDb.clearUsers();
  });

  it('SCENARIO A — Real Endpoint Verification (Discovery -> Inventory -> HTTP -> Auth -> Admin)', async () => {
    const discovery = new EndpointDiscoveryService();
    const endpoints = await discovery.discover({
      workspacePath: BACKEND_DIR,
      limits: resolveBackendVerificationLimits({}),
    });

    expect(endpoints.length).toBe(8);

    // Verify public endpoint
    const secrets = new RuntimeSecretHolder({
      adminAccessToken: backendApp.TEST_ADMIN_TOKEN,
      userAccessToken: backendApp.TEST_USER_TOKEN,
    });
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      skills: DEFAULT_SKILLS,
    });

    expect(report.endpoints.length).toBe(8);
    expect(report.results.length).toBeGreaterThanOrEqual(8);

    const healthRes = report.results.find(r => r.endpointId === 'GET /api/health');
    expect(healthRes?.status).toBe('PASS');

    const authRes = report.results.find(r => r.endpointId === 'GET /api/users/:id');
    expect(authRes?.authRequirement).toBe('AUTHENTICATED');

    const adminRes = report.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminRes?.adminRequired).toBe(true);
  });

  it('SCENARIO B — Real Persistence (POST -> Real SQLite Write -> Read-only SELECT -> PASS)', async () => {
    // 1. Issue HTTP POST to real backend
    const createRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'e2e-user-1',
        email: 'e2e.alice@example.com',
        name: 'Alice E2E',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBe('e2e-user-1');

    // 2. Read-only verification by Sparrow
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
          keyValue: 'e2e-user-1',
          expectedFields: {
            id: 'e2e-user-1',
            email: 'e2e.alice@example.com',
            name: 'Alice E2E',
          },
        },
      }],
      skills: DEFAULT_SKILLS,
    });

    const userPost = report.results.find(r => r.endpointId === 'POST /api/users');
    expect(userPost?.persistenceResult?.status).toBe('PASS');
    expect(userPost?.persistenceResult?.queried).toBe(true);
  });

  it('SCENARIO C — Admin Credential Lifecycle (Request -> R5 Confirmation -> Use -> Clear)', async () => {
    const confirmationStore = new InMemoryStore();
    const confirmationService = new ConfirmationService(confirmationStore);

    // Step 1: Endpoint without credential reports REQUIRES_TEST_CREDENTIAL
    const secrets = new RuntimeSecretHolder();
    const engineNoCred = new BackendVerificationEngine(secrets, sqliteDb);

    const reportBlocked = await engineNoCred.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/admin/users' }],
      skills: DEFAULT_SKILLS,
    });

    const adminBlocked = reportBlocked.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminBlocked?.status).toBe('BLOCKED');
    expect(adminBlocked?.failureType).toBe('REQUIRES_TEST_CREDENTIAL');

    // Step 2: Request credential via R5 ConfirmationService
    const confReq = await confirmationService.createRequest({
      taskId: 'task-admin-e2e',
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
      reason: 'Admin token required for POST /api/admin/users',
      requestedAction: 'Provide test admin token',
      affectedFiles: ['src/app.js'],
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'Supply test token for admin endpoint',
      },
    });
    expect(confReq.status).toBe('PENDING');

    // Step 3: Human approves with test credential
    await confirmationService.approve(confReq.id, {
      reason: 'Test admin token supplied by developer',
    });
    secrets.set({ adminAccessToken: backendApp.TEST_ADMIN_TOKEN });

    // Step 4: Verification succeeds
    const engineWithCred = new BackendVerificationEngine(secrets, sqliteDb);
    const reportPass = await engineWithCred.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/admin/users' }],
      skills: DEFAULT_SKILLS,
    });

    const adminPass = reportPass.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminPass?.status).not.toBe('BLOCKED');

    // Step 5: Credential is wiped from memory
    secrets.clear();
    expect(secrets.get().adminAccessToken).toBeUndefined();
  });

  it('SCENARIO D — Real Backend Failure (GET /api/boom -> 500 -> UNHANDLED_EXCEPTION -> FailureContract)', async () => {
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
    expect(boomResult?.status).toBe('FAIL');
    expect(boomResult?.failureType).toBe('UNHANDLED_EXCEPTION');

    const checks = backendReportToChecks(report);
    const failureContract = buildFailureContract({
      checks,
      profile: 'PRODUCTION',
      attempt: 1,
    });

    expect(failureContract).toBeDefined();
    expect(failureContract?.category).toBe('api');
    expect(failureContract?.summary).toContain('verification check(s) failed');
  });

  it('SCENARIO E — Persistence Mismatch (HTTP 201 + Missing DB Row -> PERSISTENCE_MISMATCH)', async () => {
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
          keyValue: 'mismatch-ghost-id',
          expectedFields: {
            id: 'mismatch-ghost-id',
            email: 'ghost@example.com',
          },
        },
      }],
      skills: DEFAULT_SKILLS,
    });

    const mismatchResult = report.results.find(r => r.endpointId === 'POST /api/mismatch-user');
    expect(mismatchResult?.status).toBe('FAIL');
    expect(mismatchResult?.persistenceResult?.status).toBe('FAIL');
    expect(mismatchResult?.failureType).toBe('PERSISTENCE_MISMATCH');
  });

  it('SCENARIO F — Repair Intelligence & R4 Targeting Protection against Backend Defects', () => {
    // 1. Genuine Repair Target
    const legitimateObjective = buildRepairObjective({
      originalTask: 'Fix crash in user registration endpoint in src/app.js',
      implicatedFiles: ['src/app.js'],
    });

    const legitimateValidation = validateRepairPlan({
      objective: legitimateObjective,
      repairPlan: {
        affectedFiles: ['src/app.js'],
        todos: [
          {
            id: 'todo-repair-1',
            title: 'Fix unhandled null check in user registration handler',
            description: 'Add input validation before calling createUser',
            risk: 'MEDIUM',
            files: ['src/app.js'],
            verificationRequirements: ['api'],
          } as any,
        ],
      } as any,
    });

    expect(legitimateValidation.decision).toBe('ALLOW');

    // 2. Acceptance-Chasing Attempt: deleting the endpoint
    const cheatingValidation = validateRepairPlan({
      objective: legitimateObjective,
      repairPlan: {
        affectedFiles: ['src/app.js'],
        todos: [
          {
            id: 'todo-repair-1',
            title: 'Delete user registration route to avoid test failure',
            description: 'Remove route /api/users completely',
            risk: 'HIGH',
            files: ['src/app.js'],
            verificationRequirements: ['api'],
          } as any,
        ],
      } as any,
    });

    expect(cheatingValidation.decision).not.toBe('ALLOW');
    expect(cheatingValidation.findings.some(f => f.kind === 'ACCEPTANCE_CHASING' || f.kind === 'INTENT_MISMATCH')).toBe(true);
  });

  it('SCENARIO G — Confirmation Flow for Backend High-Risk Changes', async () => {
    const store = new InMemoryStore();
    const confirmationService = new ConfirmationService(store);

    const request = await confirmationService.createRequest({
      taskId: 'task-db-migration',
      type: 'HIGH_RISK_CHANGE',
      risk: 'HIGH',
      reason: 'Executing schema migration on backend test database',
      requestedAction: 'Run migration script',
      affectedFiles: ['src/db.js'],
    });

    expect(request.status).toBe('PENDING');

    const approved = await confirmationService.approve(request.id, {
      actor: 'qa-engineer',
      reason: 'Approved for test environment database',
    });

    expect(approved.status).toBe('APPROVED');
    expect(approved.decision?.actor).toBe('qa-engineer');
  });

  it('SCENARIO H — READ_ONLY Mode (No Mutating HTTP probes & DB remains pure SELECT)', async () => {
    const secrets = new RuntimeSecretHolder();
    const verifier = new DefaultApiVerifier({ secrets, database: sqliteDb });

    const checks = await verifier.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      task: 'Inspect backend endpoints in read-only mode',
      skills: DEFAULT_SKILLS,
      sideEffectPolicy: 'READ_ONLY',
    });

    expect(checks.length).toBeGreaterThan(0);
    const effects = verifier.drainSideEffects();
    expect(effects.every(e => e.policy === 'READ_ONLY' || e.status === 'BLOCKED' || e.reversible)).toBe(true);

    // Database is untouched
    const users = backendDb.listUsers();
    expect(users.length).toBe(0);
  });

  it('SCENARIO I — First-Class Run Correlation (Run A vs Run B Isolation)', () => {
    const corrA: CorrelationContext = {
      taskId: buildTaskId(),
      runId: buildRunId(),
      sessionId: buildSessionId('repl'),
      attemptId: 'attempt-1',
    };

    const corrB: CorrelationContext = {
      taskId: buildTaskId(),
      runId: buildRunId(),
      sessionId: buildSessionId('repl'),
      attemptId: 'attempt-1',
    };

    expect(validateCorrelationContext(corrA).valid).toBe(true);
    expect(validateCorrelationContext(corrB).valid).toBe(true);
    expect(corrA.runId).not.toEqual(corrB.runId);
    expect(corrA.taskId).not.toEqual(corrB.taskId);
  });

  it('SCENARIO J — Reliability Record Generation with Real Backend Evidence', () => {
    const mockSkill: TaskRunSkill = {
      id: 'backend.core',
      name: 'Backend Core',
      domain: 'backend',
      domains: ['backend'],
      frameworks: ['express'],
      requiredChecks: ['api', 'database-read-check'],
      planningConstraints: [],
    };

    const snapshot: TaskRunSnapshot = {
      taskId: 'task-r7-e2e-final',
      runId: 'run-r7-e2e-final',
      sessionId: 'session-r7-e2e-final',
      task: 'Execute complete R7 real backend and database verification',
      roleId: 'backend-engineer',
      workspaceRoot: BACKEND_DIR,
      status: 'COMPLETED',
      startedAt: '2026-08-30T00:00:00.000Z',
      completedAt: '2026-08-30T00:02:00.000Z',
      skills: [mockSkill],
      context: [],
      execution: [],
      verification: {
        passed: true,
        qualityProfile: 'PRODUCTION',
        checks: [
          {
            id: 'api-endpoint-discovery',
            category: 'api',
            name: 'API endpoint discovery',
            passed: true,
            severity: 'LOW',
            evidence: 'Discovered 8 endpoint(s)',
          },
          {
            id: 'api-endpoint-coverage',
            category: 'api',
            name: 'Endpoint coverage',
            passed: true,
            severity: 'LOW',
            evidence: 'discovered=8 tested=8 passed=8 failed=0 blocked=0 skipped=0',
          },
          {
            id: 'db-POST-api-users',
            category: 'api',
            name: 'database-read-check',
            passed: true,
            severity: 'LOW',
            evidence: 'endpointId: POST /api/users; databaseVerificationStatus: PASS',
          },
        ],
      } as any,
      touchedFiles: ['src/app.js', 'src/db.js'],
    };

    const record = buildReliabilityRecord(snapshot);
    expect(record.taskId).toBe('task-r7-e2e-final');
    expect(record.runId).toBe('run-r7-e2e-final');
    expect(record.sessionId).toBe('session-r7-e2e-final');
    expect(record.verification.status).toBe('PASSED');
  });
});
