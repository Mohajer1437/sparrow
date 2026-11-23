import { DefaultImpactAnalyzer } from '../../../src/core/impact-analysis/default-impact-analyzer';
import { Workspace } from '../../../src/contracts/workspace';
import { WorkspaceMemory } from '../../../src/contracts/workspace-memory';
import { WorkspaceKnowledge } from '../../../src/domain/workspace-knowledge';

describe('DefaultImpactAnalyzer', () => {
  let mockWorkspace: jest.Mocked<Workspace>;
  let mockWorkspaceMemory: jest.Mocked<WorkspaceMemory>;
  let analyzer: DefaultImpactAnalyzer;

  const mockKnowledge: WorkspaceKnowledge = {
    architecturalMap: {
      meta: { project_name: 'test', architecture_style: 'clean', generated_at: '' },
      system_overview: { description: '', core_modules: [] },
      module_map: [
        { module_name: 'Core', directory_path: 'src/core', purpose: '', files: [] },
        { module_name: 'Domain', directory_path: 'src/domain', purpose: '', files: [] },
      ],
    },
    codebaseMap: null,
    knowledgeBase: null,
    loadedAt: '',
    isEmpty: false,
  };

  beforeEach(() => {
    mockWorkspace = {
      exists: jest.fn(),
      readFile: jest.fn(),
      listFiles: jest.fn(),
    } as any;
    mockWorkspaceMemory = {
      load: jest.fn().mockResolvedValue(mockKnowledge),
    } as any;
    analyzer = new DefaultImpactAnalyzer(mockWorkspace, mockWorkspaceMemory);
  });

  it('returns empty report for non-existent target', async () => {
    mockWorkspace.exists.mockResolvedValue(false);
    const report = await analyzer.analyze(['src/missing.ts']);
    expect(report.targets).toHaveLength(1);
    expect(report.directImpacts).toHaveLength(0);
    expect(report.indirectImpacts).toHaveLength(0);
  });

  it('analyzes single file and finds direct imports', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => p === 'src/core/a.ts' || p === 'src/domain/b.ts');
    mockWorkspace.readFile.mockResolvedValue("import { B } from '../domain/b';");
    mockWorkspace.listFiles.mockResolvedValue([]);

    const report = await analyzer.analyze(['src/core/a.ts']);
    expect(report.directImpacts).toContain('src/domain/b.ts');
    expect(report.architecturalBoundariesCrossed).toContain('Core->Domain');
  });

  it('analyzes multiple target files', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => p === 'src/core/a.ts' || p === 'src/core/c.ts');
    mockWorkspace.readFile.mockResolvedValue("import { D } from '../domain/d';");
    mockWorkspace.listFiles.mockResolvedValue([]);

    const report = await analyzer.analyze(['src/core/a.ts', 'src/core/c.ts']);
    expect(report.targets).toHaveLength(2);
  });

  it('finds indirect impacts by scanning workspace', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => p === 'src/core/a.ts' || p === 'src/core/b.ts' || p === 'src/domain/c.ts');
    mockWorkspace.readFile.mockImplementation(async (p: string) => {
      if (p === 'src/core/a.ts') return "import { C } from '../domain/c';";
      if (p === 'src/core/b.ts') return "import { A } from './a';";
      return "";
    });
    mockWorkspace.listFiles.mockResolvedValue(['src/core/b.ts']);

    const report = await analyzer.analyze(['src/core/a.ts']);
    expect(report.directImpacts).toContain('src/domain/c.ts');
    expect(report.indirectImpacts).toContain('src/core/b.ts');
  });

  it('identifies related tests', async () => {
    mockWorkspace.exists.mockImplementation(async (p: string) => p === 'src/core/a.ts' || p === 'src/core/a.test.ts');
    mockWorkspace.readFile.mockResolvedValue("");
    mockWorkspace.listFiles.mockResolvedValue([]);

    const report = await analyzer.analyze(['src/core/a.ts']);
    expect(report.relatedTests).toContain('src/core/a.test.ts');
  });

  it('is fail-safe when workspace operations fail', async () => {
    mockWorkspace.exists.mockRejectedValue(new Error('Disk error'));
    const report = await analyzer.analyze(['src/core/a.ts']);
    expect(report.directImpacts).toHaveLength(0);
    expect(report.indirectImpacts).toHaveLength(0);
  });
});
