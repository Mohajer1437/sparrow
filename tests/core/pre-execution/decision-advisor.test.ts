import { DefaultDecisionAdvisor } from '../../../src/core/pre-execution/decision-advisor';

describe('DefaultDecisionAdvisor', () => {
  let advisor: DefaultDecisionAdvisor;

  beforeEach(() => {
    advisor = new DefaultDecisionAdvisor();
  });

  describe('assessRisk', () => {
    it('should detect HIGH risk for delete operations', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'Delete all user data', type: 'FEATURE',
        mode: 'HARD', objective: 'Delete all user data', initialScope: [],
        symptoms: [], knownErrors: [], constraints: [], successCriteria: [],
        information: [], normalizedAt: new Date().toISOString(),
      };

      const inspection: any = {
        framework: 'unknown', runtime: 'node', packageManager: 'npm',
        hasTypeScript: false, hasTests: false, hasESLint: false, hasPrettier: false,
        structure: [], dependencies: [], scripts: new Map(),
        inspectedAt: new Date().toISOString(),
      };

      const result = await advisor.assessRisk(intent, inspection);
      expect(result.level).toBe('HIGH');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should detect LOW risk for simple read operations', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'Read src/utils.ts', type: 'INVESTIGATION',
        mode: 'EASY', objective: 'Read src/utils.ts', initialScope: ['src/utils.ts'],
        symptoms: [], knownErrors: [], constraints: [], successCriteria: [],
        information: [], normalizedAt: new Date().toISOString(),
      };

      const inspection: any = {
        framework: 'unknown', runtime: 'node', packageManager: 'npm',
        hasTypeScript: false, hasTests: false, hasESLint: false, hasPrettier: false,
        structure: [], dependencies: [], scripts: new Map(),
        inspectedAt: new Date().toISOString(),
      };

      const result = await advisor.assessRisk(intent, inspection);
      expect(result.level).toBe('LOW');
      expect(result.requiresConfirmation).toBe(false);
    });

    it('does not treat negated authentication as HIGH risk', async () => {
      const intent: any = {
        id: 'test',
        rawPrompt: 'Add a footer to app/page.tsx. Do not add authentication, payment, new routes, or unrelated files.',
        type: 'FEATURE',
        mode: 'MEDIUM',
        objective: 'Add a footer to app/page.tsx',
        initialScope: ['app/page.tsx'],
        symptoms: [],
        knownErrors: [],
        constraints: [],
        successCriteria: [],
        information: [],
        normalizedAt: new Date().toISOString(),
      };
      const inspection: any = {
        framework: 'nextjs', runtime: 'node', packageManager: 'npm',
        hasTypeScript: true, hasTests: false, hasESLint: false, hasPrettier: false,
        structure: [], dependencies: [], scripts: new Map(),
        inspectedAt: new Date().toISOString(),
      };
      const result = await advisor.assessRisk(intent, inspection);
      expect(result.level).not.toBe('HIGH');
    });
  });
});
