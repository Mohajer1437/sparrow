import {
  analyzeRepairOutcome,
  evaluateRepairCompletion,
} from '../../../src/core/repair/repair-outcome-analysis';
import { buildRepairObjective } from '../../../src/core/repair/repair-target-policy';
import { classifyFailureRelevance } from '../../../src/core/repair/failure-relevance';
import { MutationLedger, MutationResult } from '../../../src/domain/execution/mutation-safety';
import { RepairSafetyFinding } from '../../../src/domain/repair/repair-objective';
import { TodoItem, TodoPlan } from '../../../src/domain/todo-plan';
import { VerificationCheck } from '../../../src/domain/verification-check';
import { ImpactAnalysis } from '../../../src/domain/impact-analysis';

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    title: 'Fix the component',
    description: 'Restore the component',
    reason: 'requested',
    files: ['app/page.tsx'],
    dependencies: [],
    skillIds: ['frontend.core'],
    verificationRequirements: ['typecheck'],
    risk: 'LOW',
    action: 'modify',
    ...over,
  } as TodoItem;
}

function plan(todos: ReadonlyArray<TodoItem> = [todo()]): TodoPlan {
  return {
    goal: 'goal',
    contextSummary: 'summary',
    affectedFiles: todos.flatMap(item => [...item.files]),
    constraints: [],
    todos,
  } as TodoPlan;
}

function fixObjective(task = 'Fix the CrashBeacon component so the page renders') {
  return buildRepairObjective({
    originalTask: task,
    acceptanceCriteria: ['The page renders the beacon'],
    originalTodoPlan: plan(),
    failedTodoId: 'todo-1',
    primaryFailure: 'build failed',
  });
}

function mutation(over: Partial<MutationResult> = {}): MutationResult {
  return {
    path: 'app/page.tsx',
    operation: 'WRITE',
    toolName: 'write_file',
    status: 'APPLIED',
    beforeState: 'PRESENT',
    afterState: 'PRESENT',
    beforeHash: 'a',
    afterHash: 'b',
    changed: true,
    syntaxValid: true,
    expectedChangePresent: true,
    expectedMarkers: [],
    diffSummary: {
      linesAdded: 1, linesRemoved: 1, bytesBefore: 100, bytesAfter: 100,
      linesBefore: 10, linesAfter: 10,
    },
    suspicious: false,
    rolledBack: false,
    rollbackVerified: null,
    decision: 'ALLOW',
    findings: [],
    ...over,
  } as MutationResult;
}

function ledger(...results: MutationResult[]): MutationLedger {
  return { results, mutationAttempts: results.length } as unknown as MutationLedger;
}

/* ------------------------------------------------------- outcome detection */

describe('R4.11 acceptance chasing is detected from what the repair actually did', () => {
  it('catches a file gutted down to a stub even when the build would pass', () => {
    // This is the real regression: the component was replaced with a comment,
    // the build went green, and the run reported success.
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      mutationLedger: ledger(mutation({
        diffSummary: {
          linesAdded: 1, linesRemoved: 24, bytesBefore: 800, bytesAfter: 7,
          linesBefore: 25, linesAfter: 1,
        },
      })),
    });
    expect(findings.map(f => f.kind)).toContain('ACCEPTANCE_CHASING');
    expect(findings[0].reason).toMatch(/emptied the implementation/);
  });

  it('catches a CONTENT_DESTROYED finding from the mutation guard', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      mutationLedger: ledger(mutation({
        findings: [{ level: 'LEVEL_4_DIFF', code: 'CONTENT_DESTROYED', detail: 'emptied' }],
      })),
    });
    expect(findings.map(f => f.kind)).toContain('ACCEPTANCE_CHASING');
  });

  it('catches an outright deletion during a non-removal task', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      mutationLedger: ledger(mutation({ afterState: 'ABSENT' })),
    });
    expect(findings[0]).toMatchObject({ kind: 'ACCEPTANCE_CHASING' });
    expect(findings[0].reason).toMatch(/deleted/);
  });

  it('leaves a legitimate removal task alone', () => {
    const objective = buildRepairObjective({
      originalTask: 'Remove the deprecated LegacyBanner component',
      originalTodoPlan: plan([todo({ files: ['app/LegacyBanner.tsx'] })]),
      failedTodoId: 'todo-1',
    });
    const findings = analyzeRepairOutcome({
      objective,
      mutationLedger: ledger(mutation({ path: 'app/LegacyBanner.tsx', afterState: 'ABSENT' })),
    });
    expect(findings).toEqual([]);
  });

  it('does not flag an ordinary small edit', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      mutationLedger: ledger(mutation()),
    });
    expect(findings).toEqual([]);
  });

  it('reports a removed acceptance observable', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      removedObservables: ['crash-beacon'],
    });
    expect(findings[0]).toMatchObject({ kind: 'ACCEPTANCE_CHASING', subject: 'crash-beacon' });
  });

  it('reports an out-of-scope change seen by workspace comparison', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      unintendedChangedFiles: ['app/footer.tsx'],
    });
    expect(findings[0]).toMatchObject({ kind: 'SCOPE_ESCAPE', subject: 'app/footer.tsx' });
  });

  it('reports a deleted test as manipulation', () => {
    const findings = analyzeRepairOutcome({
      objective: fixObjective(),
      mutationLedger: ledger(mutation({ path: 'tests/page.test.tsx', afterState: 'ABSENT' })),
    });
    expect(findings.map(f => f.kind)).toContain('TEST_MANIPULATION');
  });
});

