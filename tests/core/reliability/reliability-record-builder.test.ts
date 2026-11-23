import { buildReliabilityRecord } from '../../../src/core/reliability/reliability-record-builder';
import { RELIABILITY_SCHEMA_VERSION } from '../../../src/domain/reliability';
import {
  makeBlockedSnapshot,
  makeCheck,
  makePlanningOnlySnapshot,
  makeRepairedSnapshot,
  makeSnapshot,
  makeTodo,
  makeTodoPlan,
} from './fixtures/reliability-fixtures';

describe('ReliabilityRecord (G.1, G.2)', () => {
  it('captures a complete run and stamps the schema version', () => {
    const record = buildReliabilityRecord(makeSnapshot());

    expect(record.schemaVersion).toBe(RELIABILITY_SCHEMA_VERSION);
    expect(record.taskId).toBe('task-1');
    expect(record.runId).toBe('session-1');
    expect(record.workspaceRoot).toBe('E:/new-test-2');
    expect(record.durationMs).toBe(60_000);
    expect(record.recordedStatus).toBe('COMPLETED');
    expect(record.populations).toEqual([
      'ALL_RUNS', 'EXECUTION_RUNS', 'MUTATING_EXECUTION', 'FRONTEND_RUNS',
    ]);
  });

  it('reports evidence completeness per area rather than a single verdict', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.evidenceCompleteness).toEqual({
      planning: 'COMPLETE',
      todoPlan: 'COMPLETE',
      execution: 'COMPLETE',
      verification: 'COMPLETE',
      repair: 'NOT_APPLICABLE',
      impact: 'COMPLETE',
      regression: 'COMPLETE',
      workspace: 'COMPLETE',
      overall: 'COMPLETE',
    });
  });

  it('marks missing areas rather than assuming them', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      verification: undefined,
      impactAnalysis: undefined,
      regressionPlan: undefined,
      workspaceIntegrity: undefined,
    }));

    expect(record.evidenceCompleteness.verification).toBe('MISSING');
    expect(record.evidenceCompleteness.impact).toBe('MISSING');
    expect(record.evidenceCompleteness.regression).toBe('MISSING');
    expect(record.evidenceCompleteness.workspace).toBe('MISSING');
    expect(record.evidenceCompleteness.overall).toBe('MISSING');
  });

  it('marks partial evidence when execution left pending steps', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      execution: [
        { stepId: 's1', requiredTools: [], files: [], status: 'SUCCEEDED' },
        { stepId: 's2', requiredTools: [], files: [], status: 'PENDING' },
      ],
    }));
    expect(record.execution.status).toBe('PARTIAL');
    expect(record.evidenceCompleteness.execution).toBe('PARTIAL');
  });
});

