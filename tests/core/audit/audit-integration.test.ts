import { StepExecutionEngine } from '../../../src/core/execution/step-execution-engine';
import { DefaultReflectionEngine } from '../../../src/core/reflection/default-reflection-engine';
import { DefaultRecoveryTrigger } from '../../../src/core/recovery/default-recovery-trigger';
import { AuditService } from '../../../src/contracts/audit-service';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContext } from '../../../src/domain/execution-context';

function createPlan(stepCount: number): ExecutionPlan {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`, description: `Step ${i + 1}`, type: 'modify' as const,
    requiredTools: [], expectedOutcome: `Done ${i + 1}`,
    dependencies: i > 0 ? [`step-${i}`] : [],
  }));
  return Object.freeze({
    id: 'plan-1', objective: 'Test', complexity: 'simple' as const,
    reasoning: 'Test', steps: Object.freeze(steps),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
    createdAt: new Date().toISOString(), status: 'CREATED' as const,
  });
}

function createContext(): ExecutionContext {
  return Object.freeze({
    sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 0,
    startedAt: new Date().toISOString(), executionId: 'exec-1',
  });
}

function createMockSessionManager(): any {
  return {
    recordStepStarted: jest.fn().mockResolvedValue(undefined),
    recordStepCompleted: jest.fn().mockResolvedValue(undefined),
    recordStepFailed: jest.fn().mockResolvedValue(undefined),
    pauseSession: jest.fn().mockResolvedValue(undefined),
    resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
    getSession: jest.fn().mockResolvedValue({
      id: 'sess-1', task: 'test', status: 'executing', events: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      workspacePath: '/test', currentStep: 0, totalSteps: 0,
    }),
  };
}

function createMockAuditService(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    getHistory: jest.fn().mockResolvedValue([]),
    getSessionHistory: jest.fn().mockResolvedValue([]),
  };
}

function createMockResumeEngine(): any {
  return {
    createCheckpoint: jest.fn().mockReturnValue(Object.freeze({
      checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: 1, totalSteps: 2,
      completedStepIds: Object.freeze(['step-1']),
      pendingStepIds: Object.freeze(['step-2']),
      status: 'active' as const, createdAt: '', updatedAt: '',
    })),
    saveCheckpoint: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Audit Integration', () => {
  it('records audit events during step execution', async () => {
    const mockAudit = createMockAuditService();
    const engine = new StepExecutionEngine(
      createMockSessionManager(), new DefaultReflectionEngine(),
      undefined, undefined, undefined, createMockResumeEngine(), mockAudit
    );

    await engine.executeSteps('sess-1', createPlan(2), createContext());

    const eventTypes = mockAudit.record.mock.calls.map((c: any[]) => c[0].eventType);
    expect(eventTypes).toContain('step_started');
    expect(eventTypes).toContain('step_completed');
    expect(eventTypes).toContain('checkpoint_created');
  });

  it('records step_failed audit event', async () => {
    const mockAudit = createMockAuditService();
    const mockSM = createMockSessionManager();
    mockSM.recordStepCompleted.mockImplementation(async (_sid: string, stepId: string) => {
      if (stepId === 'step-1') throw new Error('Step 1 failed');
    });

    const engine = new StepExecutionEngine(
      mockSM, new DefaultReflectionEngine(),
      undefined, undefined, undefined, undefined, mockAudit
    );

    await engine.executeSteps('sess-1', createPlan(2), createContext());

    const eventTypes = mockAudit.record.mock.calls.map((c: any[]) => c[0].eventType);
    expect(eventTypes).toContain('step_failed');
  });

  it('records recovery_triggered audit event', async () => {
    const mockAudit = createMockAuditService();
    const mockRecoveryService: any = {
      findResumable: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        checkpoint: Object.freeze({
          checkpointId: 'cp-1', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
          currentStepIndex: 2, totalSteps: 5,
          completedStepIds: Object.freeze(['step-1', 'step-2']),
          pendingStepIds: Object.freeze(['step-3', 'step-4', 'step-5']),
          status: 'active' as const, createdAt: '', updatedAt: '',
        }),
        resumeFromStepIndex: 2,
        remainingSteps: Object.freeze(['step-3', 'step-4', 'step-5']),
      }),
      prepareResumeContext: jest.fn().mockReturnValue({
        sessionId: 'sess-1', plan: null, currentStepIndex: 2, totalSteps: 5,
        startedAt: '', executionId: 'exec-1', checkpointId: 'cp-1', resumedFromCheckpoint: true,
      }),
      validateCheckpoint: jest.fn().mockReturnValue(true),
    };
    const mockCheckpointRepo: any = {
      save: jest.fn(), load: jest.fn(), loadLatest: jest.fn(),
      delete: jest.fn(), list: jest.fn(), listAll: jest.fn().mockResolvedValue([]),
    };

    const trigger = new DefaultRecoveryTrigger(mockRecoveryService, mockCheckpointRepo, mockAudit);
    await trigger.resume('exec-1');

    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'recovery_triggered' })
    );
  });

  it('audit failure does not break step execution', async () => {
    const mockAudit = createMockAuditService();
    mockAudit.record.mockRejectedValue(new Error('Audit write failed'));

    const engine = new StepExecutionEngine(
      createMockSessionManager(), new DefaultReflectionEngine(),
      undefined, undefined, undefined, undefined, mockAudit
    );

    const result = await engine.executeSteps('sess-1', createPlan(2), createContext());
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
  });

  it('works without audit service (backward compatible)', async () => {
    const engine = new StepExecutionEngine(
      createMockSessionManager(), new DefaultReflectionEngine(),
    );

    const result = await engine.executeSteps('sess-1', createPlan(2), createContext());
    expect(result.success).toBe(true);
  });

  it('preserves event ordering', async () => {
    const mockAudit = createMockAuditService();
    const engine = new StepExecutionEngine(
      createMockSessionManager(), new DefaultReflectionEngine(),
      undefined, undefined, undefined, createMockResumeEngine(), mockAudit
    );

    await engine.executeSteps('sess-1', createPlan(3), createContext());

    const eventTypes = mockAudit.record.mock.calls.map((c: any[]) => c[0].eventType);
    const firstStepStarted = eventTypes.indexOf('step_started');
    const firstStepCompleted = eventTypes.indexOf('step_completed');
    expect(firstStepStarted).toBeLessThan(firstStepCompleted);
  });
});
