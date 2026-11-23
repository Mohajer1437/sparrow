/**
 * Milestone H interface tests.
 *
 * These assert the platform property that matters most: CLI, REPL and the Web
 * API are windows onto one application layer. Everything served over HTTP is
 * compared against what the application service returns directly, and every
 * "unknown" in the evidence must survive the trip to the interface.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileTaskRunStore } from '../../src/app/file-task-run-store';
import { PipelineEventReader } from '../../src/app/pipeline-event-reader';
import { TaskQueryService } from '../../src/app/task-query-service';
import { createWebServer, StartedWebServer } from '../../src/web/web-server';
import { buildCapabilityCatalog, listCapabilities } from '../../src/app/platform-capabilities';
import { classifyError, httpStatusFor, InterfaceError } from '../../src/app/interface-error';
import { TaskRunSnapshot } from '../../src/domain/task-run';
import { makeSnapshot, WORKSPACE } from '../core/reliability/fixtures/reliability-fixtures';

let root: string;
let server: StartedWebServer;
let base: string;
let queries: TaskQueryService;

const COMPLETED = 'task-2026-08-28T10-00-00-000Z-aaaaaa';
const BLOCKED = 'task-2026-08-28T11-00-00-000Z-bbbbbb';

async function get(pathname: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${pathname}`);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function completedSnapshot(): TaskRunSnapshot {
  return makeSnapshot({
    taskId: COMPLETED,
    sessionId: 'run-completed',
    versionIntelligence: {
      summary: 'nextjs 14.2.35 resolved from the lockfile',
      dependenciesCount: 12,
      effectiveKnowledgeCount: 1,
      staleCount: 0,
      conflictCount: 0,
      items: [{
        technology: 'nextjs',
        declaredVersion: '^14.2.0',
        resolvedVersion: '14.2.35',
        normalizedVersion: '14.2.35',
        versionSource: 'LOCKFILE',
        status: 'RESOLVED',
        effectiveSource: 'VERSION_SPECIFIC_KNOWLEDGE',
        summary: 'App Router is stable in 14.x',
        provenance: 'package-lock.json',
      }],
    },
    impactAnalysis: {
      confidence: 'INFERRED',
      summary: 'direct=1, indirect=1',
      changedFiles: ['app/page.tsx'],
      directlyAffected: ['app/page.tsx'],
      indirectlyAffected: ['app/layout.tsx'],
      affectedEndpoints: [],
      affectedTests: [],
      affectedDomains: ['frontend'],
      relations: [{
        source: 'app/page.tsx',
        target: 'app/layout.tsx',
        relationType: 'RENDERED_BY',
        confidence: 'INFERRED',
        reason: 'app router convention',
      }],
      unknowns: ['app/CrashBeacon.tsx'],
      limitsReached: false,
    },
    regressionPlan: {
      risk: 'LOW',
      policy: 'LOW_RISK_DETERMINISTIC_POLICY',
      directChecks: ['lint'],
      expandedChecks: ['typecheck'],
      selectedChecks: ['lint', 'typecheck'],
      skippedChecks: [{ check: 'e2e', reason: 'LOW risk change skips browser regression' }],
      affectedArtifacts: ['app/page.tsx', 'app/layout.tsx'],
      verifiedArtifacts: ['app/page.tsx'],
      unverifiedArtifacts: ['app/layout.tsx'],
      reasons: ['risk is LOW'],
    },
  });
}

function blockedSnapshot(): TaskRunSnapshot {
  return makeSnapshot({
    taskId: BLOCKED,
    sessionId: 'run-blocked',
    status: 'BLOCKED',
    startedAt: '2026-08-28T11:00:00.000Z',
    completedAt: '2026-08-28T11:00:30.000Z',
    abortedAt: 'execution-gate',
    abortReason: 'REQUIRES_TEST_CREDENTIAL: admin credential was not supplied',
    verification: undefined,
    versionIntelligence: undefined,
    todoPlan: undefined,
    execution: [],
    impactAnalysis: undefined,
    regressionPlan: undefined,
    contextStrategy: {
      repairMode: false,
      selectedSources: ['USER_TASK'],
      requiredSources: ['USER_TASK', 'PRODUCT_QA'],
      optionalSources: [],
      excludedSources: [],
      deferredSources: [],
      missingRequired: ['PRODUCT_QA'],
      missingOptional: [],
      reasoning: ['product QA context could not be gathered'],
    },
  });
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sparrow-h-'));
  const store = new FileTaskRunStore(root);
  await store.save(completedSnapshot());
  await store.save(blockedSnapshot());
  queries = new TaskQueryService(store, new PipelineEventReader(root), root);
  server = await createWebServer(queries, { port: 0, pollIntervalMs: 50 }).listen();
  base = server.url;
});

afterAll(async () => {
  await server?.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('Capability inventory and parity matrix (H.1, H.4, H.29)', () => {
  it('declares one application service per capability', () => {
    for (const capability of listCapabilities()) {
      expect(capability.applicationService.length).toBeGreaterThan(0);
      expect(capability.id).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('lists every non-supported interface as an explicit gap with a reason', () => {
    const catalog = buildCapabilityCatalog(new Date('2026-08-28T12:00:00.000Z'));
    const declaredGaps = catalog.capabilities.flatMap(capability =>
      (['cli', 'repl', 'api', 'ui'] as const)
        .filter(id => capability[id].support !== 'SUPPORTED')
        .map(id => `${capability.id}:${id}`));
    const reportedGaps = catalog.gaps.map(gap => `${gap.capabilityId}:${gap.interfaceId}`);
    expect(reportedGaps.sort()).toEqual(declaredGaps.sort());
    for (const gap of catalog.gaps) expect(gap.detail.length).toBeGreaterThan(0);
  });

  it('exposes task execution through local operator surface (UI-2.1)', () => {
    const execute = listCapabilities().find(capability => capability.id === 'task.execute')!;
    expect(execute.cli.support).toBe('SUPPORTED');
    expect(execute.repl.support).toBe('SUPPORTED');
    expect(execute.api.support).toBe('SUPPORTED');
    expect(execute.ui.support).toBe('SUPPORTED');
  });

  it('serves the same catalog over HTTP', async () => {
    const { status, body } = await get('/api/capabilities');
    expect(status).toBe(200);
    expect(body.apiVersion).toBe('v1');
    expect(body.capabilities.length).toBe(listCapabilities().length);
  });
});

describe('API versioning and read-only surface (H.11, H.22, H.30, H.32, H.33)', () => {
  it('serves /api and /api/v1 identically', async () => {
    const plain = await get(`/api/tasks/${COMPLETED}/timeline`);
    const versioned = await get(`/api/v1/tasks/${COMPLETED}/timeline`);
    expect(plain.status).toBe(200);
    expect(versioned.body).toEqual(plain.body);
  });

  it('refuses every write verb', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/api/tasks`, { method });
      expect(res.status).toBe(405);
      expect((await res.json()).error.code).toBe('METHOD_NOT_ALLOWED');
    }
  });

  it('has no task creation endpoint', async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'rm -rf /', cwd: 'C:/' }),
    });
    expect(res.status).toBe(405);
  });
});

describe('Interface error model (H.19)', () => {
  it('maps an invalid task id to VALIDATION_ERROR', async () => {
    const { status, body } = await get('/api/tasks/not%20a%20task%20id/timeline');
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.detailCode).toBe('INVALID_TASK_ID');
  });

  it('maps an unknown but well-formed task id to NOT_FOUND', async () => {
    const { status, body } = await get('/api/tasks/task-2026-08-28T09-00-00-000Z-zzzzzz/impact');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('maps an unknown route to NOT_FOUND without echoing the path', async () => {
    const { status, body } = await get('/api/tasks/' + COMPLETED + '/../../etc/passwd');
    expect([400, 404]).toContain(status);
    expect(JSON.stringify(body)).not.toContain('passwd');
  });

  it('never forwards an unclassified error message or stack', () => {
    const body = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434 token=sk-secret'));
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('The request could not be completed');
  });

  it('gives every error code an HTTP status', () => {
    expect(httpStatusFor('REQUIRES_TEST_CREDENTIAL')).toBe(428);
    expect(httpStatusFor('BLOCKED')).toBe(409);
    expect(classifyError(new InterfaceError('BLOCKED', 'confirmation required')).error.code).toBe('BLOCKED');
  });
});

describe('Read parity between the application service and the API (H.8, H.24)', () => {
  const routes: ReadonlyArray<[string, keyof TaskQueryService]> = [
    ['context', 'getContext'],
    ['skills', 'getSkills'],
    ['version', 'getVersion'],
    ['todos', 'getTodos'],
    ['impact', 'getImpact'],
    ['regression', 'getRegression'],
    ['execution', 'getExecution'],
    ['verification', 'getVerification'],
    ['failure', 'getFailure'],
    ['repair', 'getRepair'],
    ['timeline', 'getTimeline'],
  ];

  it.each(routes)('serves /%s exactly as the service returns it', async (route, method) => {
    const { status, body } = await get(`/api/v1/tasks/${COMPLETED}/${route}`);
    const direct = await (queries[method] as any).call(queries, COMPLETED);
    expect(status).toBe(200);
    expect(body).toEqual(JSON.parse(JSON.stringify(direct)));
  });

  it('exposes the same run identity everywhere', async () => {
    const list = await get('/api/v1/tasks');
    const summary = list.body.tasks.find((task: any) => task.taskId === COMPLETED);
    const timeline = await get(`/api/v1/tasks/${COMPLETED}/timeline`);
    const detail = await get(`/api/v1/tasks/${COMPLETED}`);
    expect(summary.runId).toBe('run-completed');
    expect(timeline.body.runId).toBe('run-completed');
    expect(detail.body.sessionId).toBe('run-completed');
  });
});

describe('Run timeline (H.13)', () => {
  it('only lists stages that produced evidence', async () => {
    const { body } = await get(`/api/v1/tasks/${COMPLETED}/timeline`);
    const stages = body.stages.map((stage: any) => stage.stage);
    expect(stages).toContain('TODO_PLAN');
    expect(stages).toContain('IMPACT');
    expect(stages).toContain('VERIFICATION');
    expect(stages).not.toContain('FAILURE');
    expect(stages).not.toContain('REPAIR');
  });

  it('omits planning stages a blocked run never reached', async () => {
    const { body } = await get(`/api/v1/tasks/${BLOCKED}/timeline`);
    const stages = body.stages.map((stage: any) => stage.stage);
    expect(stages).not.toContain('TODO_PLAN');
    expect(stages).not.toContain('EXECUTION');
    expect(stages).not.toContain('VERIFICATION');
    expect(body.stages[body.stages.length - 1]).toMatchObject({ stage: 'OUTCOME', status: 'BLOCKED' });
  });

  it('ends with the recorded terminal status, not a live guess', async () => {
    const { body } = await get(`/api/v1/tasks/${COMPLETED}/timeline`);
    expect(body.recordedStatus).toBe('COMPLETED');
    expect(body.liveStatus).toBe('COMPLETED');
  });
});

describe('Anti-hallucination across interfaces', () => {
  it('shows MISSING_REQUIRED context instead of assuming context existed', async () => {
    const { body } = await get(`/api/v1/tasks/${BLOCKED}/context`);
    expect(body.strategy.missingRequired).toEqual(['PRODUCT_QA']);
    const timeline = await get(`/api/v1/tasks/${BLOCKED}/timeline`);
    const context = timeline.body.stages.find((stage: any) => stage.stage === 'CONTEXT');
    expect(context.status).toBe('ATTENTION');
    expect(context.detail).toContain('MISSING_REQUIRED');
  });

  it('keeps unknown impact as unknown rather than reporting no impact', async () => {
    const { body } = await get(`/api/v1/tasks/${COMPLETED}/impact`);
    expect(body.impactAnalysis.unknowns).toEqual(['app/CrashBeacon.tsx']);
    expect(body.impactAnalysis.confidence).toBe('INFERRED');
  });

  it('keeps todo verdicts UNKNOWN while V&V evidence is whole-run', async () => {
    const { body } = await get(`/api/v1/tasks/${COMPLETED}/todos`);
    for (const status of body.todoStatuses) {
      expect(status.verificationVerdict).toBe('UNKNOWN');
      expect(status.verificationScope).toBe('WHOLE_RUN');
    }
  });

  it('does not report a skipped regression check as passed', async () => {
    const { body } = await get(`/api/v1/tasks/${COMPLETED}/regression`);
    expect(body.regressionPlan.skippedChecks[0].reason.length).toBeGreaterThan(0);
    expect(body.regressionPlan.selectedChecks).not.toContain('e2e');
    expect(body.regressionPlan.unverifiedArtifacts).toContain('app/layout.tsx');
  });

  it('reports a blocked run as BLOCKED and not as a failure', async () => {
    const { body } = await get(`/api/v1/tasks/${BLOCKED}`);
    expect(body.status).toBe('BLOCKED');
    expect(body.liveStatus).toBe('BLOCKED');
    const list = await get('/api/v1/tasks');
    const summary = list.body.tasks.find((task: any) => task.taskId === BLOCKED);
    expect(summary.status).toBe('BLOCKED');
  });

  it('reports missing version evidence instead of rescanning today\'s project', async () => {
    const { body } = await get(`/api/v1/tasks/${BLOCKED}/version`);
    expect(body.available).toBe(false);
    expect(body.versionIntelligence).toBeUndefined();
    const recorded = await get(`/api/v1/tasks/${COMPLETED}/version`);
    expect(recorded.body.versionIntelligence.items[0].normalizedVersion).toBe('14.2.35');
  });
});

describe('Web safety and secret boundaries (H.7, H.20, H.21, H.22)', () => {
  it('never exposes credentials or environment values in any read model', async () => {
    const paths = [
      '/api/v1/capabilities',
      '/api/v1/tasks',
      `/api/v1/tasks/${COMPLETED}`,
      `/api/v1/tasks/${COMPLETED}/context`,
      `/api/v1/tasks/${COMPLETED}/version`,
      `/api/v1/tasks/${COMPLETED}/verification`,
      `/api/v1/tasks/${BLOCKED}`,
    ];
    for (const pathname of paths) {
      const { body } = await get(pathname);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/sk-[a-z0-9]{8}/i);
      expect(serialized).not.toMatch(/authorization:\s*bearer/i);
      expect(serialized).not.toMatch(/password|DATABASE_URL|BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });

  it('surfaces a credential requirement as a blocked run, never as authenticated', async () => {
    const { body } = await get(`/api/v1/tasks/${BLOCKED}`);
    expect(body.abortReason).toContain('REQUIRES_TEST_CREDENTIAL');
    expect(JSON.stringify(body)).not.toContain('AUTHENTICATED');
  });
});

describe('Repeatability and multi-observer safety (H.18, H.23)', () => {
  it('leaves recorded state untouched when the same read is repeated', async () => {
    const first = await get(`/api/v1/tasks/${COMPLETED}`);
    const second = await get(`/api/v1/tasks/${COMPLETED}`);
    const third = await get(`/api/v1/tasks/${COMPLETED}`);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
  });

  it('serves concurrent observers the same snapshot', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => get(`/api/v1/tasks/${COMPLETED}/timeline`)),
    );
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual(results[0].body);
    }
  });

  it('keeps the workspace read-only', async () => {
    const info = await get('/api/v1/workspace');
    expect(info.body.readOnly).toBe(true);
    expect(info.body.workspaceRoot).toBe(root);
    expect(WORKSPACE).not.toBe(root);
  });
});
