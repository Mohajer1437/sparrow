import { StepExecutionEngine } from '../../../src/core/execution/step-execution-engine';
import { ResumeEngine } from '../../../src/core/checkpoint/resume-engine';
import { DefaultReflectionEngine } from '../../../src/core/reflection/default-reflection-engine';
import { DefaultRecoveryService } from '../../../src/core/recovery/default-recovery-service';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContext } from '../../../src/domain/execution-context';
import { ExecutionCheckpoint } from '../../../src/domain/execution-checkpoint';
import { CheckpointRepository } from '../../../src/contracts/checkpoint-repository';

class InMemoryCheckpointRepository implements CheckpointRepository {
  public checkpoints: ExecutionCheckpoint[] = [];
  async save(cp: ExecutionCheckpoint): Promise<void> { this.checkpoints.push(cp); }
  async load(id: string): Promise<ExecutionCheckpoint | null> { return this.checkpoints.find(c => c.checkpointId === id) ?? null; }
  async loadLatest(execId: string): Promise<ExecutionCheckpoint | null> {
    const matching = this.checkpoints.filter(c => c.executionId === execId);
    if (matching.length === 0) return null;
    return matching.sort((a, b) => {
      const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.currentStepIndex - a.currentStepIndex;
    })[0];
  }
  async delete(id: string): Promise<boolean> {
    const idx = this.checkpoints.findIndex(c => c.checkpointId === id);
    if (idx === -1) return false;
    this.checkpoints.splice(idx, 1);
    return true;
  }
  async list(execId: string): Promise<ReadonlyArray<ExecutionCheckpoint>> { return this.checkpoints.filter(c => c.executionId === execId); }
  async listAll(): Promise<ReadonlyArray<ExecutionCheckpoint>> { return [...this.checkpoints]; }
}

function createPlan(stepCount: number): ExecutionPlan {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`, description: `Step ${i + 1}`, type: 'modify' as const,
    requiredTools: [], expectedOutcome: `Done ${i + 1}`,
    dependencies: i > 0 ? [`step-${i}`] : [],
  }));
  return Object.freeze({
    id: 'plan-1', objective: 'E2E Test', complexity: 'medium' as const,
    reasoning: 'E2E', steps: Object.freeze(steps),
    affectedDomains: Object.freeze([]),
    validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
    createdAt: new Date().toISOString(), status: 'CREATED' as const,
  });
}

function createMockSessionManager(interruptAtStep?: string): any {
  return {
    recordStepStarted: jest.fn().mockImplementation(async (_sid: string, stepId: string) => {
      if (interruptAtStep && stepId === interruptAtStep) throw new Error('Simulated crash');
    }),
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

describe('Recovery E2E', () => {
  let repo: InMemoryCheckpointRepository;
  let resumeEngine: ResumeEngine;
  let recoveryService: DefaultRecoveryService;

  beforeEach(() => {
    repo = new InMemoryCheckpointRepository();
    resumeEngine = new ResumeEngine(repo);
    recoveryService = new DefaultRecoveryService(repo, resumeEngine);
  });

  it('full recovery flow: create → execute → interrupt → detect → resume → complete', async () => {
    const plan = createPlan(5);

    // Phase 1: Execute steps 1-3, then interrupt at step 4
    const mockSM1 = createMockSessionManager('step-4');
    const engine1 = new StepExecutionEngine(mockSM1, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    await expect(engine1.executeSteps('sess-1', plan, Object.freeze({
      sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 5,
      startedAt: new Date().toISOString(), executionId: 'exec-e2e',
    }))).rejects.toThrow('Simulated crash');

    // Phase 2: Detect recovery candidate
    const candidate = await recoveryService.findResumable('exec-e2e');
    expect(candidate).not.toBeNull();
    expect(candidate!.resumeFromStepIndex).toBe(3);
    expect(candidate!.remainingSteps).toEqual(['step-4', 'step-5']);

    // Phase 3: Prepare resume context
    const resumeContext = recoveryService.prepareResumeContext(candidate!);
    expect(resumeContext.executionId).toBe('exec-e2e');
    expect(resumeContext.sessionId).toBe('sess-1');
    expect(resumeContext.currentStepIndex).toBe(3);
    expect(resumeContext.resumedFromCheckpoint).toBe(true);

    // Phase 4: Resume execution from step 4
    const mockSM2 = createMockSessionManager();
    const engine2 = new StepExecutionEngine(mockSM2, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    const result = await engine2.executeSteps('sess-1', plan, resumeContext);

    // Phase 5: Verify
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(5);

    // Steps 1-3 should NOT be re-executed
    const startedCalls = mockSM2.recordStepStarted.mock.calls.map((c: any[]) => c[1]);
    expect(startedCalls).not.toContain('step-1');
    expect(startedCalls).not.toContain('step-2');
    expect(startedCalls).not.toContain('step-3');
    expect(startedCalls).toContain('step-4');
    expect(startedCalls).toContain('step-5');

    // Final checkpoint should be completed
    const finalCp = await repo.loadLatest('exec-e2e');
    expect(finalCp).not.toBeNull();
    expect(finalCp!.status).toBe('completed');
  });

  it('never restarts from step zero when checkpoint exists', async () => {
    const plan = createPlan(3);
    const mockSM = createMockSessionManager('step-2');
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    await expect(engine.executeSteps('sess-1', plan, Object.freeze({
      sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 3,
      startedAt: new Date().toISOString(), executionId: 'exec-nozero',
    }))).rejects.toThrow();

    const candidate = await recoveryService.findResumable('exec-nozero');
    expect(candidate!.resumeFromStepIndex).toBe(1);
    expect(candidate!.resumeFromStepIndex).not.toBe(0);
  });

  it('never resumes completed executions', async () => {
    const plan = createPlan(2);
    const mockSM = createMockSessionManager();
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    await engine.executeSteps('sess-1', plan, Object.freeze({
      sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 2,
      startedAt: new Date().toISOString(), executionId: 'exec-done',
    }));

    const candidate = await recoveryService.findResumable('exec-done');
    expect(candidate).toBeNull();
  });

  it('preserves execution identity across resume', async () => {
    const plan = createPlan(4);
    const mockSM1 = createMockSessionManager('step-3');
    const engine1 = new StepExecutionEngine(mockSM1, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    await expect(engine1.executeSteps('sess-1', plan, Object.freeze({
      sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 4,
      startedAt: new Date().toISOString(), executionId: 'exec-identity',
    }))).rejects.toThrow();

    const candidate = await recoveryService.findResumable('exec-identity');
    const ctx = recoveryService.prepareResumeContext(candidate!);

    expect(ctx.executionId).toBe('exec-identity');
    expect(ctx.sessionId).toBe('sess-1');
    expect(ctx.checkpointId).toBeDefined();
  });

  it('preserves completed steps across resume', async () => {
    const plan = createPlan(5);
    const mockSM1 = createMockSessionManager('step-4');
    const engine1 = new StepExecutionEngine(mockSM1, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);

    await expect(engine1.executeSteps('sess-1', plan, Object.freeze({
      sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 5,
      startedAt: new Date().toISOString(), executionId: 'exec-preserve',
    }))).rejects.toThrow();

    const candidate = await recoveryService.findResumable('exec-preserve');
    expect(candidate!.checkpoint.completedStepIds).toEqual(['step-1', 'step-2', 'step-3']);
    expect(candidate!.checkpoint.pendingStepIds).toEqual(['step-4', 'step-5']);
  });
});
