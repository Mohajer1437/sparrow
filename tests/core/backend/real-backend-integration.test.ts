import * as path from 'path';
import * as http from 'http';
import { BackendVerificationEngine } from '../../../src/core/backend/endpoint-verifier';
import { SqliteReadOnlyDatabase } from '../../../src/core/backend/sqlite-read-only-database';
import { RuntimeSecretHolder } from '../../../src/core/backend/runtime-secrets';
import { DEFAULT_SKILLS } from '../../../src/core/skill/default-skills';
import { mapEndpointToTodo } from '../../../src/core/backend/todo-endpoint-mapping';
import { backendReportToChecks } from '../../../src/core/backend/report-to-checks';
import { buildFailureContract } from '../../../src/core/vv/failure-contract-builder';
import { ConfirmationService } from '../../../src/app/confirmation-service';
import { ConfirmationStore, ConfirmationListFilter } from '../../../src/contracts/confirmation-store';
import { ConfirmationRequest } from '../../../src/domain/confirmation';
import { DefaultApiVerifier } from '../../../src/core/vv/default-api-verifier';
import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { TaskRunSnapshot, TaskRunSkill } from '../../../src/domain/task-run';

const BACKEND_DIR = 'E:\\agentic-r7-backend-test';
const dbPath = path.join(BACKEND_DIR, 'data', 'db-int.sqlite');
process.env.DB_PATH = dbPath;

class MockInMemoryConfirmationStore implements ConfirmationStore {
  private items = new Map<string, ConfirmationRequest>();

  async save(request: ConfirmationRequest): Promise<void> {
    this.items.set(request.id, request);
  }

  async get(id: string): Promise<ConfirmationRequest | null> {
    return this.items.get(id) ?? null;
  }

  async list(filter?: ConfirmationListFilter): Promise<ReadonlyArray<ConfirmationRequest>> {
    let list = [...this.items.values()];
    if (filter?.status) list = list.filter(r => r.status === filter.status);
    if (filter?.taskId) list = list.filter(r => r.taskId === filter.taskId);
    return Object.freeze(list);
  }

  async lastModified(): Promise<number> {
    return Date.now();
  }
}

