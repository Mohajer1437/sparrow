import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { ContextStrategyInput } from '../../../src/contracts/context-strategy';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
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

async function prepareWorkspace(prefix: string, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const loader = new FileAiContextLoader();
  const cache = new InMemoryContextCache();
  const gatherer = new TargetedContextGatherer({ cache, aiContextLoader: loader });
  const aiContext = await loader.discover(dir);
  return { dir, gatherer, cache, loader, aiContext };
}

function gatheringPayload(input: ContextStrategyInput, workspaceRoot: string) {
  return {
    workspaceRoot,
    userTask: input.userTask,
    executionDirective: input.executionDirective,
    projectProfile: input.projectProfile,
    resolvedSkills: input.resolvedSkills,
    strategy: builder.build(input),
    aiContext: input.aiContext,
    productQa: input.productQa,
  };
}

describe('TargetedContextGatherer source gathering', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes user task, product QA, and project metadata without rereading files', async () => {
    const { dir, gatherer, aiContext } = await prepareWorkspace('sparrow-b2-norm-', {
      'package.json': '{"name":"web"}',
    });
    dirs.push(dir);

    const input: ContextStrategyInput = {
      userTask: 'Inspect the login page',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      productQa: {
        objective: 'Login loading is honest',
        acceptanceCriteria: ['Spinner hides'],
        verificationRequirements: ['browser'],
      },
      aiContext,
    };
    const gathered = await gatherer.gather(gatheringPayload(input, dir));

    const userTask = gathered.records.find(record => record.source === 'USER_TASK');
    const qa = gathered.records.find(record => record.source === 'PRODUCT_QA');
    const meta = gathered.records.find(record => record.source === 'PROJECT_METADATA');
    expect(userTask?.status).toBe('COLLECTED');
    expect(userTask?.collectionMethod).toBe('NORMALIZED_INPUT');
    expect(userTask?.content).toContain('Inspect the login page');
    expect(qa?.status).toBe('COLLECTED');
    expect(qa?.content).toContain('Spinner hides');
    expect(meta?.status).toBe('COLLECTED');
    expect(meta?.metadata?.projectType).toBe('frontend');
    expect(meta?.metadata?.frameworks).toContain('nextjs');
    expect(meta?.content).toContain(dir);
  });

  it('does not gather excluded or deferred sources', async () => {
    const { dir, gatherer, aiContext } = await prepareWorkspace('sparrow-b2-skip-', {
      'package.json': '{"name":"web"}',
    });
    dirs.push(dir);

    const input: ContextStrategyInput = {
      userTask: 'Inspect login',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather(gatheringPayload(input, dir));

    const failure = gathered.records.find(record => record.source === 'FAILURE_CONTRACT');
    const codebase = gathered.records.find(record => record.source === 'CODEBASE_MAP');
    expect(failure?.status).toBe('EXCLUDED');
    expect(failure?.content).toBeUndefined();
    expect(codebase?.status).toBe('EXCLUDED');
    expect(codebase?.content).toBeUndefined();
  });

  it('does not force a deferred codebase map into memory', async () => {
    const { dir, gatherer, aiContext } = await prepareWorkspace('sparrow-b2-defer-', {
      'package.json': '{"name":"api","dependencies":{"@nestjs/core":"10.0.0"}}',
    });
    dirs.push(dir);
    const input: ContextStrategyInput = {
      userTask: 'Inspect API module layout',
      executionDirective: { explicitSkillIds: ['backend.core'] },
      projectProfile: freezeProjectProfile({
        ...profile(dir),
        projectType: 'backend',
        detectedFrameworks: ['nestjs'],
        detectedDomains: ['backend'],
        capabilities: ['backend'],
      }),
      resolvedSkills: skills(['backend.core']),
      aiContext,
    };
    const gathered = await gatherer.gather(gatheringPayload(input, dir));
    const codebase = gathered.records.find(record => record.source === 'CODEBASE_MAP');
    expect(codebase?.status).toBe('DEFERRED');
    expect(codebase?.content).toBeUndefined();
  });

  it('is deterministic across repeated gathering', async () => {
    const { dir, gatherer, aiContext } = await prepareWorkspace('sparrow-b2-det-', {
      'app/page.tsx': 'export default function Page() { return null; }',
    });
    dirs.push(dir);
    const input: ContextStrategyInput = {
      userTask: 'Inspect app/page.tsx',
      executionDirective: {},
      projectProfile: profile(dir),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const payload = gatheringPayload(input, dir);
    const first = await gatherer.gather(payload);
    const second = await gatherer.gather(payload);
    expect(first.records.map(record => `${record.source}:${record.reference}:${record.status}`))
      .toEqual(second.records.map(record => `${record.source}:${record.reference}:${record.status}`));
  });

  it('handles empty inputs without inventing content', async () => {
    const { dir, gatherer } = await prepareWorkspace('sparrow-b2-empty-', {});
    dirs.push(dir);
    const input: ContextStrategyInput = {
      userTask: '   ',
      executionDirective: {},
      projectProfile: freezeProjectProfile({
        ...profile(dir),
        projectType: 'unknown',
        detectedFrameworks: [],
        detectedDomains: [],
        capabilities: [],
      }),
      resolvedSkills: { skills: [], reasons: [], mode: 'rules' },
      aiContext: freezeAiContextDiscovery({
        workspaceRoot: dir,
        rootPath: path.join(dir, '.ai'),
        exists: false,
        files: [],
      }),
    };
    const gathered = await gatherer.gather(gatheringPayload(input, dir));
    expect(gathered.records.find(record => record.source === 'USER_TASK')?.status).toBe('MISSING_REQUIRED');
    expect(gathered.records.find(record => record.source === 'SOURCE_FILES')?.status).toBe('EXCLUDED');
    expect(gathered.records.every(record => record.status !== 'COLLECTED' || record.content !== undefined)).toBe(true);
  });
});