describe('Outcome classification (G.3-G.7)', () => {
  it('classifies a clean verified run as SUCCESS and first-pass success', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.outcome).toBe('SUCCESS');
    expect(record.firstPassSuccess).toBe(true);
    expect(record.suspicion.suspicious).toBe(false);
  });

  it('classifies a verified run that needed repair as SUCCESS_AFTER_REPAIR, not first-pass', () => {
    const record = buildReliabilityRecord(makeRepairedSnapshot());
    expect(record.outcome).toBe('SUCCESS_AFTER_REPAIR');
    expect(record.successAfterRepair).toBe(true);
    expect(record.firstPassSuccess).toBe(false);
    expect(record.repair.status).toBe('SUCCEEDED');
    expect(record.populations).toContain('REPAIR_RUNS');
  });

  it('does not treat a generated or executed repair plan as repair success', () => {
    // Repair ran, execution finished, but verification never passed.
    const record = buildReliabilityRecord(makeRepairedSnapshot({
      status: 'FAILED',
      verification: { ...makeSnapshot().verification!, passed: false },
    }));
    expect(record.outcome).toBe('FAILED');
    expect(record.repair.succeeded).toBe(false);
    expect(record.repair.status).toBe('FAILED');
  });

  it('keeps BLOCKED separate from FAILED', () => {
    const record = buildReliabilityRecord(makeBlockedSnapshot());
    expect(record.outcome).toBe('BLOCKED');
    expect(record.blocked).toBe(true);
    expect(record.finalFailure).toBe(false);
    expect(record.outcomeReason).toContain('REQUIRES_TEST_CREDENTIAL');
  });

  it('classifies a run that reached the repair limit as FAILED and preserves the cause', () => {
    const record = buildReliabilityRecord(makeRepairedSnapshot({
      status: 'FAILED',
      repair: {
        outcome: 'REPAIR_LIMIT_REACHED',
        attempts: [{
          attemptId: 'attempt-1',
          kind: 'REPAIR',
          todoIds: ['todo-1'],
          planFingerprint: 'fp',
          filesTouched: [],
          verificationScope: 'WHOLE_RUN',
          evidenceRefs: [],
          expansionLevel: 2,
          outcome: 'LIMIT_REACHED',
        }],
      },
    }));
    expect(record.outcome).toBe('FAILED');
    expect(record.outcomeReason).toBe('repair limit reached without passing verification');
    expect(record.repair.limitReached).toBe(true);
  });

  it('classifies a run that never reached a terminal state as ABORTED', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      status: 'EXECUTION',
      completedAt: undefined,
    }));
    expect(record.outcome).toBe('ABORTED');
    expect(record.firstPassSuccess).toBe(false);
  });

  it('never counts a repair-mode run as first-pass success, even with an empty repair history', () => {
    // The pipeline can enter a run with a failure contract without carrying
    // the previous attempt history into this snapshot.
    const record = buildReliabilityRecord(makeSnapshot({
      repair: undefined,
      contextStrategy: {
        repairMode: true,
        selectedSources: ['USER_TASK', 'FAILURE_CONTRACT'],
        requiredSources: ['USER_TASK'],
        optionalSources: [],
        excludedSources: [],
        deferredSources: [],
        missingRequired: [],
        missingOptional: [],
        reasoning: ['repair mode: seeded with a failure contract'],
      },
    }));

    expect(record.repair.repairMode).toBe(true);
    expect(record.repair.repairAttempts).toBe(0);
    expect(record.firstPassSuccess).toBe(false);
    expect(record.outcome).toBe('SUCCESS_AFTER_REPAIR');
    expect(record.populations).toContain('REPAIR_RUNS');
    expect(record.repair.status).toBe('SUCCEEDED');
  });

  it('never counts a planning-only run as first-pass success', () => {
    const record = buildReliabilityRecord(makePlanningOnlySnapshot());
    expect(record.populations).toContain('PLANNING_ONLY');
    expect(record.populations).not.toContain('EXECUTION_RUNS');
    expect(record.firstPassSuccess).toBe(false);
  });
});

