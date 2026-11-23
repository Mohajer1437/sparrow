import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { InternalValidationRequest } from '../../../src/domain/internal-validation';
import { buildTaskOutcomeSummary } from '../../../src/app/outcome-summary-builder';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION } from '../../../src/domain/validator-capability';
import { validationRegistry } from '../../../src/core/validation/validation-registry';

function createHarness() {
  const mockSessionManager = {
    startSession: jest.fn().mockResolvedValue('sess-1'),
    completeSession: jest.fn().mockResolvedValue(undefined),
    failSession: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn().mockResolvedValue({
      id: 'sess-1',
      task: 'test',
      status: 'executing',
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: '/test',
    }),
    recordReflection: jest.fn(),
    recordDecision: jest.fn(),
    recordEvent: jest.fn(),
    recordStepStarted: jest.fn(),
    recordStepCompleted: jest.fn(),
    recordStepFailed: jest.fn(),
    pauseSession: jest.fn(),
    resumeSession: jest.fn(),
  } as any;

  const mockProvider = { generate: jest.fn() };
  const mockPlanner = { plan: jest.fn().mockResolvedValue({ id: 'plan-1', steps: [], complexity: 'simple' }) };
  const mockReviewer = { review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 1, checks: [] }) };
  const mockPatchExecutor = { executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }) };
  const mockGit = {
    isRepository: jest.fn().mockResolvedValue(true),
    commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
    status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }),
  };

  const orchestrator = new DefaultWorkflowOrchestrator(
    mockSessionManager,
    { load: jest.fn().mockResolvedValue({ isEmpty: true }) } as any,
    mockPlanner as any,
    { analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }) } as any,
    mockReviewer as any,
    mockPatchExecutor as any,
    mockGit as any,
    { generate: jest.fn().mockReturnValue({ sessionId: 'sess-1', summary: 'test' }) } as any,
    { validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }), resolveDependencies: jest.fn().mockReturnValue([]) } as any,
    { generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }) } as any,
  );

  return { orchestrator, mockSessionManager, mockPlanner, mockProvider, mockReviewer, mockPatchExecutor, mockGit };
}

const ATTACK: InternalValidationRequest = {
  validator: 'PlannerAllowedTargets',
  input: {
    goal: 'authority boundary attack',
    files: ['package.json', 'server/src/auth/tokens.ts'],
    affectedFiles: ['types/domain.ts'],
    contextReferences: ['.ai/backend.md'],
  },
  authority: ['package.json'],
  context: ['server/src/auth/tokens.ts', 'types/domain.ts'],
};

