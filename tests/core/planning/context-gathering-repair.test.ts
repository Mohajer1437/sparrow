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

const registry = createDefaultSkillRegistry();
const builder = new PlannerContextStrategyBuilder();

describe('Repair context gathering', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collects primary and relevant secondary context without turning incidental failures into file targets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b2-repair-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth', 'middleware.ts'), 'export const middleware = () => {};');
    fs.writeFileSync(path.join(dir, 'src', 'noise.ts'), 'export const noise = 1;');
    const loader = new FileAiContextLoader();
    const gatherer = new TargetedContextGatherer({
      cache: new InMemoryContextCache(),
      aiContextLoader: loader,
    });
    const failureContract: FailureContract = {
      id: 'fail-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      qualityProfile: 'STANDARD',
      summary: 'spinner still visible',
      failedChecks: [
        {
          id: 'check-spinner',
          name: 'spinner',
          category: 'browser',
          severity: 'HIGH',
          passed: false,
          evidence: 'still visible',
        },
        {
          id: 'check-related',
          name: 'related',
          category: 'browser',
          severity: 'MEDIUM',
          passed: false,
          evidence: 'src/auth/middleware.ts still loading',
        },
        {
          id: 'check-console',
          name: 'console',
          category: 'deterministic',
          severity: 'LOW',
          passed: false,
          evidence: 'src/noise.ts warning',
        },
      ],
      acceptanceCriteria: [],
      repairInstructions: 'hide spinner in src/auth/middleware.ts',
      attempt: 2,
      location: { file: 'src/auth/middleware.ts' },
      primaryFailure: {
        role: 'PRIMARY',
        check: {
          id: 'check-spinner',
          name: 'spinner',
          category: 'browser',
          severity: 'HIGH',
          passed: false,
          evidence: 'still visible',
        },
        category: 'ui',
        expectedBehavior: 'hidden',
        actualBehavior: 'visible',
        requiredOutcome: 'hide spinner',
      },
      incidentalFailures: [{
        role: 'INCIDENTAL',
        check: {
          id: 'check-console',
          name: 'console',
          category: 'deterministic',
          severity: 'LOW',
          passed: false,
          evidence: 'src/noise.ts warning',
        },
        category: 'noise',
        severity: 'LOW',
        evidence: 'src/noise.ts warning',
      }],
    };
    const input = {
      userTask: 'Original login task',
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
      resolvedSkills: {
        skills: [registry.get('frontend.core')!],
        reasons: [{ skillId: 'frontend.core', source: 'explicit' as const, detail: 'test' }],
        mode: 'explicit' as const,
      },
      failureContract: {
        id: 'fail-1',
        summary: 'spinner still visible',
        primaryFailureId: 'check-spinner',
        incidentalCount: 1,
      },
      aiContext: await loader.discover(dir),
    };

    const gathered = await gatherer.gather({
      ...input,
      workspaceRoot: dir,
      strategy: builder.build(input),
      failureContract,
    });

    const primary = gathered.records.find(record => record.metadata?.failureRole === 'PRIMARY');
    const secondary = gathered.records.find(record => record.metadata?.failureRole === 'RELEVANT_SECONDARY');
    const incidental = gathered.records.find(record => record.metadata?.failureRole === 'INCIDENTAL');
    expect(primary?.status).toBe('COLLECTED');
    expect(primary?.content).toMatch(/PRIMARY FAILURE/);
    expect(primary?.content).toMatch(/Attempt/i);
    expect(secondary?.status).toBe('COLLECTED');
    expect(incidental?.status).toBe('COLLECTED');
    expect(incidental?.reason).toMatch(/not used as a file search target/i);

    const collectedFiles = gathered.records.filter(record =>
      record.source === 'SOURCE_FILES' && record.status === 'COLLECTED',
    );
    expect(collectedFiles.some(record => record.reference.replace(/\\/g, '/').includes('src/auth/middleware.ts'))).toBe(true);
    expect(collectedFiles.some(record => record.reference.replace(/\\/g, '/').includes('src/noise.ts'))).toBe(false);
  });
});
