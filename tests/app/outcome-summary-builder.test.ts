import { buildTaskOutcomeSummary } from '../../src/app/outcome-summary-builder';
import { TaskRunSnapshot, TaskRunRepairAttemptView } from '../../src/domain/task-run';
import { formatOutcomeSummaryText } from '../../src/domain/task-outcome-summary';

function makeBaseSnapshot(overrides: Partial<TaskRunSnapshot> = {}): TaskRunSnapshot {
  return {
    taskId: 'task-test-1',
    runId: 'run-test-1',
    sessionId: 'session-test-1',
    attemptCount: 1,
    task: 'Inspect and test the project',
    roleId: 'coder',
    workspaceRoot: 'E:/new-test-2',
    status: 'COMPLETED',
    startedAt: '2026-08-30T10:00:00.000Z',
    completedAt: '2026-08-30T10:00:05.000Z',
    skills: [],
    context: [],
    execution: [],
    touchedFiles: [],
    logFileName: 'pipeline-20260830-100000.log',
    logFilePath: '.ai/logs/pipeline/pipeline-20260830-100000.log',
    executionMode: 'STANDARD',
    ...overrides,
  };
}

function makeRepairAttempt(overrides: Partial<TaskRunRepairAttemptView> = {}): TaskRunRepairAttemptView {
  return {
    attemptId: 'attempt-1',
    kind: 'RETRY',
    todoIds: ['todo-1'],
    planFingerprint: 'plan-1',
    filesTouched: ['src/app.ts'],
    verificationPassed: false,
    verificationScope: 'WHOLE_RUN',
    evidenceRefs: [],
    expansionLevel: 0,
    outcome: 'FAILED',
    ...overrides,
  };
}

