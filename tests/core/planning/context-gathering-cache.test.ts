import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { freezeProjectProfile } from '../../../src/domain/project-profile';

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

function skills() {
  return {
    skills: [registry.get('frontend.core')!],
    reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'test' }],
    mode: 'explicit' as const,
  };
}

describe('Context gathering cache', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b2-cache-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export const v = 1;');
    fs.writeFileSync(path.join(dir, 'app', 'other.tsx'), 'export const other = 1;');
    const loader = new FileAiContextLoader();
    const cache = new InMemoryContextCache();
    const gatherer = new TargetedContextGatherer({ cache, aiContextLoader: loader });
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
    return { dir, gatherer, cache, input };
  }

  it('reuses an unchanged file from the existing cache', async () => {
    const { dir, gatherer, cache, input } = await setup();
    const payload = { ...input, workspaceRoot: dir, strategy: builder.build(input) };
    const first = await gatherer.gather(payload);
    const second = await gatherer.gather(payload);
    const firstFile = first.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    const secondFile = second.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(firstFile?.collectionMethod).toBe('WORKSPACE_READ');
    expect(secondFile?.collectionMethod).toBe('CACHE_HIT');
    expect(secondFile?.metadata?.cacheHit).toBe(true);
    expect(cache.getFile(dir, 'app/page.tsx')?.content).toBe(firstFile?.content);
  });

  it('reloads a changed file', async () => {
    const { dir, gatherer, input } = await setup();
    const payload = { ...input, workspaceRoot: dir, strategy: builder.build(input) };
    const first = await gatherer.gather(payload);
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export const v = 2;');
    const second = await gatherer.gather(payload);
    const firstFile = first.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    const secondFile = second.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(firstFile?.content).toContain('v = 1');
    expect(secondFile?.content).toContain('v = 2');
    expect(secondFile?.collectionMethod).toBe('WORKSPACE_READ');
    expect(secondFile?.metadata?.cacheHit).toBe(false);
  });

  it('reuses file metadata when the fingerprint is unchanged', async () => {
    const { dir, gatherer, cache, input } = await setup();
    const payload = { ...input, workspaceRoot: dir, strategy: builder.build(input) };
    await gatherer.gather(payload);
    const stored = cache.getFile(dir, 'app/page.tsx');
    await gatherer.gather(payload);
    const storedAgain = cache.getFile(dir, 'app/page.tsx');
    expect(storedAgain?.fingerprint).toBe(stored?.fingerprint);
    expect(storedAgain?.metadata.modifiedAt).toBe(stored?.metadata.modifiedAt);
  });

  it('invalidates file entries on explicit refresh', async () => {
    const { dir, gatherer, cache, input } = await setup();
    const payload = { ...input, workspaceRoot: dir, strategy: builder.build(input) };
    await gatherer.gather(payload);
    expect(cache.getFile(dir, 'app/page.tsx')).toBeDefined();
    const refreshed = await gatherer.gather({ ...payload, refresh: true });
    const file = refreshed.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(file?.collectionMethod).toBe('WORKSPACE_READ');
    expect(file?.metadata?.cacheHit).toBe(false);
  });

  it('does not invalidate unrelated cached context when another file changes', async () => {
    const { dir, gatherer, cache, input } = await setup();
    const payload = { ...input, workspaceRoot: dir, strategy: builder.build(input) };
    await gatherer.gather(payload);
    const before = cache.getFile(dir, 'app/page.tsx');
    fs.writeFileSync(path.join(dir, 'app', 'other.tsx'), 'export const other = 2;');
    const second = await gatherer.gather(payload);
    const page = second.records.find(record =>
      record.source === 'SOURCE_FILES' && record.reference.replace(/\\/g, '/').endsWith('app/page.tsx'),
    );
    expect(page?.collectionMethod).toBe('CACHE_HIT');
    expect(cache.getFile(dir, 'app/page.tsx')?.fingerprint).toBe(before?.fingerprint);
  });
});