describe('False PASS detection (G.16)', () => {
  it('downgrades a recorded success with no verification evidence', () => {
    const record = buildReliabilityRecord(makeSnapshot({ verification: undefined }));

    expect(record.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
    expect(record.firstPassSuccess).toBe(false);
    expect(record.suspicion.suspicious).toBe(true);
    expect(record.suspicion.findings.map(f => f.code)).toContain('VERIFICATION_NOT_RUN');
  });

  it('downgrades a recorded success that contradicts a failed verification report', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      verification: { ...makeSnapshot().verification!, passed: false },
    }));
    expect(record.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
    expect(record.suspicion.findings.map(f => f.code))
      .toContain('SUCCESS_CONTRADICTS_VERIFICATION');
  });

  it('downgrades a passing run when a required check produced no evidence', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      skills: [{
        id: 'frontend.core',
        name: 'Frontend Core',
        domain: 'frontend',
        domains: ['frontend'],
        frameworks: ['nextjs'],
        requiredChecks: ['deterministic', 'browser'],
        planningConstraints: [],
      }],
    }));

    expect(record.verification.coverage.required).toBe(2);
    expect(record.verification.coverage.executed).toBe(1);
    expect(record.verification.coverage.unknown).toBe(1);
    expect(record.outcome).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
    expect(record.suspicion.findings.map(f => f.code)).toContain('REQUIRED_CHECKS_MISSING');
  });

  it('flags affected artifacts that were neither verified nor skipped with a reason', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        affectedArtifacts: ['app/page.tsx', 'components/Card.tsx'],
        verifiedArtifacts: ['app/page.tsx'],
        unverifiedArtifacts: ['components/Card.tsx'],
        skippedChecks: [],
      },
    }));
    expect(record.suspicion.findings.map(f => f.code))
      .toContain('UNVERIFIED_AFFECTED_ARTIFACTS');
  });

  it('does not flag an unverified artifact that carries a recorded skip reason', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        affectedArtifacts: ['app/page.tsx', 'components/Card.tsx'],
        verifiedArtifacts: ['app/page.tsx'],
        unverifiedArtifacts: ['components/Card.tsx'],
        skippedChecks: [{
          check: 'browser:components/Card.tsx',
          reason: 'LOW risk policy limits verification to directly changed files',
        }],
      },
    }));
    expect(record.suspicion.findings.map(f => f.code))
      .not.toContain('UNVERIFIED_AFFECTED_ARTIFACTS');
  });
});

describe('Verification coverage (G.8)', () => {
  it('counts required, executed, passed and failed checks', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      skills: [{
        id: 'frontend.core',
        name: 'Frontend Core',
        domain: 'frontend',
        domains: ['frontend'],
        frameworks: ['nextjs'],
        requiredChecks: ['deterministic', 'browser'],
        planningConstraints: [],
      }],
      verification: {
        passed: false,
        scope: 'WHOLE_RUN',
        checks: [
          makeCheck(),
          makeCheck({ id: 'browser-runtime', category: 'browser', name: 'runtime', passed: false }),
        ],
        evidence: [],
        todoVerdicts: [],
      },
    }));

    expect(record.verification.coverage).toMatchObject({
      required: 2,
      executed: 2,
      passed: 1,
      failed: 1,
      unknown: 0,
      ratio: 1,
      state: 'PROVEN',
    });
  });

  it('reports INSUFFICIENT_EVIDENCE when no required checks are known', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      skills: [],
      todoPlan: makeTodoPlan({ todos: [makeTodo({ verificationRequirements: [] })] }),
    }));
    expect(record.verification.coverage.required).toBe(0);
    expect(record.verification.coverage.ratio).toBeNull();
    expect(record.verification.coverage.state).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('reports zero coverage, not unknown, when required checks exist and V&V never ran', () => {
    const record = buildReliabilityRecord(makeSnapshot({ verification: undefined }));
    expect(record.verification.status).toBe('NOT_RUN');
    expect(record.verification.coverage.required).toBe(1);
    expect(record.verification.coverage.executed).toBe(0);
    expect(record.verification.coverage.ratio).toBe(0);
  });
});

describe('Todo coverage (G.9)', () => {
  it('leaves todo verdicts UNKNOWN when verification evidence is whole-run', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.todoCoverage).toMatchObject({
      total: 1,
      executed: 1,
      verified: 0,
      failed: 0,
      unknown: 1,
      scope: 'WHOLE_RUN',
      state: 'UNKNOWN',
    });
  });

  it('counts a todo as verified only when a todo-specific verdict says so', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      verification: {
        ...makeSnapshot().verification!,
        scope: 'TODO_SPECIFIC',
        todoVerdicts: [{
          todoId: 'todo-1',
          scope: 'TODO_SPECIFIC',
          verdict: 'PASS',
          reason: 'todo-specific evidence',
        }],
      },
    }));
    expect(record.todoCoverage.verified).toBe(1);
    expect(record.todoCoverage.unknown).toBe(0);
    expect(record.todoCoverage.state).toBe('PROVEN');
  });

  it('counts partially executed todos', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      todoPlan: makeTodoPlan({
        todos: [makeTodo(), makeTodo({ id: 'todo-2', files: ['app/layout.tsx'] })],
      }),
    }));
    expect(record.todoCoverage.total).toBe(2);
    expect(record.todoCoverage.executed).toBe(1);
  });
});

