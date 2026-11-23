/**
 * Regression coverage for the R9 finding that an approved confirmation did not
 * actually unblock execution.
 *
 * Observed during the R9 campaign: case `r9-ctl-01` raised a CONFIRMATION_REQUIRED
 * request, the supplied callback approved it, the confirmation store recorded
 * `status: APPROVED` with an APPROVE decision — and the run still terminated with
 * "CONFIRMATION_REQUIRED: User confirmation required but not provided".
 *
 * Root cause: `DefaultWorkflowOrchestrator` evaluated the execution gate once with
 * `userConfirmed: false`, then obtained approval, then tested the *stale* evaluation
 * with `gate.isBlocked(evaluation)`. The stale verdict still carried the gate's
 * CONFIRMATION_REQUIRED reason, so an approval could never take effect.
 *
 * The gate itself was always correct; the orchestrator simply never asked it a
 * second time. These tests pin the gate behaviour the fix depends on.
 */

import { DefaultExecutionGate } from '../../../src/core/pre-execution/execution-gate';
import { GateCheckInput } from '../../../src/contracts/execution-gate';
import { GateCheckResult, GateReason, DEFAULT_GATE_POLICY } from '../../../src/domain/pre-execution/gate';

/**
 * Mirrors the shape observed in the campaign: LOW risk, but a file set large enough
 * to cross `maxFilesWithoutConfirmation`, which is what actually triggered the
 * confirmation request for `r9-ctl-01`.
 */
function inputWith(userConfirmed: boolean): GateCheckInput {
  const filesInScope = Array.from(
    { length: DEFAULT_GATE_POLICY.maxFilesWithoutConfirmation + 5 },
    (_, i) => `src/file-${i}.ts`,
  );

  return {
    contract: {
      id: 'contract-1',
      objective: 'apply a low risk change across many files',
      filesInScope,
      acceptanceCriteria: ['builds cleanly'],
      constraints: [],
      forbiddenActions: [],
      verification: 'run the unit test suite',
      steps: [{ id: 'step-1', description: 'edit', successCriteria: ['compiles'] }],
    } as unknown as GateCheckInput['contract'],
    intent: {
      summary: 'apply a low risk change across many files',
      requiresMutation: true,
    } as unknown as GateCheckInput['intent'],
    riskAssessment: {
      level: 'LOW',
      factors: [],
    } as unknown as GateCheckInput['riskAssessment'],
    evidence: [
      {
        id: 'ev-1',
        type: 'FILE',
        status: 'CONFIRMED',
        summary: 'read the target files',
      },
    ] as unknown as GateCheckInput['evidence'],
    critiqueResult: undefined,
    userConfirmed,
  };
}

const reasonCodes = (checks: ReadonlyArray<GateCheckResult>): string[] =>
  checks.flatMap((c: GateCheckResult) => (c.reasons ?? []).map((r: GateReason) => r.code));

describe('ExecutionGate confirmation handling', () => {
  const gate = new DefaultExecutionGate();

  it('reports CONFIRMATION_REQUIRED while the human has not answered', async () => {
    const evaluation = await gate.evaluate(inputWith(false));
    expect(evaluation.requiresConfirmation).toBe(true);
    expect(reasonCodes(evaluation.checks)).toContain('CONFIRMATION_REQUIRED');
  });

  it('stops reporting CONFIRMATION_REQUIRED once the human has approved', async () => {
    const evaluation = await gate.evaluate(inputWith(true));
    const codes = reasonCodes(evaluation.checks);
    expect(codes).not.toContain('CONFIRMATION_REQUIRED');
    expect(codes).toContain('CONFIRMED');
  });

  /**
   * The core regression. Before the fix the orchestrator kept consulting `before`
   * after the user had already approved, so approval was inert.
   */
  it('a re-evaluation after approval is no longer blocked', async () => {
    const before = await gate.evaluate(inputWith(false));
    const after = await gate.evaluate(inputWith(true));

    expect(gate.isBlocked(before)).toBe(true);
    expect(gate.isBlocked(after)).toBe(false);
    expect(before.blockedReasons.join(' ')).toMatch(/confirmation required/i);
    expect(after.blockedReasons).toEqual([]);
  });

  /** Neighbouring scenario: rejection must still stop the run. */
  it('still blocks when confirmation is required and withheld', async () => {
    const evaluation = await gate.evaluate(inputWith(false));
    expect(evaluation.decision).toBe('BLOCKED');
  });
});
