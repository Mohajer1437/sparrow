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
  public failOnSave = false;

  async save(checkpoint: ExecutionCheckpoint): Promise<void> {
    if (this.failOnSave) throw new Error('Simulated write failure');
    this.checkpoints.push(checkpoint);
  }
  async load(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    return this.checkpoints.find(cp => cp.checkpointId === checkpointId) ?? null;
  }
  async loadLatest(executionId: string): Promise<ExecutionCheckpoint | null> {
    const matching = this.checkpoints.filter(cp => cp.executionId === executionId);
    if (matching.length === 0) return null;
    return matching.sort((a, b) => {
      const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.currentStepIndex - a.currentStepIndex;
    })[0];
  }
  async delete(checkpointId: string): Promise<boolean> {
    const idx = this.checkpoints.findIndex(cp => cp.checkpointId === checkpointId);
    if (idx === -1) return false;
    this.checkpoints.splice(idx, 1);
    return true;
  }
  async list(executionId: string): Promise<ReadonlyArray<ExecutionCheckpoint>> {
    return this.checkpoints.filter(cp => cp.executionId === executionId);
  }
  async listAll(): Promise<ReadonlyArray<ExecutionCheckpoint>> {
    return [...this.checkpoints];
  }
}

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

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return Object.freeze({
    sessionId: 'sess-1', plan: null, currentStepIndex: 0, totalSteps: 0,
    startedAt: new Date().toISOString(), executionId: 'exec-1', ...overrides,
  });
}

function createMockSessionManager(interruptAtStep?: string): any {
  return {
    recordStepStarted: jest.fn().mockImplementation(async (_sid: string, stepId: string) => {
      if (interruptAtStep && stepId === interruptAtStep) throw new Error('Simulated interruption');
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

describe('Failure Injection', () => {
  let repo: InMemoryCheckpointRepository;
  let resumeEngine: ResumeEngine;

  beforeEach(() => {
    repo = new InMemoryCheckpointRepository();
    resumeEngine = new ResumeEngine(repo);
  });

  it('handles process interruption during step execution', async () => {
    const mockSM = createMockSessionManager('step-4');
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);
    const plan = createPlan(5);

    await expect(engine.executeSteps('sess-1', plan, createContext())).rejects.toThrow('Simulated interruption');

    const latest = await repo.loadLatest('exec-1');
    expect(latest).not.toBeNull();
    expect(latest!.currentStepIndex).toBe(3);
    expect(latest!.status).toBe('active');
    expect(latest!.completedStepIds).toEqual(['step-1', 'step-2', 'step-3']);
  });

  it('handles checkpoint write failure gracefully', async () => {
    repo.failOnSave = true;
    const mockSM = createMockSessionManager();
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);
    const plan = createPlan(2);

    const result = await engine.executeSteps('sess-1', plan, createContext());
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
  });

  it('handles corrupted checkpoint file', async () => {
    const corrupted = Object.freeze({
      checkpointId: 'cp-bad', executionId: 'exec-1', sessionId: 'sess-1', planId: 'plan-1',
      currentStepIndex: -1, totalSteps: 5,
      completedStepIds: Object.freeze([]), pendingStepIds: Object.freeze([]),
      status: 'active' as const, createdAt: '', updatedAt: '',
    });
    repo.checkpoints.push(corrupted);

    const recoveryService = new DefaultRecoveryService(repo, resumeEngine);
    const candidate = await recoveryService.findResumable('exec-1');
    expect(candidate).toBeNull();
  });

  it('handles missing checkpoint file', async () => {
    const recoveryService = new DefaultRecoveryService(repo, resumeEngine);
    const candidate = await recoveryService.findResumable('nonexistent');
    expect(candidate).toBeNull();
  });

  it('handles interrupted execution with partial completion', async () => {
    const mockSM = createMockSessionManager('step-3');
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);
    const plan = createPlan(5);

    await expect(engine.executeSteps('sess-1', plan, createContext())).rejects.toThrow();

    const latest = await repo.loadLatest('exec-1');
    expect(latest!.completedStepIds).toEqual(['step-1', 'step-2']);
    expect(latest!.pendingStepIds).toEqual(['step-3', 'step-4', 'step-5']);
  });

  it('handles resume after multiple completed checkpoints', async () => {
    const mockSM = createMockSessionManager();
    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);
    const plan = createPlan(3);

    await engine.executeSteps('sess-1', plan, createContext());

    const all = await repo.list('exec-1');
    expect(all.length).toBeGreaterThanOrEqual(3);

    const last = all[all.length - 1];
    expect(last.status).toBe('completed');
  });

  it('handles resume after failed step checkpoint', async () => {
    const mockSM = createMockSessionManager();
    mockSM.recordStepCompleted.mockImplementation(async (_sid: string, stepId: string) => {
      if (stepId === 'step-2') throw new Error('Step 2 failed');
    });

    const engine = new StepExecutionEngine(mockSM, new DefaultReflectionEngine(), undefined, undefined, undefined, resumeEngine);
    const plan = createPlan(3);

    const result = await engine.executeSteps('sess-1', plan, createContext());
    expect(result.success).toBe(false);

    const latest = await repo.loadLatest('exec-1');
    expect(latest).not.toBeNull();
  });
});