/* ---------------------------------------------------------------- completion */

describe('R4.28/R4.29 repair completion', () => {
  const objective = fixObjective();
  const chasing: RepairSafetyFinding = {
    kind: 'ACCEPTANCE_CHASING',
    severity: 'BLOCKING',
    subject: 'app/page.tsx',
    reason: 'gutted',
    evidenceRef: 'mutation.diffSummary',
  };

  it('reports success only when every term holds', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: true,
      verificationPassed: true,
      scopeRespected: true,
      findings: [],
    });
    expect(result.state).toBe('PRIMARY_RESOLVED');
    expect(result.succeeded).toBe(true);
    expect(result.acceptancePreserved).toBe(true);
  });

  it('refuses success when verification passed but the code was gutted', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: true,
      verificationPassed: true,
      scopeRespected: true,
      findings: [chasing],
    });
    expect(result.state).toBe('ACCEPTANCE_CHASING_DETECTED');
    expect(result.succeeded).toBe(false);
    expect(result.primaryResolved).toBe(false);
    expect(result.acceptancePreserved).toBe(false);
  });

  it('reports PRIMARY_NOT_RESOLVED when the failure survives', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: false,
      verificationPassed: false,
      scopeRespected: true,
      findings: [],
    });
    expect(result.state).toBe('PRIMARY_NOT_RESOLVED');
  });

  it('reports UNKNOWN when there is no evidence either way', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: undefined,
      verificationPassed: undefined,
      scopeRespected: true,
      findings: [],
    });
    expect(result.state).toBe('UNKNOWN');
    expect(result.succeeded).toBe(false);
  });

  it('reports UNKNOWN when the required verification never ran', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: true,
      verificationPassed: true,
      requiredVerificationRan: false,
      scopeRespected: true,
      findings: [],
    });
    expect(result.state).toBe('UNKNOWN');
  });

  it('refuses success when scope escaped', () => {
    const result = evaluateRepairCompletion({
      objective,
      primaryResolved: true,
      verificationPassed: true,
      scopeRespected: false,
      findings: [],
    });
    expect(result.succeeded).toBe(false);
  });

  it('leaves acceptance UNKNOWN when there were no criteria', () => {
    const result = evaluateRepairCompletion({
      objective: buildRepairObjective({ originalTask: 'Fix the page', originalTodoPlan: plan() }),
      primaryResolved: true,
      verificationPassed: true,
      scopeRespected: true,
      findings: [],
    });
    expect(result.acceptancePreserved).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- relevance */

describe('R4.9 verification failure relevance', () => {
  const objective = fixObjective();
  const check = (over: Partial<VerificationCheck> = {}): VerificationCheck => ({
    id: 'check-1',
    category: 'deterministic',
    name: 'build',
    passed: false,
    severity: 'HIGH',
    evidence: 'build failed',
    ...over,
  } as VerificationCheck);

  it('treats a check bound to the failed Todo as relevant', () => {
    const result = classifyFailureRelevance({
      objective,
      check: check({ todoId: 'todo-1' }),
    });
    expect(result.relevance).toBe('RELEVANT');
    expect(result.evidenceRef).toBe('failedTodoId');
  });

  it('treats a check naming an in-scope artifact as relevant', () => {
    const result = classifyFailureRelevance({
      objective,
      check: check({ evidence: 'error in app/page.tsx line 3' }),
    });
    expect(result.relevance).toBe('RELEVANT');
    expect(result.artifact).toBe('app/page.tsx');
  });

  it('treats a check verifying a stated acceptance criterion as relevant', () => {
    const result = classifyFailureRelevance({
      objective,
      check: check({ acceptanceCriterion: 'The page renders the beacon' }),
    });
    expect(result.relevance).toBe('RELEVANT');
  });

  it('treats an unrelated failing artifact as incidental', () => {
    const result = classifyFailureRelevance({
      objective,
      check: check({ evidence: 'footer regression in app/footer.tsx' }),
    });
    expect(result.relevance).toBe('INCIDENTAL');
  });

  it('accepts an impact-linked artifact as relevant', () => {
    const impact = {
      changedFiles: ['app/page.tsx'],
      directlyAffected: ['app/CrashBeacon.tsx'],
      indirectlyAffected: [],
      affectedTests: [],
    } as unknown as ImpactAnalysis;
    const result = classifyFailureRelevance({
      objective,
      check: check({ evidence: 'error in app/CrashBeacon.tsx' }),
      impactAnalysis: impact,
    });
    expect(result.relevance).toBe('RELEVANT');
    expect(result.evidenceRef).toBe('impactAnalysis');
  });

  it('returns UNKNOWN when the check names nothing at all', () => {
    const result = classifyFailureRelevance({ objective, check: check({ evidence: 'something failed' }) });
    expect(result.relevance).toBe('UNKNOWN');
  });
});
