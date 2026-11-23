/**
 * Snapshot builders for the reliability suites.
 *
 * These are deliberately hand-written rather than produced by the pipeline so
 * a test can construct evidence shapes the pipeline does not currently emit —
 * missing verification, out-of-order repair, corrupted history — and assert
 * that measurement stays conservative.
 */

import {
  TaskRunSnapshot,
  TaskRunStatus,
  TaskRunVerificationCheck,
} from '../../../../src/domain/task-run';
import { TodoItem, TodoPlan } from '../../../../src/domain/todo-plan';

export const WORKSPACE = 'E:/new-test-2';

export function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    title: 'Add a JSX comment',
    description: 'Insert a marker comment without changing behavior',
    reason: 'requested by the user',
    files: ['app/page.tsx'],
    dependencies: [],
    skillIds: ['frontend.core'],
    verificationRequirements: ['deterministic'],
    risk: 'LOW',
    action: 'modify',
    ...overrides,
  };
}

export function makeTodoPlan(overrides: Partial<TodoPlan> = {}): TodoPlan {
  return {
    goal: 'Add a marker comment to app/page.tsx',
    contextSummary: 'Next.js frontend project',
    affectedFiles: ['app/page.tsx'],
    constraints: ['do not change visible UI'],
    todos: [makeTodo()],
    ...overrides,
  };
}

export function makeCheck(
  overrides: Partial<TaskRunVerificationCheck> = {},
): TaskRunVerificationCheck {
  return {
    id: 'deterministic-build',
    name: 'build',
    category: 'deterministic',
    severity: 'HIGH',
    passed: true,
    evidence: 'next build exited 0',
    ...overrides,
  };
}

export interface SnapshotOverrides extends Partial<TaskRunSnapshot> {
  readonly status?: TaskRunStatus;
}

/**
 * A completed frontend run with a todo plan, one succeeded step, passing
 * verification for the single required check, and clean workspace evidence.
 */
export function makeSnapshot(overrides: SnapshotOverrides = {}): TaskRunSnapshot {
  const base: TaskRunSnapshot = {
    taskId: 'task-1',
    sessionId: 'session-1',
    logSessionId: 'log-1',
    task: 'Add a JSX comment to app/page.tsx',
    roleId: 'coder',
    workspaceRoot: WORKSPACE,
    status: 'COMPLETED',
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:01:00.000Z',
    domain: 'frontend',
    project: {
      workspaceRoot: WORKSPACE,
      projectType: 'frontend',
      detectedFrameworks: ['nextjs'],
      languages: ['typescript'],
      packageManager: 'npm',
      availableTestingTools: ['playwright'],
      detectedDomains: ['frontend'],
      capabilities: ['frontend'],
    },
    skills: [{
      id: 'frontend.core',
      name: 'Frontend Core',
      domain: 'frontend',
      domains: ['frontend'],
      frameworks: ['nextjs'],
      requiredChecks: ['deterministic'],
      planningConstraints: [],
    }],
    context: [],
    todoPlan: makeTodoPlan(),
    execution: [{
      stepId: 'step-1',
      sourceTodoId: 'todo-1',
      type: 'code',
      description: 'edit app/page.tsx',
      requiredTools: ['apply_patch'],
      files: ['app/page.tsx'],
      status: 'SUCCEEDED',
      completedAt: '2026-08-28T10:00:30.000Z',
    }],
    touchedFiles: ['app/page.tsx'],
    workspaceIntegrity: {
      filesModified: ['app/page.tsx'],
      filesCreated: [],
      filesDeleted: [],
      unexpectedChanges: [],
      hasUnexpectedChanges: false,
    },
    verification: {
      id: 'vv-1',
      qualityProfile: 'STANDARD',
      passed: true,
      scope: 'WHOLE_RUN',
      checks: [makeCheck()],
      evidence: ['next build exited 0'],
      todoVerdicts: [{
        todoId: 'todo-1',
        scope: 'WHOLE_RUN',
        verdict: 'UNKNOWN',
        reason: 'verification evidence is whole-run',
      }],
    },
    versionIntelligence: {
      summary: 'next 14.2.35',
      dependenciesCount: 1,
      effectiveKnowledgeCount: 1,
      items: [{
        technology: 'next',
        declaredVersion: '^14.2.0',
        resolvedVersion: '14.2.35',
        normalizedVersion: '14.2.35',
        versionSource: 'lockfile',
        status: 'CURRENT',
        effectiveSource: 'VERSION_SPECIFIC',
        summary: 'Next.js 14 app router',
        provenance: 'bundled knowledge',
      }],
      staleCount: 0,
      conflictCount: 0,
    },
    impactAnalysis: {
      confidence: 'CONFIRMED',
      summary: '1 changed file, 1 directly affected',
      changedFiles: ['app/page.tsx'],
      directlyAffected: ['app/page.tsx'],
      indirectlyAffected: [],
      affectedEndpoints: [],
      affectedTests: [],
      affectedDomains: ['frontend'],
      relations: [],
      unknowns: [],
      limitsReached: false,
    },
    regressionPlan: {
      risk: 'LOW',
      policy: 'DIRECT_ONLY',
      directChecks: ['deterministic'],
      expandedChecks: [],
      selectedChecks: ['deterministic'],
      skippedChecks: [],
      affectedArtifacts: ['app/page.tsx'],
      verifiedArtifacts: ['app/page.tsx'],
      unverifiedArtifacts: [],
      reasons: ['low risk change confined to one file'],
    },
  };
  return { ...base, ...overrides };
}

