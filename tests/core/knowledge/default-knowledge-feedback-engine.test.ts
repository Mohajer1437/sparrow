import { DefaultKnowledgeFeedbackEngine } from '../../../src/core/knowledge/default-knowledge-feedback-engine';
import { WorkflowResult } from '../../../src/contracts/workflow-orchestrator';

describe('DefaultKnowledgeFeedbackEngine', () => {
  // A.4: quality gate compatible — all fixtures use success: true + executionOutcome: success
  let engine: DefaultKnowledgeFeedbackEngine;

  beforeEach(() => {
    engine = new DefaultKnowledgeFeedbackEngine();
  });

  it('generates ANTI_PATTERN for architectural violations', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-1',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: {
        timestamp: '',
        reviewedFiles: [],
        checks: [
          {
            ruleId: 'ARCH_01',
            ruleName: 'Clean Architecture',
            severity: 'ERROR',
            status: 'FAILED',
            evidence: [
              { rule: 'Domain must not depend on Core', source: 'src/domain/a.ts', target: 'src/core/b.ts', description: 'Forbidden dependency' }
            ]
          }
        ],
        passedCount: 0,
        failedCount: 1,
        warningCount: 0,
        notEvaluatedCount: 0
      } as any,
      patchResult: null,
      reflection: {
        sessionId: 'test',
        timestamp: '',
        taskAttempted: 'test',
        executionOutcome: 'success',
        stepsCompleted: 1,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 0,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any
    };

    const candidates = await engine.analyze(result);
    expect(candidates.length).toBe(1);
    expect(candidates[0].type).toBe('ANTI_PATTERN');
    expect(candidates[0].confidence).toBe('MEDIUM');
    expect(candidates[0].confidenceReasons.length).toBeGreaterThan(0);
    expect(candidates[0].status).toBe('pending_review');
  });

  it('generates BEST_PRACTICE for rollback', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-2',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: { success: true, rollbackPerformed: true } as any,
      reflection: {
        sessionId: 'test',
        timestamp: '',
        taskAttempted: 'test',
        executionOutcome: 'success',
        stepsCompleted: 1,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 0,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any,
      abortedAt: 'patch-execution'
    };

    const candidates = await engine.analyze(result);
    expect(candidates.some(c => c.type === 'BEST_PRACTICE')).toBe(true);
  });

  it('generates PATTERN for plan validation failure', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-3',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: null,
      reflection: {
        sessionId: 'test',
        timestamp: '',
        taskAttempted: 'test',
        executionOutcome: 'success',
        stepsCompleted: 1,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 0,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any,
      abortedAt: 'planning-validation',
      abortReason: 'Invalid dependencies'
    };

    const candidates = await engine.analyze(result);
    expect(candidates.some(c => c.type === 'PATTERN')).toBe(true);
  });

  it('returns empty array for successful execution', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-4',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: { success: true, rollbackPerformed: false } as any,
      reflection: {
        sessionId: 'test',
        timestamp: '',
        taskAttempted: 'test',
        executionOutcome: 'success',
        stepsCompleted: 1,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 0,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any
    };

    const candidates = await engine.analyze(result);
    expect(candidates.length).toBe(0);
  });

  it('includes confidence reasons for traceability', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-5',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: {
        timestamp: '',
        reviewedFiles: [],
        checks: [
          {
            ruleId: 'ARCH_01',
            ruleName: 'Clean Architecture',
            severity: 'ERROR',
            status: 'FAILED',
            evidence: [
              { rule: 'Domain must not depend on Core', source: 'src/domain/a.ts', target: 'src/core/b.ts', description: 'Forbidden dependency' }
            ]
          }
        ],
        passedCount: 0,
        failedCount: 1,
        warningCount: 0,
        notEvaluatedCount: 0
      } as any,
      patchResult: null,
      reflection: {
        sessionId: 'test',
        timestamp: '',
        taskAttempted: 'test',
        executionOutcome: 'success',
        stepsCompleted: 1,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 0,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any
    };

    const candidates = await engine.analyze(result);
    expect(candidates[0].confidenceReasons).toBeDefined();
    expect(candidates[0].confidenceReasons.length).toBeGreaterThan(0);
    expect(candidates[0].confidenceReasons.some(r => r.includes('Architectural'))).toBe(true);
  });


  // ============================================================
  // Phase A: Quality Gate Tests (added by patch 64)
  // ============================================================
  it('returns empty array when reflection.executionOutcome is partial_failure (quality gate)', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-qg',
      success: true,
      plan: null,
      impactReport: null,
      reviewReport: {
        timestamp: '',
        reviewedFiles: [],
        checks: [
          {
            ruleId: 'ARCH_01',
            ruleName: 'Clean Architecture',
            severity: 'ERROR',
            status: 'FAILED',
            evidence: [
              { rule: 'Domain must not depend on Core', source: 'a', target: 'b', description: 'Forbidden' }
            ]
          }
        ],
        passedCount: 0,
        failedCount: 1,
        warningCount: 0,
        notEvaluatedCount: 0,
      },
      patchResult: null,
      reflection: {
        sessionId: 'sess-qg',
        timestamp: '',
        taskAttempted: 'task',
        executionOutcome: 'partial_failure',
        stepsCompleted: 2,
        totalSteps: 3,
        stepsStarted: 3,
        stepFailureCount: 1,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any,
    };
    const candidates = await engine.analyze(result);
    expect(candidates.length).toBe(0);
  });

  it('returns empty array when success is false (quality gate)', async () => {
    const result: WorkflowResult = {
      sessionId: 'sess-qg-2',
      success: false,
      plan: null,
      impactReport: null,
      reviewReport: null,
      patchResult: null,
      reflection: {
        sessionId: 'sess-qg-2',
        timestamp: '',
        taskAttempted: 'task',
        executionOutcome: 'failed',
        stepsCompleted: 0,
        totalSteps: 1,
        stepsStarted: 1,
        stepFailureCount: 1,
        toolsUsed: [],
        filesModified: [],
        verificationExecuted: false,
        verificationPassed: false,
        retriesRequired: 0,
        rollbackPerformed: false,
        summary: '',
      } as any,
    };
    const candidates = await engine.analyze(result);
    expect(candidates.length).toBe(0);
  });

});
