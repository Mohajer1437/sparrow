import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DefaultPlannerContextPreparationService } from '../../../src/core/planning/planner-context-preparation-service';
import { TargetedContextGatherer } from '../../../src/core/planning/targeted-context-gatherer';
import { DefaultProjectContextService } from '../../../src/core/project/default-project-context-service';
import { FileAiContextLoader } from '../../../src/core/project/file-ai-context-loader';
import { FilesystemProjectFingerprinter } from '../../../src/core/project/filesystem-project-fingerprinter';
import { InMemoryContextCache } from '../../../src/core/project/in-memory-context-cache';
import { NodeProjectDetector } from '../../../src/core/project/node-project-detector';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';
import { DeterministicSkillResolver } from '../../../src/core/skill/deterministic-skill-resolver';

function makeService() {
  const cache = new InMemoryContextCache();
  const aiLoader = new FileAiContextLoader();
  return new DefaultPlannerContextPreparationService(
    new DefaultProjectContextService(
      new NodeProjectDetector(),
      aiLoader,
      cache,
      new FilesystemProjectFingerprinter(),
    ),
    new DeterministicSkillResolver(createDefaultSkillRegistry()),
    new TargetedContextGatherer({ cache, aiContextLoader: aiLoader }),
  );
}

describe('PlannerContextPreparationService', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads Milestone A project intelligence and resolves frontend skills', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b1-prep-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { next: '14.2.0' },
    }));
    fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });

    const context = await makeService().prepare({
      userTask: 'Fix login page loading state',
      workspaceRoot: dir,
      productQa: {
        objective: 'Login loading is honest',
        acceptanceCriteria: ['Spinner hides'],
        verificationRequirements: [],
      },
    });

    expect(context.projectProfile.detectedFrameworks).toEqual(['nextjs']);
    expect(context.resolvedSkills.skills.map(s => s.id)).toContain('frontend.core');
    expect(context.strategy.selectedSources).toEqual(
      expect.arrayContaining(['USER_TASK', 'PRODUCT_QA', 'PROJECT_METADATA', 'SOURCE_FILES']),
    );
    expect(context.gathered.records.some(record => record.source === 'USER_TASK' && record.status === 'COLLECTED')).toBe(true);
    expect(context.gathered.records.some(record => record.source === 'PROJECT_METADATA' && record.status === 'COLLECTED')).toBe(true);
    expect(context.repairMode).toBe(false);
  });

  it('honors an explicit skill directive even on a frontend project', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b1-dir-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { next: '14.2.0' },
    }));

    const context = await makeService().prepare({
      userTask: 'Inspect API module layout',
      workspaceRoot: dir,
      executionDirective: { explicitSkillIds: ['backend.core'] },
    });

    expect(context.resolvedSkills.mode).toBe('explicit');
    expect(context.resolvedSkills.skills.map(s => s.id)).toEqual(['backend.core']);
    expect(context.strategy.deferredSources).toContain('CODEBASE_MAP');
    expect(context.gathered.records.find(record => record.source === 'CODEBASE_MAP')?.status).toBe('DEFERRED');
  });

  it('maps a Failure Contract onto repair-aware strategy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparrow-b1-repair-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { next: '14.2.0' },
    }));

    const context = await makeService().prepare({
      userTask: 'Original login task',
      workspaceRoot: dir,
      failureContract: {
        id: 'fail-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        qualityProfile: 'STANDARD',
        summary: 'spinner still visible',
        failedChecks: [],
        acceptanceCriteria: [],
        repairInstructions: 'hide spinner',
        attempt: 1,
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
            evidence: 'warning',
          },
          category: 'noise',
          severity: 'LOW',
          evidence: 'warning',
        }],
      },
    });

    expect(context.repairMode).toBe(true);
    expect(context.failureContract?.primaryFailureId).toBe('check-spinner');
    expect(context.failureContract?.incidentalCount).toBe(1);
    expect(context.strategy.selectedSources).toContain('FAILURE_CONTRACT');
    expect(context.gathered.records.find(record => record.metadata?.failureRole === 'PRIMARY')?.status).toBe('COLLECTED');
    expect(context.gathered.records.find(record => record.metadata?.failureRole === 'INCIDENTAL')?.reason).toMatch(/not used as a file search target/);
    expect(context.strategy.requiredSources).not.toContain('CODEBASE_MAP');
  });
});