/** A run that failed V&V, was repaired, and then passed. */
export function makeRepairedSnapshot(overrides: SnapshotOverrides = {}): TaskRunSnapshot {
  return makeSnapshot({
    taskId: 'task-repaired',
    repair: {
      outcome: 'PROCEED',
      attempts: [
        {
          attemptId: 'attempt-1',
          kind: 'ORIGINAL',
          todoIds: ['todo-1'],
          planFingerprint: 'fp-1',
          filesTouched: ['app/page.tsx'],
          verificationPassed: false,
          verificationScope: 'WHOLE_RUN',
          evidenceRefs: [],
          expansionLevel: 0,
          outcome: 'FAILED',
        },
        {
          attemptId: 'attempt-2',
          kind: 'REPAIR',
          todoIds: ['todo-1'],
          planFingerprint: 'fp-2',
          filesTouched: ['app/page.tsx'],
          verificationPassed: true,
          verificationScope: 'WHOLE_RUN',
          evidenceRefs: [],
          expansionLevel: 1,
          outcome: 'SUCCEEDED',
        },
      ],
      limits: { maxRepairAttempts: 2, maxContextExpansion: 2, maxRepairFiles: 8 },
    },
    ...overrides,
  });
}

/** A run stopped by policy before it could produce a verdict. */
export function makeBlockedSnapshot(overrides: SnapshotOverrides = {}): TaskRunSnapshot {
  return makeSnapshot({
    taskId: 'task-blocked',
    status: 'BLOCKED',
    completedAt: undefined,
    abortedAt: 'verification',
    abortReason: 'REQUIRES_TEST_CREDENTIAL: admin credential unavailable in this environment',
    verification: undefined,
    repair: { outcome: 'NEEDS_CONFIRMATION', attempts: [] },
    ...overrides,
  });
}

/** A planning-only run: a plan exists but nothing executed. */
export function makePlanningOnlySnapshot(overrides: SnapshotOverrides = {}): TaskRunSnapshot {
  return makeSnapshot({
    taskId: 'task-planning-only',
    execution: [],
    touchedFiles: [],
    workspaceIntegrity: {
      filesModified: [],
      filesCreated: [],
      filesDeleted: [],
      unexpectedChanges: [],
      hasUnexpectedChanges: false,
    },
    verification: undefined,
    skills: [],
    todoPlan: makeTodoPlan({ todos: [makeTodo({ verificationRequirements: [] })] }),
    ...overrides,
  });
}