describe('Case A: INTERNAL_VALIDATION bypasses the task pipeline', () => {
  it('runs the validator without invoking planner, provider, executor or reviewer', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL UNIT VALIDATION RUN. Do not run full pipeline. Do NOT invoke Planner. Do NOT invoke LLM.',
      executionMode: 'INTERNAL_VALIDATION',
      internalValidation: ATTACK,
    });

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockReviewer.review).not.toHaveBeenCalled();
    expect(harness.mockGit.commit).not.toHaveBeenCalled();

    expect(result.plan).toBeNull();
    expect(result.reviewReport).toBeNull();
    expect(result.patchResult).toBeNull();
    expect(result.executionMode).toBe('INTERNAL_VALIDATION');
    expect(result.touchedFiles).toEqual([]);
  });

  it('returns the exact validator rejection', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL UNIT VALIDATION RUN',
      executionMode: 'INTERNAL_VALIDATION',
      internalValidation: ATTACK,
    });

    expect(result.success).toBe(false);
    expect(result.internalValidation?.result).toBe('REJECT');
    expect(result.internalValidation?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.internalValidation?.rejectedTargets).toEqual([
      'server/src/auth/tokens.ts',
      'types/domain.ts',
    ]);
    expect(result.abortedAt).toBe('internal-validation');
    expect(result.abortReason).toContain('Validation target is not authorized by declared authority');
    expect(result.abortReason).not.toContain('Planner referenced files');
  });

  it('reports success when every declared execution target is authorized', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL UNIT VALIDATION RUN',
      executionMode: 'INTERNAL_VALIDATION',
      internalValidation: {
        validator: 'PlannerAllowedTargets',
        input: { files: ['package.json'] },
        authority: ['package.json'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.internalValidation?.result).toBe('ACCEPT');
    expect(result.abortReason).toBeUndefined();
    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('parses the raw /execute directive and reaches the validator without a payload argument', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargetsValidator input={"files":["package.json","server/src/auth/tokens.ts"],"affectedFiles":["types/domain.ts"],"authority":["package.json"]}',
    });

    expect(result.executionMode).toBe('INTERNAL_VALIDATION');
    expect(result.internalValidation?.result).toBe('REJECT');
    expect(result.internalValidation?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.internalValidation?.rejectedTargets).toEqual([
      'server/src/auth/tokens.ts',
      'types/domain.ts',
    ]);

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockReviewer.review).not.toHaveBeenCalled();
    expect(result.plan).toBeNull();
  });

  it('reports INVALID_VALIDATION_REQUEST when the directive has no payload', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL UNIT VALIDATION RUN. Do not run full pipeline.',
    });

    expect(result.success).toBe(false);
    expect(result.internalValidation?.reasonCode).toBe('INVALID_VALIDATION_REQUEST');
    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('propagates the validator message into the TASK RESULT summary', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["package.json"],"authority":["server/src/auth/tokens.ts"]}',
    });

    expect(result.internalValidation?.result).toBe('REJECT');
    expect(result.internalValidation?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');

    const snapshot: TaskRunSnapshot = {
      taskId: 'task-internal-validation',
      runId: 'run-internal-validation',
      sessionId: result.sessionId,
      task: 'INTERNAL_VALIDATION',
      roleId: 'coder',
      workspaceRoot: 'E:/project',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'BLOCKED',
      executionMode: 'INTERNAL_VALIDATION',
      error: result.abortReason,
      abortReason: result.abortReason,
    } as TaskRunSnapshot;

    const summary = buildTaskOutcomeSummary(snapshot);

    expect(summary.status).toBe('BLOCKED');
    expect(summary.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(summary.reason).toBe('Validation target is not authorized by declared authority: package.json');
    expect(summary.summary).not.toContain('Planner referenced files');
    expect(summary.reason).not.toContain('not grounded in workspace evidence');
    expect(summary.rejectedTargets).toEqual(['package.json']);
    expect(summary.changedFiles).toEqual([]);
  });

  it('C) an accepted command runs the validator and nothing else', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["package.json"],"authority":["package.json"]}',
    });

    expect(result.internalValidation?.validator).toBe('PlannerAllowedTargets');
    expect(result.internalValidation?.status).toBe('ACCEPT');

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockReviewer.review).not.toHaveBeenCalled();
    expect(harness.mockGit.commit).not.toHaveBeenCalled();
    expect(result.verificationReport).toBeUndefined();
  });

  it('C2) the accepted validator holds only read capabilities', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["package.json"],"authority":["package.json"]}',
    });

    expect(result.internalValidation?.status).toBe('ACCEPT');

    const declared = validationRegistry.capabilitiesOf('PlannerAllowedTargets')!;
    expect(declared.capabilities).toEqual(['READ_INPUT', 'READ_CONTEXT']);
    for (const forbidden of CAPABILITIES_FORBIDDEN_IN_INTERNAL_VALIDATION) {
      expect(declared.capabilities).not.toContain(forbidden);
    }

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
  });

  it('C3) a validator reaching past its capabilities is rejected end to end', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=FakeFilesystemValidator input={"files":["package.json"]}',
    });

    expect(result.internalValidation?.status).toBe('REJECT');
    expect(result.internalValidation?.reasonCode).toBe('VALIDATOR_CAPABILITY_VIOLATION');
    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockGit.commit).not.toHaveBeenCalled();
  });

  it('D) an unauthorized target is rejected and the input is left unchanged', async () => {
    const harness = createHarness();
    const payload = { files: ['server/src/auth/tokens.ts'], authority: ['package.json'] };
    const before = JSON.stringify(payload);

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["server/src/auth/tokens.ts"],"authority":["package.json"]}',
      internalValidation: { validator: 'PlannerAllowedTargets', input: payload },
    });

    expect(result.internalValidation?.status).toBe('REJECT');
    expect(result.internalValidation?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.internalValidation?.rejectedTargets).toEqual(['server/src/auth/tokens.ts']);
    expect(JSON.stringify(payload)).toBe(before);

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockReviewer.review).not.toHaveBeenCalled();
  });

  it('E) a malformed command is refused before any validator runs', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=PlannerAllowedTargets input={"files":["package.json]',
    });

    expect(result.success).toBe(false);
    expect(result.internalValidation?.status).toBe('ERROR');
    expect(result.internalValidation?.reasonCode).toBe('INVALID_VALIDATION_REQUEST');
    expect(result.internalValidation?.validator).toBe('(unparsed)');
    expect(result.internalValidation?.rejectedTargets).toEqual([]);

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
  });

  it('dispatches ValidatorRegistryImmutability without touching the pipeline', async () => {
    const harness = createHarness();
    const command = 'INTERNAL_VALIDATION validator=ValidatorRegistryImmutability input={"registerContract":{"name":"MutableTestValidator","type":"EXECUTION_AUTHORITY","inputSchema":{"requiredAnyOf":["files"]},"deterministic":true,"mutationPolicy":"NONE","isolation":"INTERNAL_VALIDATION_ONLY"},"mutationTests":["mutateOriginalContract","mutateCapabilitiesResult","mutateInputSchema","mutateNestedArrays","mutateIsolation","mutateMutationPolicy"]}';

    const result = await harness.orchestrator.execute({ task: command });

    expect(result.executionMode).toBe('INTERNAL_VALIDATION');
    expect(result.internalValidation?.validator).toBe('ValidatorRegistryImmutability');
    expect(result.internalValidation?.status).toBe('ACCEPT');
    expect(result.internalValidation?.metadata).toMatchObject({
      capabilitiesStable: true,
      originalContractStable: true,
      nestedSchemaStable: true,
      mutationAttempts: 6,
    });

    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
    expect(harness.mockPatchExecutor.executeWithVerification).not.toHaveBeenCalled();
    expect(harness.mockReviewer.review).not.toHaveBeenCalled();
    expect(harness.mockGit.commit).not.toHaveBeenCalled();
    expect(result.verificationReport).toBeUndefined();
    expect(result.plan).toBeNull();
  });

  it('a near-miss validator name still returns UNKNOWN_VALIDATOR', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'INTERNAL_VALIDATION validator=ValidatorRegistryImmutabilityXYZ input={"registerContract":{"name":"MutableTestValidator","type":"EXECUTION_AUTHORITY","inputSchema":{"requiredAnyOf":["files"]},"deterministic":true,"mutationPolicy":"NONE","isolation":"INTERNAL_VALIDATION_ONLY"}}',
    });

    expect(result.internalValidation?.status).toBe('ERROR');
    expect(result.internalValidation?.reasonCode).toBe('UNKNOWN_VALIDATOR');
    expect(harness.mockPlanner.plan).not.toHaveBeenCalled();
    expect(harness.mockProvider.generate).not.toHaveBeenCalled();
  });

  it('Case C: a STANDARD run still executes the normal pipeline', async () => {
    const harness = createHarness();

    const result = await harness.orchestrator.execute({
      task: 'Add feature',
      targetFiles: ['src/core/a.ts'],
      patchRequest: { sessionId: 'sess-1', operations: [{ path: 'src/core/a.ts', operation: 'modify', newContent: 'new' }] },
    });

    expect(result.success).toBe(true);
    expect(result.executionMode).toBe('STANDARD');
    expect(harness.mockPlanner.plan).toHaveBeenCalled();
    expect(result.internalValidation).toBeUndefined();
  });
});