describe('Impact coverage (G.10)', () => {
  it('counts verified and unverified affected artifacts separately', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        indirectlyAffected: ['components/Card.tsx'],
      },
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        affectedArtifacts: ['app/page.tsx', 'components/Card.tsx'],
        verifiedArtifacts: ['app/page.tsx'],
        unverifiedArtifacts: ['components/Card.tsx'],
      },
    }));
    expect(record.impactCoverage).toMatchObject({
      affected: 2,
      verified: 1,
      unverified: 1,
      ratio: 0.5,
      state: 'PROVEN',
    });
  });

  it('reports UNKNOWN impact as unknown, never as zero impact', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        confidence: 'UNKNOWN',
        directlyAffected: [],
        unknowns: ['unresolved dynamic import in app/page.tsx'],
      },
    }));
    expect(record.impactCoverage.state).toBe('UNKNOWN');
    expect(record.impactCoverage.unknown).toBe(1);
    expect(record.suspicion.findings.map(f => f.code)).toContain('IMPACT_UNKNOWN');
  });

  it('reports UNKNOWN when no impact analysis was recorded at all', () => {
    const record = buildReliabilityRecord(makeSnapshot({ impactAnalysis: undefined }));
    expect(record.impactCoverage.state).toBe('UNKNOWN');
    expect(record.impactCoverage.ratio).toBeNull();
  });
});

describe('Endpoint coverage (G.11)', () => {
  it('is NOT_APPLICABLE for a frontend run with no endpoint evidence', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.endpointCoverage.state).toBe('NOT_APPLICABLE');
    expect(record.endpointCoverage.ratio).toBeNull();
  });

  it('counts tested endpoints and preserves skip reasons', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        affectedEndpoints: ['GET /api/users', 'POST /api/users'],
      },
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        selectedChecks: ['endpoint:GET /api/users'],
        skippedChecks: [{
          check: 'endpoint:POST /api/users',
          reason: 'REQUIRES_TEST_CREDENTIAL',
        }],
      },
      verification: {
        ...makeSnapshot().verification!,
        checks: [makeCheck({
          id: 'api-get-users',
          category: 'api',
          name: 'GET /api/users',
          passed: true,
          evidence: 'GET /api/users returned 200',
        })],
      },
    }));

    expect(record.endpointCoverage.discovered).toBe(2);
    expect(record.endpointCoverage.tested).toBe(1);
    expect(record.endpointCoverage.passed).toBe(1);
    expect(record.endpointCoverage.skipped).toBe(1);
    expect(record.endpointCoverage.skipReasons).toEqual([
      { endpoint: 'POST /api/users', reason: 'REQUIRES_TEST_CREDENTIAL' },
    ]);
  });

  it('reports INSUFFICIENT_EVIDENCE when endpoint checks were selected but no api evidence exists', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      impactAnalysis: {
        ...makeSnapshot().impactAnalysis!,
        affectedEndpoints: ['GET /api/users'],
      },
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        selectedChecks: ['endpoint:GET /api/users'],
      },
    }));
    expect(record.endpointCoverage.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(record.endpointCoverage.ratio).toBeNull();
  });
});

describe('Regression metrics (G.12)', () => {
  it('never counts a skipped check as passed', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      regressionPlan: {
        ...makeSnapshot().regressionPlan!,
        selectedChecks: ['deterministic', 'browser'],
        skippedChecks: [{ check: 'browser', reason: 'no browser tooling available' }],
      },
    }));
    expect(record.regression.selected).toBe(2);
    expect(record.regression.executed).toBe(1);
    expect(record.regression.passed).toBe(1);
    expect(record.regression.skipped).toBe(1);
    expect(record.regression.ratio).toBe(0.5);
  });

  it('reports UNKNOWN when no regression plan was recorded', () => {
    const record = buildReliabilityRecord(makeSnapshot({ regressionPlan: undefined }));
    expect(record.regression.state).toBe('UNKNOWN');
    expect(record.regression.ratio).toBeNull();
  });
});

