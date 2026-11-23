import { DefaultClarificationEngine } from '../../../src/core/pre-execution/clarification-engine';

describe('DefaultClarificationEngine', () => {
  let engine: DefaultClarificationEngine;

  beforeEach(() => {
    engine = new DefaultClarificationEngine();
  });

  describe('generateQuestions', () => {
    it('should generate questions for blocking ambiguities', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'test', type: 'FEATURE', mode: 'MEDIUM',
        objective: 'test', initialScope: [], symptoms: [], knownErrors: [],
        constraints: [], successCriteria: [], information: [],
        normalizedAt: new Date().toISOString(),
        ambiguities: ['No specific file mentioned'],
      };

      const riskAssessment: any = {
        level: 'LOW', explanation: 'test', factors: [], reversible: true,
        estimatedFilesAffected: 0, requiresConfirmation: false,
        safeExperimentRecommended: false,
      };

      const result = await engine.generateQuestions(intent, riskAssessment);
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.hasBlockingQuestions).toBe(true);
    });

    it('should not generate questions when no ambiguities', async () => {
      const intent: any = {
        id: 'test', rawPrompt: 'test', type: 'FEATURE', mode: 'MEDIUM',
        objective: 'test', initialScope: ['src/utils.ts'], symptoms: [],
        knownErrors: [], constraints: [], successCriteria: [], information: [],
        normalizedAt: new Date().toISOString(),
        ambiguities: [],
      };

      const riskAssessment: any = {
        level: 'LOW', explanation: 'test', factors: [], reversible: true,
        estimatedFilesAffected: 1, requiresConfirmation: false,
        safeExperimentRecommended: false,
      };

      const result = await engine.generateQuestions(intent, riskAssessment);
      expect(result.questions.length).toBe(0);
    });
  });
});
