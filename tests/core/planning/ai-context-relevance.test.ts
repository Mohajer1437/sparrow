import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
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

async function workspaceWithAi() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b2-ai-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'web',
    dependencies: { next: '14.2.0' },
  }));
  fs.mkdirSync(path.join(dir, '.ai', 'project'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ai', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ai', 'backend'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ai', 'history'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai', 'project', 'architecture.md'), '# architecture\nKeep UI honest.');
  fs.writeFileSync(path.join(dir, '.ai', 'frontend', 'auth.md'), '# frontend auth\nUse middleware.');
  fs.writeFileSync(path.join(dir, '.ai', 'backend', 'auth.md'), '# backend auth\nJWT only.');
  fs.writeFileSync(path.join(dir, '.ai', 'unrelated-ui.md'), '# unrelated ui notes');
  fs.writeFileSync(path.join(dir, '.ai', 'history', 'random-note.md'), '# random history');
  fs.writeFileSync(path.join(dir, '.ai', 'frontend.md'), '# frontend core');
  const loader = new FileAiContextLoader();
  const cache = new InMemoryContextCache();
  return {
    dir,
    gatherer: new TargetedContextGatherer({ cache, aiContextLoader: loader }),
    aiContext: await loader.discover(dir),
  };
}

describe('.ai relevance gathering', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('selects relevant frontend context and ignores unrelated documents', async () => {
    const { dir, gatherer, aiContext } = await workspaceWithAi();
    dirs.push(dir);
    const input = {
      userTask: 'Fix authentication middleware',
      executionDirective: { requestedDomains: ['frontend' as const] },
      projectProfile: freezeProjectProfile({
        workspaceRoot: dir,
        projectType: 'frontend' as const,
        detectedFrameworks: ['nextjs'],
        languages: ['typescript'],
        packageManager: 'npm' as const,
        availableTestingTools: [],
        detectedDomains: ['frontend' as const],
        capabilities: ['frontend', 'nextjs'],
      }),
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const strategy = builder.build(input);
    const gathered = await gatherer.gather({ ...input, workspaceRoot: dir, strategy });
    const aiRecords = gathered.records.filter(record => record.source === 'AI_CONTEXT' && record.status === 'COLLECTED');
    const refs = aiRecords.map(record => record.reference.replace(/\\/g, '/'));

    expect(refs.some(ref => ref.includes('frontend/auth.md') || ref.endsWith('frontend.md'))).toBe(true);
    expect(refs.some(ref => ref.includes('architecture.md'))).toBe(true);
    expect(refs.some(ref => ref.includes('backend/auth.md'))).toBe(false);
    expect(refs.some(ref => ref.includes('unrelated-ui.md'))).toBe(false);
    expect(refs.some(ref => ref.includes('random-note.md'))).toBe(false);
    expect(aiRecords.every(record => record.reason.length > 0)).toBe(true);
  });

  it('selects relevant backend context when backend.core is resolved', async () => {
    const { dir, gatherer, aiContext } = await workspaceWithAi();
    dirs.push(dir);
    const input = {
      userTask: 'Fix authentication middleware on the API',
      executionDirective: { explicitSkillIds: ['backend.core'] },
      projectProfile: freezeProjectProfile({
        workspaceRoot: dir,
        projectType: 'backend' as const,
        detectedFrameworks: ['nestjs'],
        languages: ['typescript'],
        packageManager: 'npm' as const,
        availableTestingTools: [],
        detectedDomains: ['backend' as const],
        capabilities: ['backend'],
      }),
      resolvedSkills: skills(['backend.core']),
      aiContext,
    };
    const strategy = builder.build(input);
    const gathered = await gatherer.gather({ ...input, workspaceRoot: dir, strategy });
    const refs = gathered.records
      .filter(record => record.source === 'AI_CONTEXT' && record.status === 'COLLECTED')
      .map(record => record.reference.replace(/\\/g, '/'));
    expect(refs.some(ref => ref.includes('backend/auth.md'))).toBe(true);
    expect(refs.some(ref => ref.includes('frontend/auth.md'))).toBe(false);
  });

  it('lets task signals influence selection and is deterministic', async () => {
    const { dir, gatherer, aiContext } = await workspaceWithAi();
    dirs.push(dir);
    const input = {
      userTask: 'Document architecture conventions',
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
      resolvedSkills: skills(['frontend.core']),
      aiContext,
    };
    const strategy = builder.build(input);
    const payload = { ...input, workspaceRoot: dir, strategy };
    const first = await gatherer.gather(payload);
    const second = await gatherer.gather(payload);
    const firstRefs = first.records.filter(record => record.source === 'AI_CONTEXT').map(record => record.reference);
    const arch = first.records.find(record => record.reference.replace(/\\/g, '/').includes('architecture.md'));
    expect(arch?.status).toBe('COLLECTED');
    expect(arch?.reason).toMatch(/architecture|project/i);
    expect(firstRefs).toEqual(
      second.records.filter(record => record.source === 'AI_CONTEXT').map(record => record.reference),
    );
  });
});
