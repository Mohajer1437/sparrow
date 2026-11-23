import { DefaultPreflightAnalyzer } from '../../../src/core/pre-execution/preflight-analyzer';
import { LocalWorkspace } from '../../../src/core/workspace/local-workspace';
import path from 'path';

describe('DefaultPreflightAnalyzer', () => {
  let analyzer: DefaultPreflightAnalyzer;
  let workspace: LocalWorkspace;

  let workspacePath: string;

  beforeEach(() => {
    workspacePath = path.resolve(__dirname, '../../..');
    workspace = new LocalWorkspace(workspacePath);
    analyzer = new DefaultPreflightAnalyzer(workspace, workspacePath);
  });

  describe('analyze', () => {
    it('should return inspection result with framework detection', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'test', type: 'FEATURE', mode: 'MEDIUM',
        objective: 'test', initialScope: [], symptoms: [], knownErrors: [],
        constraints: [], successCriteria: [], information: [],
        normalizedAt: new Date().toISOString(),
      };

      const result = await analyzer.analyze(intent);
      expect(result.inspection.framework).toBeDefined();
      expect(result.inspection.runtime).toBeDefined();
      expect(result.inspection.packageManager).toBeDefined();
    });

    it('should check feasibility', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'test', type: 'FEATURE', mode: 'MEDIUM',
        objective: 'test', initialScope: [], symptoms: [], knownErrors: [],
        constraints: [], successCriteria: [], information: [],
        normalizedAt: new Date().toISOString(),
      };

      const result = await analyzer.analyze(intent);
      expect(result.feasibility).toBeDefined();
      expect(typeof result.feasibility.feasible).toBe('boolean');
    });
  });
});
