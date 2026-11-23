import { DefaultExecutionGate } from '../../../src/core/pre-execution/execution-gate';
import { DEFAULT_GATE_POLICY } from '../../../src/domain/pre-execution/gate';

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    contract: {
      id: 'contract-1',
      planId: 'plan-1',
      objective: 'Edit app/page.tsx',
      context: 'nextjs',
      knownFacts: ['Framework detected: nextjs'],
      evidence: ['File exists: app/page.tsx'],
      hypotheses: [],
      constraints: [],
      allowedActions: ['apply_patch'],
      forbiddenActions: ['delete_file'],
      filesInScope: ['app/page.tsx'],
      filesOutOfScope: [],
      preconditions: [],
      steps: [{
        id: 'step-1',
        precondition: 'ok',
        action: 'edit',
        expectedObservation: 'done',
        successCriteria: ['ok'],
        failureHandling: 'rollback',
        filesInScope: ['app/page.tsx'],
        filesOutOfScope: [],
        riskLevel: 'LOW',
      }],
      risk: 'LOW',
      impact: 'low',
      rollback: 'git',
      verification: 'build',
      outputRequirements: [],
      createdAt: new Date().toISOString(),
      version: '1.0.0',
      validated: true,
      validationErrors: [],
    },
    intent: {
      id: 'intent-1',
      rawPrompt: 'edit',
      type: 'FEATURE',
      mode: 'EASY',
      objective: 'edit',
      initialScope: ['app/page.tsx'],
      constraints: [],
      successCriteria: [],
    },
    riskAssessment: {
      level: 'LOW',
      explanation: 'small',
      factors: [],
      reversible: true,
      estimatedFilesAffected: 1,
      requiresConfirmation: false,
      safeExperimentRecommended: false,
    },
    evidence: [{
      id: 'e1',
      type: 'FILE_EXISTS',
      description: 'File exists: app/page.tsx',
      status: 'CONFIRMED',
      source: 'app/page.tsx',
    }],
    userConfirmed: false,
    ...overrides,
  };
}

describe('DefaultExecutionGate', () => {
  let gate: DefaultExecutionGate;

  beforeEach(() => {
    gate = new DefaultExecutionGate();
  });

  it('should be instantiable', () => {
    expect(gate).toBeDefined();
  });

  it('should have evaluate method', () => {
    expect(typeof gate.evaluate).toBe('function');
  });

  it('should have isBlocked method', () => {
    expect(typeof gate.isBlocked).toBe('function');
  });

  it('allows a validated contract with confirmed evidence to proceed', async () => {
    const evaluation = await gate.evaluate(makeInput() as any, DEFAULT_GATE_POLICY);
    expect(evaluation.decision).toBe('PROCEED');
    expect(gate.isBlocked(evaluation)).toBe(false);
  });

  it('blocks when no evidence is provided', async () => {
    const evaluation = await gate.evaluate(makeInput({ evidence: [] }) as any, DEFAULT_GATE_POLICY);
    expect(evaluation.decision).toBe('BLOCKED');
    expect(gate.isBlocked(evaluation)).toBe(true);
    expect(evaluation.blockedReasons.join(' ')).toMatch(/NO_EVIDENCE/);
  });

  it('blocks when the contract has no files in scope', async () => {
    const input = makeInput();
    (input as any).contract = { ...(input as any).contract, filesInScope: [] };
    const evaluation = await gate.evaluate(input as any, DEFAULT_GATE_POLICY);
    expect(evaluation.decision).toBe('BLOCKED');
    expect(evaluation.blockedReasons.join(' ')).toMatch(/NO_SCOPE/);
  });
});
