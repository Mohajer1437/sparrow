/**
 * R9 campaign infrastructure tests.
 *
 * These cover the harness, not model behaviour. Real model behaviour belongs in the
 * campaign itself; asserting that an LLM produces a particular edit would be a
 * fabricated unit test.
 */

import {
  R9_CAMPAIGN_CASES,
  R9_BENCHMARK_ROOT,
  R9_FRONTEND_ROOT,
  R9_BACKEND_ROOT,
  workspaceRootFor,
} from '../../../src/core/reliability/r9-campaign-definitions';
import {
  R9CampaignCase,
  R9ExecutionEvidence,
  assertLabelSupportedByEvidence,
  auditR9Difficulty,
  deriveExecutionLabel,
  validateR9Case,
} from '../../../src/domain/r9-campaign';

const fullEvidence: R9ExecutionEvidence = {
  pipelineInvoked: true,
  snapshotProduced: true,
  snapshotPersisted: true,
  providerInvoked: true,
  realWorkspace: true,
  backendExercised: false,
  databaseExercised: false,
};

describe('R9 case integrity', () => {
  it('every case passes structural validation', () => {
    const failures = R9_CAMPAIGN_CASES.map(c => ({ id: c.caseId, v: validateR9Case(c) })).filter(
      r => !r.v.valid,
    );
    expect(failures.map(f => `${f.id}: ${f.v.errors.join('; ')}`)).toEqual([]);
  });

  it('case ids are unique', () => {
    const ids = R9_CAMPAIGN_CASES.map(c => c.caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every prompt begins with /execute', () => {
    const bad = R9_CAMPAIGN_CASES.filter(c => !c.prompt.startsWith('/execute'));
    expect(bad.map(c => c.caseId)).toEqual([]);
  });

  it('every case carries a prompt version', () => {
    expect(R9_CAMPAIGN_CASES.every(c => c.promptVersion.length > 0)).toBe(true);
  });

  it('schedules at least the required 30 distinct tasks', () => {
    expect(R9_CAMPAIGN_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it('meets the difficulty tier minimums', () => {
    const audit = auditR9Difficulty(R9_CAMPAIGN_CASES);
    expect(audit.shortfalls).toEqual([]);
    expect(audit.meetsMinimums).toBe(true);
  });

  it('provides at least 10 repeated or variant cases', () => {
    const grouped = R9_CAMPAIGN_CASES.filter(c => c.repeatedGroupId).length;
    const groups = new Set(R9_CAMPAIGN_CASES.filter(c => c.repeatedGroupId).map(c => c.repeatedGroupId));
    // Each grouped case is executed more than once, so grouped cases * 2 is the
    // minimum number of repeat executions the campaign will schedule.
    expect(grouped * 2).toBeGreaterThanOrEqual(10);
    expect(groups.size).toBeGreaterThan(0);
  });
});

describe('R9 no-oracle-leakage rules', () => {
  it('rejects a prompt that names the file holding the answer', () => {
    const leaky: R9CampaignCase = {
      caseId: 'leaky',
      taskClass: 'R9-BE',
      difficulty: 'LOW',
      environment: 'benchmark',
      prompt: '/execute Fix the bug in server/src/tasks/tasks.repository.ts',
      promptVersion: 'v1',
      executionMode: 'STANDARD',
      requiresRepair: false,
      requiresConfirmation: false,
      expectedBehavior: 'x',
      allowedFiles: ['server/src/tasks/tasks.repository.ts'],
    };
    const result = validateR9Case(leaky);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/leaks the answer location/);
  });

  it('rejects a prompt that reveals the benchmark to the planner', () => {
    const revealing: R9CampaignCase = {
      caseId: 'reveal',
      taskClass: 'R9-BE',
      difficulty: 'LOW',
      environment: 'benchmark',
      prompt: '/execute This is a benchmark task, please add validation',
      promptVersion: 'v1',
      executionMode: 'STANDARD',
      requiresRepair: false,
      requiresConfirmation: false,
      expectedBehavior: 'x',
      allowedFiles: [],
    };
    const result = validateR9Case(revealing);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/must not reveal/);
  });

  it('no shipped case mentions being a benchmark or campaign', () => {
    const leaking = R9_CAMPAIGN_CASES.filter(c => /benchmark|campaign/i.test(c.prompt));
    expect(leaking.map(c => c.caseId)).toEqual([]);
  });

  it('requires a confirmation response when confirmation is expected', () => {
    const missing: R9CampaignCase = {
      caseId: 'noresp',
      taskClass: 'R9-CONFIRMATION',
      difficulty: 'HIGH',
      environment: 'benchmark',
      prompt: '/execute Drop a table',
      promptVersion: 'v1',
      executionMode: 'STANDARD',
      requiresRepair: false,
      requiresConfirmation: true,
      expectedBehavior: 'x',
      allowedFiles: [],
    };
    expect(validateR9Case(missing).valid).toBe(false);
  });
});

describe('R9 fixture-versus-real separation', () => {
  it('derives REAL E2E only when the whole chain is present', () => {
    expect(deriveExecutionLabel(fullEvidence)).toBe('REAL E2E');
  });

  it('degrades a hand-built snapshot to FIXTURE', () => {
    expect(deriveExecutionLabel({ ...fullEvidence, pipelineInvoked: false })).toBe('FIXTURE');
    expect(deriveExecutionLabel({ ...fullEvidence, snapshotProduced: false })).toBe('FIXTURE');
  });

  it('degrades a synthetic workspace path to FIXTURE', () => {
    expect(deriveExecutionLabel({ ...fullEvidence, realWorkspace: false })).toBe('FIXTURE');
  });

  it('degrades a pipeline run with no model call to INTEGRATION', () => {
    expect(deriveExecutionLabel({ ...fullEvidence, providerInvoked: false })).toBe('INTEGRATION');
  });

  it('degrades an unpersisted run to INTEGRATION', () => {
    expect(deriveExecutionLabel({ ...fullEvidence, snapshotPersisted: false })).toBe('INTEGRATION');
  });

  /**
   * This is the R8 defect, expressed as a regression test: R8 recorded fabricated
   * snapshots under the label REAL E2E and nothing objected.
   */
  it('rejects a REAL E2E claim backed only by a fabricated snapshot', () => {
    const fabricated: R9ExecutionEvidence = {
      pipelineInvoked: false,
      snapshotProduced: true,
      snapshotPersisted: false,
      providerInvoked: false,
      realWorkspace: false,
      backendExercised: false,
      databaseExercised: false,
    };
    const check = assertLabelSupportedByEvidence('REAL E2E', fabricated);
    expect(check.valid).toBe(false);
    expect(check.derived).toBe('FIXTURE');
    expect(check.error).toMatch(/only supports 'FIXTURE'/);
  });

  it('rejects an INTEGRATION claim when the pipeline never ran', () => {
    const check = assertLabelSupportedByEvidence('INTEGRATION', {
      ...fullEvidence,
      pipelineInvoked: false,
      snapshotProduced: false,
    });
    expect(check.valid).toBe(false);
  });

  it('permits claiming a weaker label than the evidence supports', () => {
    expect(assertLabelSupportedByEvidence('FIXTURE', fullEvidence).valid).toBe(true);
    expect(assertLabelSupportedByEvidence('INTEGRATION', fullEvidence).valid).toBe(true);
  });
});

describe('R9 campaign isolation', () => {
  it('maps each environment to a distinct workspace root', () => {
    expect(workspaceRootFor('benchmark')).toBe(R9_BENCHMARK_ROOT);
    expect(workspaceRootFor('frontend')).toBe(R9_FRONTEND_ROOT);
    expect(workspaceRootFor('backend')).toBe(R9_BACKEND_ROOT);
    expect(new Set([R9_BENCHMARK_ROOT, R9_FRONTEND_ROOT, R9_BACKEND_ROOT]).size).toBe(3);
  });

  it('never targets the reference frontend for a mutating benchmark case', () => {
    const mutatingFrontend = R9_CAMPAIGN_CASES.filter(
      c => c.environment === 'frontend' && c.executionMode === 'STANDARD' && c.allowedFiles.length > 0,
    );
    expect(mutatingFrontend.map(c => c.caseId)).toEqual([]);
  });

  it('gives read-only cases an empty allowed-file set', () => {
    const contradictory = R9_CAMPAIGN_CASES.filter(
      c => c.executionMode === 'READ_ONLY' && c.allowedFiles.length > 0,
    );
    expect(contradictory.map(c => c.caseId)).toEqual([]);
  });
});

describe('R9 campaign coverage requirements', () => {
  const count = (pred: (c: R9CampaignCase) => boolean) => R9_CAMPAIGN_CASES.filter(pred).length;

  it('includes at least 5 repair-oriented cases', () => {
    expect(count(c => c.requiresRepair || c.taskClass === 'R9-REPAIR')).toBeGreaterThanOrEqual(5);
  });

  it('includes at least 3 confirmation cases covering approve and reject', () => {
    const confirmations = R9_CAMPAIGN_CASES.filter(c => c.requiresConfirmation);
    expect(confirmations.length).toBeGreaterThanOrEqual(3);
    expect(confirmations.some(c => c.confirmationResponse === 'APPROVE')).toBe(true);
    expect(confirmations.some(c => c.confirmationResponse === 'REJECT')).toBe(true);
  });

  it('includes at least 8 backend-facing cases', () => {
    expect(
      count(c => ['R9-BE', 'R9-DB', 'R9-AUTH', 'R9-ADMIN', 'R9-CROSS_LAYER'].includes(c.taskClass)),
    ).toBeGreaterThanOrEqual(8);
  });

  it('includes at least 5 database-facing cases', () => {
    expect(count(c => ['R9-DB', 'R9-CROSS_LAYER'].includes(c.taskClass))).toBeGreaterThanOrEqual(5);
  });

  it('includes at least 5 adversarial cases', () => {
    expect(count(c => c.difficulty === 'ADVERSARIAL')).toBeGreaterThanOrEqual(5);
  });

  it('includes control cases that prove the harness itself works', () => {
    expect(count(c => c.isControl === true)).toBeGreaterThanOrEqual(3);
  });

  it('declares tempting decoy files for the scope-pressure cases', () => {
    const scopeCases = R9_CAMPAIGN_CASES.filter(c => c.difficulty === 'ADVERSARIAL');
    expect(scopeCases.some(c => (c.temptingFiles ?? []).length > 0)).toBe(true);
  });
});

describe('R9 difficulty audit', () => {
  it('reports shortfalls rather than silently passing', () => {
    const audit = auditR9Difficulty([
      { difficulty: 'LOW' } as R9CampaignCase,
      { difficulty: 'MEDIUM' } as R9CampaignCase,
    ]);
    expect(audit.meetsMinimums).toBe(false);
    expect(audit.shortfalls).toContain('LOW 1/5');
    expect(audit.shortfalls).toContain('MEDIUM 1/8');
    expect(audit.shortfalls).toContain('HIGH 0/8');
    expect(audit.shortfalls).toContain('ADVERSARIAL 0/5');
  });

  it('counts each tier independently', () => {
    const audit = auditR9Difficulty(R9_CAMPAIGN_CASES);
    expect(audit.low + audit.medium + audit.high + audit.adversarial).toBe(R9_CAMPAIGN_CASES.length);
  });
});
