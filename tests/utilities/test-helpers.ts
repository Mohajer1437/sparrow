import { ExecutionPlan, PlanStep } from '../../src/domain/execution-plan';

export function createTestPlan(stepCount: number, objective: string = 'Test objective'): ExecutionPlan {
  const steps: PlanStep[] = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    description: `Test step ${i + 1}`,
    type: 'modify' as const,
    requiredTools: [],
    expectedOutcome: `Completed step ${i + 1}`,
    dependencies: i > 0 ? [`step-${i}`] : [],
  }));

  return Object.freeze({
    id: `plan-test-${Date.now()}`,
    objective,
    complexity: stepCount <= 2 ? 'simple' as const : stepCount <= 5 ? 'medium' as const : 'complex' as const,
    reasoning: 'Test plan for validation',
    steps: Object.freeze(steps),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({
      requiredTests: Object.freeze([]),
      successCriteria: Object.freeze(['All steps completed']),
    }),
    createdAt: new Date().toISOString(),
    status: 'CREATED' as const,
  });
}

export function createMockSessionManager(): any {
  return {
    startSession: jest.fn().mockResolvedValue('sess-test-1'),
    completeSession: jest.fn().mockResolvedValue(undefined),
    failSession: jest.fn().mockResolvedValue(undefined),
    pauseSession: jest.fn().mockResolvedValue(undefined),
    resumeSession: jest.fn().mockResolvedValue({ id: 'sess-test-1', status: 'executing' }),
    getSession: jest.fn().mockResolvedValue({
      id: 'sess-test-1', task: 'test', status: 'executing', events: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      workspacePath: '/test', currentStep: 0, totalSteps: 0,
    }),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    recordReflection: jest.fn().mockResolvedValue(undefined),
    recordDecision: jest.fn().mockResolvedValue(undefined),
    recordStepStarted: jest.fn().mockResolvedValue(undefined),
    recordStepCompleted: jest.fn().mockResolvedValue(undefined),
    recordStepFailed: jest.fn().mockResolvedValue(undefined),
    addRetryAttempt: jest.fn().mockResolvedValue(undefined),
    updateSession: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockWorkspaceMemory(): any {
  return {
    load: jest.fn().mockResolvedValue({ isEmpty: true }),
    hasKnowledge: jest.fn().mockResolvedValue(false),
    getKnowledgeDir: jest.fn().mockReturnValue('knowledge'),
  };
}

export async function measureDuration<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  return { result, durationMs };
}