describe('OutcomeSummaryBuilder & TaskOutcomeSummary Contract (UX-OUTCOME)', () => {
  describe('Success Summaries', () => {
    it('summarizes successful mutating task with proven changed files', () => {
      const snapshot = makeBaseSnapshot({
        workspaceComparison: {
          state: 'PROVEN',
          basis: 'HASH_COMPARISON',
          intendedFiles: ['app/page.tsx'],
          intendedChangedFiles: ['app/page.tsx'],
          actualChangedFiles: ['app/page.tsx'],
          unintendedChangedFiles: [],
          missingExpectedChanges: [],
          preExistingDirtyFiles: [],
          createdFiles: [],
          deletedFiles: [],
          wrongFileModification: 'NOT_PROVEN',
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.reasonCode).toBe('TASK_COMPLETED');
      expect(summary.changedFiles).toEqual(['app/page.tsx']);
      expect(summary.changedFilesEvidence).toBe('PROVEN');
      expect(summary.logFileName).toBe('pipeline-20260830-100000.log');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('✓ Task completed successfully.');
      expect(text).toContain('app/page.tsx');
      expect(text).toContain('Log: pipeline-20260830-100000.log');
    });

    it('summarizes successful read-only task with no files changed', () => {
      const snapshot = makeBaseSnapshot({
        executionMode: 'READ_ONLY',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.reasonCode).toBe('TASK_COMPLETED');
      expect(summary.changedFiles).toEqual([]);
      expect(summary.changedFilesEvidence).toBe('NO_CHANGES_PROVEN');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('✓ Task completed successfully.');
      expect(text).toContain('No files were changed.');
    });

    it('summarizes success after repair with attempt indication', () => {
      const snapshot = makeBaseSnapshot({
        attemptCount: 2,
        repair: {
          outcome: 'PROCEED',
          attempts: [
            makeRepairAttempt({
              attemptId: 'attempt-1',
              filesTouched: ['src/app.ts'],
              verificationPassed: false,
            }),
            makeRepairAttempt({
              attemptId: 'attempt-2',
              filesTouched: ['src/app.ts'],
              verificationPassed: true,
              outcome: 'PASSED',
            }),
          ],
        },
        workspaceComparison: {
          state: 'PROVEN',
          basis: 'HASH_COMPARISON',
          intendedFiles: ['src/app.ts'],
          intendedChangedFiles: ['src/app.ts'],
          actualChangedFiles: ['src/app.ts'],
          unintendedChangedFiles: [],
          missingExpectedChanges: [],
          preExistingDirtyFiles: [],
          createdFiles: [],
          deletedFiles: [],
          wrongFileModification: 'NOT_PROVEN',
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('SUCCESS_AFTER_REPAIR');
      expect(summary.reasonCode).toBe('TASK_COMPLETED_AFTER_REPAIR');
      expect(summary.changedFiles).toEqual(['src/app.ts']);

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('✓ Task completed successfully after repair.');
      expect(text).toContain('src/app.ts');
    });
  });

  describe('Failure Summaries', () => {
    it('summarizes planner failure without plan', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        error: 'Planning failed: no valid decomposition possible',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('PLANNER_FAILED');
      expect(summary.reason).toContain('Planning failed');
    });

    it('summarizes provider / LLM connection failure', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        error: 'Failed to connect to Ollama: ECONNREFUSED 127.0.0.1:11434',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('PROVIDER_FAILURE');
      expect(summary.nextAction).toContain('Ensure local Ollama instance is running');
    });

    it('summarizes validation failure', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        error: 'VALIDATION_ERROR: prompt cannot be empty',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('Mandatory Adversarial Cases (Cases 1 - 10)', () => {
    it('Case 1 — Wrong Workspace: prompt targets another project while active is different', () => {
      const snapshot = makeBaseSnapshot({
        task: 'Inspect backend components in E:\\agentic-r9-real-project',
        workspaceRoot: 'E:\\agentic-r7-backend-test',
        status: 'BLOCKED',
        abortReason: 'Requires clarification: target outside active workspace',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('BLOCKED');
      expect(summary.reasonCode).toBe('WORKSPACE_MISMATCH');
      expect(summary.expectedWorkspace).toContain('E:\\agentic-r9-real-project');
      expect(summary.activeWorkspace).toContain('E:\\agentic-r7-backend-test');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('⊘ Task blocked.');
      expect(text).toContain('Reason: The requested workspace does not match the active workspace.');
      expect(text).toContain('Expected: E:\\agentic-r9-real-project');
      expect(text).toContain('Active:   E:\\agentic-r7-backend-test');
    });

    it('Case 2 — Missing File: target file not found in active workspace', () => {
      const snapshot = makeBaseSnapshot({
        status: 'BLOCKED',
        abortReason: 'TARGET_NOT_FOUND: target file was not found in the active workspace',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('BLOCKED');
      expect(summary.reasonCode).toBe('TARGET_NOT_FOUND');
      expect(summary.reason).toBe('Target file was not found in the active workspace.');
    });

    it('Case 3 — Mutation Rolled Back: MutationGuard rollback triggered', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        mutationSafety: {
          mutationAttempts: 1,
          successfulMutations: 0,
          rejectedMutations: 0,
          blockedMutations: 0,
          rolledBackMutations: 1,
          failedMutations: 1,
          syntaxFailures: 1,
          unexpectedDiffs: 0,
          expectedChangeFailures: 0,
          rollbackFailures: 0,
          outOfScopeAttempts: 0,
          mutations: [
            {
              path: 'app/page.tsx',
              operation: 'EDIT',
              toolName: 'StrReplace',
              status: 'ROLLED_BACK',
              decision: 'REJECT',
              beforeHash: 'abc',
              afterHash: 'def',
              changed: false,
              syntaxValid: false,
              expectedChangePresent: false,
              suspicious: true,
              rolledBack: true,
              rollbackVerified: true,
              linesAdded: 5,
              linesRemoved: 2,
              bytesBefore: 100,
              bytesAfter: 120,
              failureCodes: ['SYNTAX_ERROR'],
            },
          ],
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('MUTATION_ROLLED_BACK');
      expect(summary.reason).toContain('rejected by the mutation safety policy');
    });

    it('Case 4 — Verification Failed: verification check failed', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        verification: {
          passed: false,
          scope: 'WHOLE_RUN',
          evidence: [],
          todoVerdicts: [],
          checks: [
            {
              id: 'check-1',
              name: 'deterministic-build',
              category: 'BUILD',
              severity: 'HIGH',
              passed: false,
              evidence: 'Build failed with exit code 1',
            },
          ],
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('VERIFICATION_FAILED');
      expect(summary.failurePrimaryCheck).toBe('deterministic-build');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('Primary check: deterministic-build');
    });

    it('Case 5 — Repair Limit: repair attempts reached limit', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        attemptCount: 2,
        repair: {
          outcome: 'REPAIR_LIMIT_REACHED',
          limits: {
            maxRepairAttempts: 2,
            maxContextExpansion: 2,
            maxRepairFiles: 5,
          },
          attempts: [
            makeRepairAttempt({
              attemptId: 'attempt-1',
              filesTouched: ['src/app.ts'],
              verificationPassed: false,
            }),
            makeRepairAttempt({
              attemptId: 'attempt-2',
              filesTouched: ['src/app.ts'],
              verificationPassed: false,
            }),
          ],
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('FAILED');
      expect(summary.reasonCode).toBe('REPAIR_LIMIT_REACHED');
      expect(summary.reason).toContain('Repair reached the configured attempt limit');
    });

    it('Case 6 — Confirmation: human confirmation is pending', () => {
      const snapshot = makeBaseSnapshot({
        status: 'PLANNING',
        confirmation: {
          requestId: 'conf-123',
          taskId: 'task-test-1',
          runId: 'run-test-1',
          type: 'DESTRUCTIVE_OPERATION',
          status: 'PENDING',
          reason: 'Modifying root configuration file requires human confirmation.',
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('PAUSED');
      expect(summary.reasonCode).toBe('CONFIRMATION_REQUIRED');
      expect(summary.reason).toContain('Modifying root configuration file');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('⏸ Task paused.');
      expect(text).toContain('Modifying root configuration file requires human confirmation.');
      expect(summary.summary).toContain('Human confirmation is required');
    });

    it('Case 7 — Credential: test credential required without secret leakage', () => {
      const snapshot = makeBaseSnapshot({
        status: 'PLANNING',
        confirmation: {
          requestId: 'conf-cred-123',
          taskId: 'task-test-1',
          runId: 'run-test-1',
          type: 'REQUIRES_TEST_CREDENTIAL',
          status: 'PENDING',
          reason: 'Test credential required for admin endpoint verification.',
          credentialRequirement: {
            kind: 'BEARER_TOKEN',
            environment: 'TEST',
            scope: 'admin',
            endpoints: ['/api/v1/admin'],
            reason: 'Admin endpoint access',
          },
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('PAUSED');
      expect(summary.reasonCode).toBe('CREDENTIAL_REQUIRED');
      expect(summary.reason).not.toContain('secret-token-value');

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('⏸ Task paused.');
      expect(text).toContain('Test credential required for admin endpoint verification.');
      expect(summary.summary).toContain('test credential is required');
    });

    it('Case 8 — Insufficient Evidence: workspace evidence is incomplete', () => {
      const snapshot = makeBaseSnapshot({
        status: 'COMPLETED',
        workspaceComparison: {
          state: 'INSUFFICIENT_EVIDENCE',
          basis: 'HASH_COMPARISON',
          intendedFiles: ['app/page.tsx'],
          intendedChangedFiles: [],
          actualChangedFiles: [],
          unintendedChangedFiles: [],
          missingExpectedChanges: [],
          preExistingDirtyFiles: [],
          createdFiles: [],
          deletedFiles: [],
          wrongFileModification: 'INSUFFICIENT_EVIDENCE',
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('SUCCESS_WITH_INSUFFICIENT_EVIDENCE');
      expect(summary.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
      expect(summary.changedFilesEvidence).toBe('INSUFFICIENT_EVIDENCE');
    });

    it('Case 9 — Empty Workspace Evidence: does not claim zero changes if state is INSUFFICIENT_EVIDENCE', () => {
      const snapshot = makeBaseSnapshot({
        status: 'COMPLETED',
        workspaceComparison: {
          state: 'INSUFFICIENT_EVIDENCE',
          basis: 'NONE',
          intendedFiles: ['src/foo.ts'],
          intendedChangedFiles: [],
          actualChangedFiles: [],
          unintendedChangedFiles: [],
          missingExpectedChanges: [],
          preExistingDirtyFiles: [],
          createdFiles: [],
          deletedFiles: [],
          wrongFileModification: 'INSUFFICIENT_EVIDENCE',
        },
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.changedFilesEvidence).toBe('INSUFFICIENT_EVIDENCE');
      expect(summary.status).not.toBe('SUCCESS');
    });

    it('Case 10 — Fake Log: missing log is rendered as NOT_CREATED without fabrication', () => {
      const snapshot = makeBaseSnapshot({
        logFileName: undefined,
        logFilePath: undefined,
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.logFileName).toBeUndefined();

      const text = formatOutcomeSummaryText(summary);
      expect(text).toContain('Log: NOT_CREATED');
      expect(text).not.toContain('pipeline-fake');
    });
  });

  describe('Security and Formatting Bounds', () => {
    it('does not leak stack traces or internal secrets in concise summary', () => {
      const snapshot = makeBaseSnapshot({
        status: 'FAILED',
        error: 'Error: Connection failed\n  at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1146:16)\n  secret_token=sk-1234567890',
      });

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.reason).not.toContain('at TCPConnectWrap');
      expect(summary.summary).not.toContain('sk-1234567890');
    });
  });
});