describe('Planner metrics (G.13)', () => {
  it('records a valid TodoPlan', () => {
    expect(buildReliabilityRecord(makeSnapshot()).planning).toMatchObject({
      plannerOutputStatus: 'VALID_TODO_PLAN',
      todoPlanPresent: true,
      todoCount: 1,
    });
  });

  it('keeps a provider failure distinct from a rejected plan', () => {
    const provider = buildReliabilityRecord(makeSnapshot({
      status: 'FAILED',
      todoPlan: undefined,
      execution: [],
      abortedAt: 'planning',
      abortReason: 'provider ollama unavailable: ECONNREFUSED 127.0.0.1:11434',
    }));
    const rejected = buildReliabilityRecord(makeSnapshot({
      status: 'FAILED',
      todoPlan: undefined,
      execution: [],
      abortedAt: 'planning',
      abortReason: 'planner output rejected: malformed TodoPlan JSON',
    }));

    expect(provider.planning.plannerOutputStatus).toBe('PROVIDER_FAILURE');
    expect(rejected.planning.plannerOutputStatus).toBe('OUTPUT_REJECTED');
  });

  it('classifies a planner timeout on its own', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      status: 'FAILED',
      todoPlan: undefined,
      execution: [],
      abortedAt: 'planning',
      abortReason: 'planner request timed out after 120000ms',
    }));
    expect(record.planning.plannerOutputStatus).toBe('TIMEOUT');
  });

  it('records a plan without a TodoPlan as its own state', () => {
    const record = buildReliabilityRecord(makeSnapshot({ todoPlan: undefined }));
    expect(record.planning.plannerOutputStatus).toBe('PLAN_WITHOUT_TODO_PLAN');
    expect(record.planning.todoCount).toBe(0);
  });
});

describe('Wrong-file detection (G.17)', () => {
  it('reports NOT_PROVEN when the state comparison found no unexpected change', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.execution.wrongFileModification).toBe('NOT_PROVEN');
    expect(record.execution.unintendedChangedFiles).toEqual([]);
  });

  it('reports PROVEN only for changes the state comparison attributed to the run', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceIntegrity: {
        filesModified: ['app/page.tsx', 'app/layout.tsx'],
        filesCreated: [],
        filesDeleted: [],
        unexpectedChanges: ['app/layout.tsx'],
        hasUnexpectedChanges: true,
      },
    }));
    expect(record.execution.wrongFileModification).toBe('PROVEN');
    expect(record.execution.unintendedChangedFiles).toEqual(['app/layout.tsx']);
    expect(record.suspicion.findings.map(f => f.code))
      .toContain('UNINTENDED_FILE_MODIFICATION');
  });

  it('does not blame the run for a pre-existing dirty file', () => {
    // README.md is dirty in the workspace but the state comparison never
    // attributed it to this run.
    const record = buildReliabilityRecord(makeSnapshot({
      touchedFiles: ['app/page.tsx', 'README.md'],
      workspaceIntegrity: {
        filesModified: ['app/page.tsx'],
        filesCreated: [],
        filesDeleted: [],
        unexpectedChanges: [],
        hasUnexpectedChanges: false,
      },
    }));
    expect(record.execution.wrongFileModification).toBe('NOT_PROVEN');
    expect(record.execution.unintendedChangedFiles).toEqual([]);
  });

  it('reports INSUFFICIENT_EVIDENCE when the git state is ambiguous', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      touchedFiles: ['app/page.tsx', 'README.md'],
      workspaceIntegrity: undefined,
    }));
    expect(record.execution.wrongFileModification).toBe('INSUFFICIENT_EVIDENCE');
    expect(record.execution.unintendedChangedFiles).toEqual([]);
    expect(record.execution.wrongFileBasis).toContain('pre-existing dirty files');
  });

  it('does not count a planned file as unintended even if flagged unexpected', () => {
    const record = buildReliabilityRecord(makeSnapshot({
      workspaceIntegrity: {
        filesModified: ['app/page.tsx'],
        filesCreated: [],
        filesDeleted: [],
        unexpectedChanges: ['app/page.tsx'],
        hasUnexpectedChanges: true,
      },
    }));
    expect(record.execution.unintendedChangedFiles).toEqual([]);
    expect(record.execution.wrongFileModification).toBe('NOT_PROVEN');
  });
});

