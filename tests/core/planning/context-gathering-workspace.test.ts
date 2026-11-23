import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { WorkspacePathError } from '../../../src/core/workspace/workspace-paths';

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

function skills() {
  return {
    skills: [registry.get('frontend.core')!],
    reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'test' }],
    mode: 'explicit' as const,
  };
}

describe('Context gathering workspace safety', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b2-ws-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'app-page.tsx'), 'not the target');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return null; }');
    const loader = new FileAiContextLoader();
    const gatherer = new TargetedContextGatherer({
      cache: new InMemoryContextCache(),
      aiContextLoader: loader,
    });
    const aiContext = await loader.discover(dir);
    const input = {
      userTask: 'Inspect app/page.tsx',
      executionDirective: {},
      projectProfile: freezeProjectProfile({
        workspaceRoot: dir,
        projectType: 'frontend' as const,
        detectedFrameworks: ['nextjs'],
        languages: ['typescript'],
        packageManager: 'npm' as const,
        availableTestingTools: [],
        detectedDomains: ['frontend' as const],
        capabilities: ['frontend'],
      }),
      resolvedSkills: skills(),
      aiContext,
    };
    return { dir, gatherer, input };
  }

  it('resolves a relative path against the task workspace', async () => {
    const { dir, gatherer, input } = await setup();
    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
    });
    const file = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    expect(gathered.workspaceRoot).toBe(path.resolve(dir));
    expect(file?.reference.replace(/\\/g, '/')).toBe('app/page.tsx');
    expect(file?.metadata?.workspaceRoot).toBe(path.resolve(dir));
  });

  it('accepts an absolute path inside the workspace', async () => {
    const { dir, gatherer, input } = await setup();
    const absolute = path.join(dir, 'app', 'page.tsx');
    const nextInput = { ...input, userTask: `Inspect ${absolute}` };
    const gathered = await gatherer.gather({
      ...nextInput,
      workspaceRoot: dir,
      strategy: builder.build(nextInput),
    });
    const file = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    expect(file?.reference.replace(/\\/g, '/')).toBe('app/page.tsx');
    expect(file?.content).toContain('export default function Page');
  });

  it('accepts Windows separators', async () => {
    const { dir, gatherer, input } = await setup();
    const nextInput = { ...input, userTask: 'Inspect app\\page.tsx' };
    const gathered = await gatherer.gather({
      ...nextInput,
      workspaceRoot: dir,
      strategy: builder.build(nextInput),
    });
    const file = gathered.records.find(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    expect(file?.reference.replace(/\\/g, '/')).toBe('app/page.tsx');
  });

  it('rejects traversal and does not fall back to the Sparrow installation directory', async () => {
    const { dir, gatherer, input } = await setup();
    const nextInput = { ...input, userTask: 'Inspect ../../package.json and ../secret.ts' };
    const gathered = await gatherer.gather({
      ...nextInput,
      workspaceRoot: dir,
      strategy: builder.build(nextInput),
    });
    const failed = gathered.records.filter(record =>
      record.source === 'SOURCE_FILES' && (record.status === 'FAILED' || record.error),
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some(record => (record.error ?? '').includes('traversal') || record.status === 'FAILED')).toBe(true);
    const collected = gathered.records.filter(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    expect(collected.every(record => {
      const abs = path.resolve(dir, record.reference);
      return abs.startsWith(path.resolve(dir));
    })).toBe(true);
    expect(WorkspacePathError).toBeDefined();
  });
});
