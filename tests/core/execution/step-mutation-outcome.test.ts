import { StepExecutionEngine } from '../../../src/core/execution/step-execution-engine';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { ExecutionContext } from '../../../src/domain/execution-context';
import { MutationResult } from '../../../src/domain/execution/mutation-safety';

/**
 * R2.19 regression: found during real E2E on E:\new-test-2.
 *
 * Every mutation in the run was correctly refused, the file was correctly
 * left untouched — and the pipeline still reported success. A step whose
 * mutations were all refused must fail, so the run is honest and Repair gets
 * the failure codes.
 */

function mutation(over: Partial<MutationResult> = {}): MutationResult {
  return {
    path: 'app/page.tsx',
    operation: 'modify',
    toolName: 'write_file',
    status: 'REJECTED',
    beforeState: 'PRESENT',
    afterState: 'PRESENT',
    beforeHash: 'a',
    afterHash: 'a',
    changed: false,
    syntaxValid: false,
    expectedChangePresent: null,
    expectedMarkers: [],
    diffSummary: { linesAdded: 0, linesRemoved: 0, bytesBefore: 1, bytesAfter: 1, linesBefore: 1, linesAfter: 1 },
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    decision: 'BLOCK',
    findings: [{ level: 'LEVEL_3_SYNTAX', code: 'SYNTAX_INVALID', detail: 'bad jsx' }],
    ...over,
  } as MutationResult;
}

function sessionManager() {
  return {
    recordStepStarted: jest.fn().mockResolvedValue(undefined),
    recordStepCompleted: jest.fn().mockResolvedValue(undefined),
    recordStepFailed: jest.fn().mockResolvedValue(undefined),
    setExpectedFiles: jest.fn(),
    clearExpectedFiles: jest.fn(),
    setExpectedChangeMarkers: jest.fn(),
    getSession: jest.fn().mockResolvedValue({ id: 'sess-1', events: [] }),
  } as any;
}

/** Emits a fixed mutation set the first time the step agent runs. */
function taskExecutor(results: MutationResult[], content = 'done') {
  let emitted: MutationResult[] = [];
  return {
    execute: jest.fn().mockImplementation(async () => {
      emitted = results;
      return { content, toolCalls: [] };
    }),
    peekMutationLedger: () => ({ results: emitted }),
    drainMutationLedger: () => ({ results: emitted }),
  } as any;
}

const plan: ExecutionPlan = Object.freeze({
  id: 'plan-1',
  objective: 'Add a JSX comment {/* r2-write-e2e */} to app/page.tsx',
  complexity: 'simple' as const,
  reasoning: 'test',
  steps: Object.freeze([{
    id: 'step-1',
    description: 'Modify app/page.tsx',
    type: 'modify' as const,
    requiredTools: [],
    expectedOutcome: 'comment added',
    expectedFiles: ['app/page.tsx'],
  }]),
  affectedDomains: Object.freeze([]),
  validationStrategy: Object.freeze({ requiredTests: Object.freeze([]), successCriteria: Object.freeze([]) }),
  createdAt: new Date().toISOString(),
});

const context: ExecutionContext = Object.freeze({
  sessionId: 'sess-1',
  plan: null,
  currentStepIndex: 0,
  totalSteps: 1,
  startedAt: new Date().toISOString(),
});

function engineWith(executor: any) {
  return new StepExecutionEngine(
    sessionManager(),
    { generate: jest.fn() } as any,
    undefined, undefined, undefined, undefined, undefined,
    executor,
    [{ name: 'write_file' }] as any,
  );
}

describe('R2.19 step outcome reflects mutation outcome', () => {
  it('fails a step whose every mutation was refused', async () => {
    const engine = engineWith(taskExecutor([mutation(), mutation({ status: 'ROLLED_BACK', rolledBack: true })]));
    const result = await engine.executeSteps('sess-1', plan, context);

    expect(result.success).toBe(false);
    expect(result.results[0].error).toMatch(/MUTATION_NOT_APPLIED/);
    expect(result.results[0].error).toMatch(/SYNTAX_INVALID/);
    expect(result.results[0].error).toMatch(/app\/page\.tsx/);
  });

  // Real E2E on E:\new-test-2: after all five writes were refused the agent
  // answered "STEP_ALREADY_COMPLETE: the comment is already present", and the
  // skip path reported the run as successful. The agent does not get to
  // certify its own refused write.
  it('rejects STEP_ALREADY_COMPLETE when every mutation in the step was refused', async () => {
    const engine = engineWith(taskExecutor(
      [mutation(), mutation({ status: 'ROLLED_BACK', rolledBack: true })],
      'STEP_ALREADY_COMPLETE: The JSX comment is already present in app/page.tsx.',
    ));
    const result = await engine.executeSteps('sess-1', plan, context);

    expect(result.success).toBe(false);
    expect(result.results[0].error).toMatch(/MUTATION_NOT_APPLIED/);
  });

  it('succeeds when at least one mutation in the step was applied', async () => {
    const engine = engineWith(taskExecutor([
      mutation(),
      mutation({ status: 'APPLIED', changed: true, syntaxValid: true, decision: 'ALLOW', findings: [] }),
    ]));
    const result = await engine.executeSteps('sess-1', plan, context);
    expect(result.success).toBe(true);
  });

  it('leaves a step that attempted no mutation at all unaffected', async () => {
    const engine = engineWith(taskExecutor([]));
    const result = await engine.executeSteps('sess-1', plan, context);
    expect(result.success).toBe(true);
  });

  it('declares the literal marker from the plan objective as the expected change', async () => {
    const sessions = sessionManager();
    const engine = new StepExecutionEngine(
      sessions,
      { generate: jest.fn() } as any,
      undefined, undefined, undefined, undefined, undefined,
      taskExecutor([]),
      [{ name: 'write_file' }] as any,
    );
    await engine.executeSteps('sess-1', plan, context);
    expect(sessions.setExpectedChangeMarkers).toHaveBeenCalledWith('sess-1', ['r2-write-e2e']);
  });
});