describe('R7 Real Backend Integration Suite', () => {
  jest.setTimeout(45000);

  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let sqliteDb: SqliteReadOnlyDatabase;
  const backendApp = require(path.join(BACKEND_DIR, 'src', 'app.js'));
  const backendDb = require(path.join(BACKEND_DIR, 'src', 'db.js'));

  beforeAll(async () => {
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

  it('R7.23: maps endpoints to Todos with unique attribution or UNKNOWN', () => {
    const todoPlan: any = {
      todos: [
        {
          id: 'todo-1',
          title: 'Implement user creation API endpoint',
          description: 'POST /api/users endpoint for creating users',
          risk: 'MEDIUM',
          files: ['src/app.js'],
          verificationRequirements: ['api'],
          status: 'PENDING',
        },
        {
          id: 'todo-2',
          title: 'Implement health check endpoint',
          description: 'GET /api/health for system status',
          risk: 'LOW',
          files: ['src/app.js'],
          verificationRequirements: ['api'],
          status: 'PENDING',
        },
      ],
    };

    const endpointUsers: any = { id: 'POST /api/users', method: 'POST', path: '/api/users' };
    const mappedUsers = mapEndpointToTodo(endpointUsers, todoPlan);
    expect(mappedUsers).toBe('todo-1');

    const endpointHealth: any = { id: 'GET /api/health', method: 'GET', path: '/api/health' };
    const mappedHealth = mapEndpointToTodo(endpointHealth, todoPlan);
    expect(mappedHealth).toBe('todo-2');

    const endpointUnknown: any = { id: 'GET /api/unmapped-route', method: 'GET', path: '/api/unmapped-route' };
    const mappedUnknown = mapEndpointToTodo(endpointUnknown, todoPlan);
    expect(mappedUnknown).toBeUndefined();
  });

  it('R7.24 & R7.25: builds structured FailureContract with primary, secondary, and incidental classification', async () => {
    const secrets = new RuntimeSecretHolder();
    const engine = new BackendVerificationEngine(secrets, sqliteDb);

    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [
        { method: 'GET', path: '/api/boom' },
        { method: 'POST', path: '/api/mismatch-user' },
        { method: 'GET', path: '/api/health' },
      ],
      skills: DEFAULT_SKILLS,
    });

    const checks = backendReportToChecks(report);
    const failureContract = buildFailureContract({
      checks,
      profile: 'PRODUCTION',
      attempt: 1,
    });

    expect(failureContract).toBeDefined();
    expect(failureContract?.failedChecks.length).toBeGreaterThan(0);
    expect(failureContract?.summary).toContain('verification check(s) failed');
    expect(failureContract?.reproduction?.environment).toContain('profile=PRODUCTION');
  });

  it('R7.29: integrates with ConfirmationService for admin credential lifecycle', async () => {
    const store = new MockInMemoryConfirmationStore();
    const confirmService = new ConfirmationService(store);

    const req = await confirmService.createRequest({
      taskId: 'task-admin-cred-test-1',
      type: 'REQUIRES_TEST_CREDENTIAL',
      risk: 'HIGH',
      reason: 'Provide test-environment admin token for POST /api/admin/users verification',
      requestedAction: 'Provide test admin token',
      affectedFiles: ['src/app.js'],
      credentialRequirement: {
        kind: 'admin_access_token',
        environment: 'test',
        scope: 'admin API',
        endpoints: ['POST /api/admin/users'],
        reason: 'Provide test admin access token',
      },
    });

    expect(req.status).toBe('PENDING');

    // Supply local test token through confirmation
    const secrets = new RuntimeSecretHolder();
    const approved = await confirmService.approve(req.id, {
      reason: 'Valid test token provided',
    });

    expect(approved.status).toBe('APPROVED');
    secrets.set({ adminAccessToken: backendApp.TEST_ADMIN_TOKEN });

    // Use token for verification
    const engine = new BackendVerificationEngine(secrets, sqliteDb);
    const report = await engine.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      baseUrl,
      referencedEndpoints: [{ method: 'POST', path: '/api/admin/users' }],
      skills: DEFAULT_SKILLS,
    });

    const adminResult = report.results.find(r => r.endpointId === 'POST /api/admin/users');
    expect(adminResult?.status).not.toBe('BLOCKED');

    // Clear secret
    secrets.clear();
    expect(secrets.get().adminAccessToken).toBeUndefined();
  });

  it('R7.30: enforces READ_ONLY side-effect policy refusing mutating probes and keeping DB SELECT-only', async () => {
    const secrets = new RuntimeSecretHolder();
    const apiVerifier = new DefaultApiVerifier({ secrets, database: sqliteDb });

    const checks = await apiVerifier.verify({
      workspacePath: BACKEND_DIR,
      profile: 'PRODUCTION',
      task: 'Inspect backend endpoint structure in read-only mode',
      skills: DEFAULT_SKILLS,
      sideEffectPolicy: 'READ_ONLY',
    });

    expect(checks.length).toBeGreaterThan(0);
    const sideEffects = apiVerifier.drainSideEffects();
    expect(sideEffects.every(e => e.policy === 'READ_ONLY' || e.status === 'BLOCKED' || e.reversible)).toBe(true);

    // Verify DB remains clean
    const usersInDb = backendDb.listUsers();
    expect(usersInDb.length).toBe(0);
  });

  it('R7.35 & R7.36: populates ReliabilityRecord with real backend and DB verification metrics', () => {
    const mockSkill: TaskRunSkill = {
      id: 'backend.core',
      name: 'Backend Core',
      domain: 'backend',
      domains: ['backend'],
      frameworks: ['express'],
      requiredChecks: ['api'],
      planningConstraints: [],
    };

    const snapshot: TaskRunSnapshot = {
      taskId: 'task-r7-backend-001',
      runId: 'run-r7-backend-001',
      sessionId: 'session-r7-backend-001',
      task: 'Verify real backend endpoints and persistence',
      roleId: 'backend-engineer',
      workspaceRoot: BACKEND_DIR,
      status: 'COMPLETED',
      startedAt: '2026-08-30T00:00:00.000Z',
      completedAt: '2026-08-30T00:01:00.000Z',
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
            id: 'db-POST-api-users',
            category: 'api',
            name: 'database-read-check',
            passed: true,
            severity: 'LOW',
            evidence: 'endpointId: POST /api/users; databaseVerificationStatus: PASS',
          },
        ],
      } as any,
      touchedFiles: ['src/app.js'],
    };

    const record = buildReliabilityRecord(snapshot);
    expect(record.taskId).toBe('task-r7-backend-001');
    expect(record.runId).toBe('run-r7-backend-001');
    expect(record.sessionId).toBe('session-r7-backend-001');
    expect(record.verification.status).toBe('PASSED');
  });
});
