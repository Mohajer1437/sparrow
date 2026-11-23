import { DefaultReviewer } from '../../../src/core/review/default-reviewer';
import { Workspace } from '../../../src/contracts/workspace';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';
import { WorkspaceKnowledge } from '../../../src/domain/workspace-knowledge';
import { ImpactReport } from '../../../src/domain/impact-analysis';

describe('DefaultReviewer', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let mockWorkspaceMemory: jest.Mocked<WorkspaceMemory>;
  let reviewer: DefaultReviewer;

  const mockKnowledge: WorkspaceKnowledge = {
    architecturalMap: null,
    codebaseMap: null,
    knowledgeBase: null,
    loadedAt: '',
    isEmpty: true,
  };

  beforeEach(() => {
    mockWorkspace = {
      exists: jest.fn(),
      readFile: jest.fn(),
    } as any;
    mockWorkspaceMemory = {
      load: jest.fn().mockResolvedValue(mockKnowledge),
    } as any;
    reviewer = new DefaultReviewer(mockWorkspace, mockWorkspaceMemory);
  });

  it('passes a clean patch', async () => {
    mockWorkspace.exists.mockResolvedValue(true);
    mockWorkspace.readFile.mockResolvedValue("import { A } from '../domain/a';");
    
    const report = await reviewer.review({ modifiedFiles: ['src/core/service.ts'] });
    expect(report.failedCount).toBe(0);
    expect(report.passedCount).toBeGreaterThan(0);
  });

  it('fails on protected file modification', async () => {
    const report = await reviewer.review({ modifiedFiles: ['package.json'] });
    const check = report.checks.find(c => c.ruleId === 'PROT_01');
    expect(check?.status).toBe('FAILED');
    expect(check!.evidence.length).toBeGreaterThan(0);
  });

  it('fails on generated file modification', async () => {
    const report = await reviewer.review({ modifiedFiles: ['.ai/knowledge/architectural-map.json'] });
    const check = report.checks.find(c => c.ruleId === 'GEN_01');
    expect(check?.status).toBe('FAILED');
  });

  it('fails on clean architecture violation (Domain -> Core)', async () => {
    mockWorkspace.exists.mockResolvedValue(true);
    mockWorkspace.readFile.mockResolvedValue("import { C } from '../core/c';");
    
    const report = await reviewer.review({ modifiedFiles: ['src/domain/entity.ts'] });
    const check = report.checks.find(c => c.ruleId === 'ARCH_01');
    expect(check?.status).toBe('FAILED');
    expect(check!.evidence[0].source).toContain('src/domain/');
    expect(check!.evidence[0].target).toContain('src/core/');
  });

  it('fails on scope violation', async () => {
    const report = await reviewer.review({
      modifiedFiles: ['src/core/out-of-scope.ts'],
      plannedScope: ['src/domain/']
    });
    const check = report.checks.find(c => c.ruleId === 'SCOPE_01');
    expect(check?.status).toBe('FAILED');
  });

  it('warns on missing verification scope', async () => {
    const impactReport: ImpactReport = {
      targets: [],
      directImpacts: [],
      indirectImpacts: [],
      affectedModules: [],
      relatedTests: [],
      verificationScope: ['src/domain/a.ts'],
      architecturalBoundariesCrossed: [],
      evidence: [],
      generatedAt: ''
    };
    
    const report = await reviewer.review(
      { modifiedFiles: ['src/core/b.ts'] },
      impactReport
    );
    const check = report.checks.find(c => c.ruleId === 'VERIF_01');
    expect(check?.status).toBe('WARNING');
  });

  it('marks check as NOT_EVALUATED if info is missing', async () => {
    const report = await reviewer.review({ modifiedFiles: ['src/core/a.ts'] });
    const scopeCheck = report.checks.find(c => c.ruleId === 'SCOPE_01');
    expect(scopeCheck?.status).toBe('NOT_EVALUATED');
  });

  it('is fail-safe when workspace operations fail', async () => {
    mockWorkspace.exists.mockRejectedValue(new Error('Disk error'));
    const report = await reviewer.review({ modifiedFiles: ['src/core/a.ts'] });
    expect(report.checks).toBeDefined();
    expect(report.failedCount).toBe(0);
  });
});
