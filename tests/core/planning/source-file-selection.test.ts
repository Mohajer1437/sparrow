import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { FailureContract } from '../../../src/domain/failure-contract';
import { SkillResolution } from '../../../src/contracts/skill-resolver';

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

function skills(ids: string[]): SkillResolution {
  return {
    skills: ids.map(id => registry.get(id)!),
    reasons: ids.map(id => ({ skillId: id, source: 'explicit' as const, detail: 'test' })),
    mode: 'explicit',
  };
}

function profile(root: string) {
  return freezeProjectProfile({
    workspaceRoot: root,
    projectType: 'frontend',
    detectedFrameworks: ['nextjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: ['jest'],
    detectedDomains: ['frontend'],
    capabilities: ['frontend', 'nextjs'],
  });
}

async function makeProject(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b2-src-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const loader = new FileAiContextLoader();
  const cache = new InMemoryContextCache();
  return {
    dir,
    gatherer: new TargetedContextGatherer({ cache, aiContextLoader: loader }),
    cache,
    aiContext: await loader.discover(dir),
  };
}

describe('Source file selection', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('selects an explicitly mentioned file as priority 1', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'app/page.tsx': 'export default function Page() { return <div>hi</div>; }',
      'app/unrelated.tsx': 'export default function Unrelated() { return null; }',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Inspect app/page.tsx and determine how its UI state is constructed',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const page = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(page?.status).toBe('COLLECTED');
    expect(page?.priority).toBe(1);
    expect(page?.reason).toMatch(/explicitly referenced by task/i);
    expect(gathered.records.some(record =>
      record.source === 'SOURCE_FILES'
      && record.status === 'COLLECTED'
      && record.reference.replace(/\\/g, '/').includes('unrelated'),
    )).toBe(false);
  });

  it('selects a Product QA mentioned file', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'src/auth/middleware.ts': 'export const middleware = () => {};',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Fix login',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      productQa: {
        objective: 'Keep src/auth/middleware.ts honest',
        acceptanceCriteria: ['middleware hides spinner'],
        verificationRequirements: [],
      },
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const file = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').includes('src/auth/middleware.ts'),
    );
    expect(file?.status).toBe('COLLECTED');
    expect(file?.reason).toMatch(/Product QA/i);
  });

  it('selects a Failure Contract referenced file and reports nonexistent candidates', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'middleware.ts': 'export default function middleware() {}',
    });
    dirs.push(dir);
    const failureContract: FailureContract = {
      id: 'fail-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      qualityProfile: 'STANDARD',
      summary: 'login still broken',
      failedChecks: [],
      acceptanceCriteria: [],
      repairInstructions: 'fix it',
      attempt: 1,
      location: { file: 'middleware.ts' },
      implicatedFiles: ['does-not-exist.ts'],
      primaryFailure: {
        role: 'PRIMARY',
        check: {
          id: 'check-login',
          name: 'login',
          category: 'browser',
          severity: 'HIGH',
          passed: false,
          evidence: 'visible',
        },
        category: 'ui',
        expectedBehavior: 'hidden',
        actualBehavior: 'visible',
        requiredOutcome: 'hide spinner',
      },
    };
    const input = {
      userTask: 'Repair login',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      failureContract: {
        id: 'fail-1',
        summary: 'login still broken',
        primaryFailureId: 'check-login',
        incidentalCount: 0,
      },
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
      failureContract,
    });
    const existing = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('middleware.ts') && record.status === 'COLLECTED',
    );
    const missing = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').includes('does-not-exist.ts'),
    );
    expect(existing?.reason).toMatch(/primary failure/i);
    expect(missing?.status).toBe('MISSING_OPTIONAL');
    expect(missing?.metadata?.candidateUnresolved).toBe(true);
  });

  it('ranks candidates deterministically and does not replace missing files with unrelated ones', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'middleware.ts': 'export const mw = 1;',
      'src/auth/session.ts': 'export const session = 1;',
      'app/login/page.tsx': 'export default function Login() { return null; }',
      'app/unrelated-ui.tsx': 'export default function Unrelated() { return null; }',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Fix login middleware',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const collected = gathered.records.filter(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    const refs = collected.map(record => record.reference.replace(/\\/g, '/'));
    expect(refs.some(ref => ref.endsWith('middleware.ts'))).toBe(true);
    expect(collected.every(record => record.reason.length > 0)).toBe(true);
    expect(refs.some(ref => ref.includes('unrelated-ui'))).toBe(false);
    const again = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    expect(collected.map(record => record.reference)).toEqual(
      again.records.filter(record => record.source === 'SOURCE_FILES' && record.status === 'COLLECTED').map(record => record.reference),
    );
  });

  it('enforces bounded file count and byte count without silent skips', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'a.ts': 'aaaa',
      'b.ts': 'bbbb',
      'c.ts': 'cccc',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Inspect a.ts and b.ts and c.ts',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
      limits: { maxFiles: 1, maxBytes: 10, maxFileBytes: 8, maxTotalContextBytes: 5000 },
    });
    const sourceRecords = gathered.records.filter(record => record.source === 'SOURCE_FILES');
    expect(sourceRecords.some(record => record.status === 'COLLECTED')).toBe(true);
    expect(sourceRecords.some(record => record.status === 'LIMIT_REACHED')).toBe(true);
    expect(gathered.limitReached).toBe(true);
    expect(sourceRecords.filter(record => record.status === 'COLLECTED').length).toBeLessThanOrEqual(1);
  });

  it('records truncation for very large files', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'huge.ts': 'x'.repeat(5000),
    });
    dirs.push(dir);
    const input = {
      userTask: 'Inspect huge.ts',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
      limits: { maxFiles: 5, maxBytes: 2000, maxFileBytes: 100, maxTotalContextBytes: 5000 },
    });
    const huge = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('huge.ts'),
    );
    expect(huge?.status).toBe('COLLECTED');
    expect(huge?.truncated).toBe(true);
    expect((huge?.content ?? '').length).toBeLessThan(5000);
  });

  it('deduplicates duplicate candidates', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'app/page.tsx': 'export default function Page() { return null; }',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Inspect app/page.tsx and also look at app/page.tsx again',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      productQa: {
        objective: 'app/page.tsx should render',
        acceptanceCriteria: [],
        verificationRequirements: [],
      },
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const pages = gathered.records.filter(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(pages).toHaveLength(1);
  });

  it('does not treat framework names like Next.js as source files', async () => {
    const { dir, gatherer, aiContext } = await makeProject({
      'middleware.ts': 'export const mw = 1;',
    });
    dirs.push(dir);
    const input = {
      userTask: 'Inspect the login implementation in this Next.js project',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const nextJs = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && /next\.js/i.test(record.reference),
    );
    expect(nextJs).toBeUndefined();
    const middleware = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('middleware.ts'),
    );
    expect(middleware?.status).toBe('COLLECTED');
  });
});