describe('Repair metrics (G.15)', () => {
  it('separates attempts, expansion and duplicate detection', () => {
    const record = buildReliabilityRecord(makeRepairedSnapshot());
    expect(record.repair).toMatchObject({
      attempts: 2,
      repairAttempts: 1,
      succeeded: true,
      limitReached: false,
      blocked: false,
      duplicateDetected: false,
      maxExpansionLevel: 1,
      contextExpansionUsed: true,
    });
  });

  it('records a duplicate repair plan', () => {
    const record = buildReliabilityRecord(makeRepairedSnapshot({
      status: 'FAILED',
      repair: {
        outcome: 'DUPLICATE_REPAIR_PLAN',
        attempts: [{
          attemptId: 'attempt-1',
          kind: 'REPAIR',
          todoIds: ['todo-1'],
          planFingerprint: 'fp',
          filesTouched: [],
          verificationScope: 'WHOLE_RUN',
          evidenceRefs: [],
          expansionLevel: 0,
          outcome: 'DUPLICATE',
        }],
      },
    }));
    expect(record.repair.duplicateDetected).toBe(true);
    expect(record.repair.succeeded).toBe(false);
  });

  it('records a blocked repair without calling it a failure of the code', () => {
    const record = buildReliabilityRecord(makeBlockedSnapshot({
      repair: {
        outcome: 'NEEDS_CONTEXT',
        attempts: [{
          attemptId: 'attempt-1',
          kind: 'REPAIR',
          todoIds: ['todo-1'],
          planFingerprint: 'fp',
          filesTouched: [],
          verificationScope: 'WHOLE_RUN',
          evidenceRefs: [],
          expansionLevel: 0,
          outcome: 'BLOCKED',
        }],
      },
    }));
    expect(record.repair.blocked).toBe(true);
    expect(record.repair.status).toBe('BLOCKED');
    expect(record.outcome).toBe('BLOCKED');
  });
});

describe('Dimensions (G.22-G.24)', () => {
  it('records the framework version observed during the run', () => {
    const record = buildReliabilityRecord(makeSnapshot());
    expect(record.dimensions.frameworkVersions).toEqual(['next@14.2.35']);
    expect(record.dimensions.frameworks).toEqual(['nextjs']);
    expect(record.dimensions.skillIds).toEqual(['frontend.core']);
    expect(record.dimensions.impactConfidence).toBe('CONFIRMED');
  });

  it('leaves the skill dimension empty when no skill was attributed', () => {
    const record = buildReliabilityRecord(makeSnapshot({ skills: [] }));
    expect(record.dimensions.skillIds).toEqual([]);
  });

  it('keeps non-framework dependencies out of the framework/version dimension', () => {
    const base = makeSnapshot();
    const record = buildReliabilityRecord(makeSnapshot({
      versionIntelligence: {
        ...base.versionIntelligence!,
        items: [
          base.versionIntelligence!.items[0],
          { ...base.versionIntelligence!.items[0], technology: 'eslint', normalizedVersion: '8.57.1' },
          { ...base.versionIntelligence!.items[0], technology: '@types/node', normalizedVersion: '20.19.43' },
        ],
      },
    }));
    // Only `next` matches the project's detected `nextjs` framework.
    expect(record.dimensions.frameworkVersions).toEqual(['next@14.2.35']);
  });
});

describe('Determinism', () => {
  it('produces an identical record for identical evidence', () => {
    const a = buildReliabilityRecord(makeSnapshot());
    const b = buildReliabilityRecord(makeSnapshot());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
