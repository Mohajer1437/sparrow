import { WorkflowResult } from '../../../src/contracts/workflow-orchestrator';
import { DEFAULT_CONTEXT_GATHERING_LIMITS } from '../../../src/domain/context-gathering-limits';
import { freezeAiContextDiscovery } from '../../../src/domain/ai-context';
import {
  freezeGatheredContext,
  validateGatheredContextRecord,
} from '../../../src/domain/gathered-context';
import { freezeProjectProfile } from '../../../src/domain/project-profile';
import { PlannerContext } from '../../../src/domain/planner-context';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { TodoPlan, validateTodoPlan } from '../../../src/domain/todo-plan';
import { VerificationReport } from '../../../src/domain/verification-report';
import { FailureContract } from '../../../src/domain/failure-contract';
import { RepairAttemptHistory } from '../../../src/domain/repair-intelligence';
import { DefaultPlannerContextAssembler } from '../../../src/core/planning/planner-context-assembler';
import { PlannerContextStrategyBuilder } from '../../../src/core/planning/planner-context-strategy-builder';
import { createDefaultSkillRegistry } from '../../../src/core/skill/default-skills';

const registry = createDefaultSkillRegistry();
const assembler = new DefaultPlannerContextAssembler();
const strategyBuilder = new PlannerContextStrategyBuilder();

export const WORKSPACE_ROOT = 'E:/new-test-2';

/** A gathered-context set that covers collected, excluded, failed and truncated states. */
export function makePlannerContext(): PlannerContext {
  const projectProfile = freezeProjectProfile({
    workspaceRoot: WORKSPACE_ROOT,
    projectType: 'frontend',
    detectedFrameworks: ['nextjs'],
    languages: ['typescript'],
    packageManager: 'npm',
    availableTestingTools: ['playwright'],
    detectedDomains: ['frontend'],
    capabilities: ['frontend'],
  });
  const input = {
    userTask: 'Inspect app/page.tsx and explain its current structure. Do not modify files.',
    executionDirective: { requestedDomains: ['frontend' as const] },
    projectProfile,
    resolvedSkills: {
      skills: [registry.get('frontend.core')!],
      reasons: [{
        skillId: 'frontend.core',
        source: 'system-rule' as const,
        detail: 'project domain frontend',
      }],
      mode: 'rules' as const,
    },
    aiContext: freezeAiContextDiscovery({
      workspaceRoot: WORKSPACE_ROOT,
      rootPath: `${WORKSPACE_ROOT}/.ai`,
      exists: true,
      files: [],
    }),
  };

  const records = [
    validateGatheredContextRecord({
      source: 'SOURCE_FILES',
      reference: 'app/page.tsx',
      status: 'COLLECTED',
      reason: 'explicitly referenced by task',
      collectionMethod: 'WORKSPACE_READ',
      content: 'export default function Home() { const token = "sk-abcdefghijklmnop"; return null; }',
      truncated: true,
      sizeBytes: 82,
      maxBytes: 4096,
      priority: 1,
    }),
    validateGatheredContextRecord({
      source: 'SOURCE_FILES',
      reference: 'app/missing.tsx',
      status: 'FAILED',
      reason: 'candidate could not be read',
      collectionMethod: 'UNRESOLVED_CANDIDATE',
      error: 'ENOENT: no such file',
      truncated: false,
      sizeBytes: 0,
      priority: 3,
    }),
    validateGatheredContextRecord({
      source: 'CODEBASE_MAP',
      reference: '.ai/knowledge/codebase-map.md',
      status: 'EXCLUDED',
      reason: 'excluded by strategy for this task type',
      collectionMethod: 'STRATEGY_SKIP',
      truncated: false,
      sizeBytes: 0,
      priority: 4,
    }),
  ];

  return assembler.assemble({
    ...input,
    strategy: strategyBuilder.build(input),
    gathered: freezeGatheredContext({
      workspaceRoot: WORKSPACE_ROOT,
      records,
      totalBytes: 82,
      fileCount: 1,
      truncatedCount: 1,
      limitReached: false,
      limits: DEFAULT_CONTEXT_GATHERING_LIMITS,
    }),
  });
}

export function makeTodoPlan(): TodoPlan {
  return validateTodoPlan({
    goal: 'Explain the current structure of app/page.tsx',
    contextSummary: 'Next.js app router page with a single default export',
    affectedFiles: ['app/page.tsx'],
    constraints: ['do not modify files'],
    todos: [
      {
        id: 'todo-1',
        title: 'Read app/page.tsx',
        description: 'Read the page component and note its structure',
        reason: 'The task asks for an explanation of the current structure',
        files: ['app/page.tsx'],
        dependencies: [],
        skillIds: ['frontend.core'],
        verificationRequirements: ['typecheck'],
        risk: 'LOW',
        action: 'inspect',
      },
      {
        id: 'todo-2',
        title: 'Summarize the structure',
        description: 'Describe layout, exports and imports',
        reason: 'Deliverable of the task',
        files: ['app/page.tsx'],
        dependencies: ['todo-1'],
        skillIds: ['frontend.core'],
        verificationRequirements: ['typecheck'],
        risk: 'LOW',
        action: 'inspect',
      },
    ],
  });
}

export function makeExecutionPlan(todoPlan = makeTodoPlan()): ExecutionPlan {
  return Object.freeze({
    id: 'plan-1',
    objective: todoPlan.goal,
    complexity: 'simple' as const,
    reasoning: 'Bridged from TodoPlan',
    steps: todoPlan.todos.map((todo, index) => Object.freeze({
      id: `step-${index + 1}`,
      description: todo.title,
      type: 'analysis' as const,
      requiredTools: ['read_file'],
      expectedOutcome: todo.reason,
      expectedFiles: [...todo.files],
      skillIds: [...todo.skillIds],
      sourceTodoId: todo.id,
    })),
    affectedDomains: ['frontend'],
    validationStrategy: { requiredTests: [], successCriteria: ['structure explained'] },
    createdAt: '2026-08-28T10:00:00.000Z',
    todoPlan,
  });
}

export function makeVerificationReport(passed: boolean): VerificationReport {
  return Object.freeze({
    id: 'vv-1',
    createdAt: '2026-08-28T10:05:00.000Z',
    qualityProfile: 'STANDARD' as const,
    passed,
    checks: [
      Object.freeze({
        id: 'check-typecheck',
        category: 'deterministic' as const,
        name: 'typecheck',
        passed,
        severity: 'HIGH' as const,
        evidence: passed
          ? 'tsc exited 0'
          : 'tsc failed: app/page.tsx(12,7): error TS17001 with Authorization: Bearer abcdefghijklmnop',
      }),
    ],
    evidence: ['npm run typecheck'],
  });
}

export function makeFailureContract(overrides?: Partial<FailureContract>): FailureContract {
  const check = Object.freeze({
    id: 'check-typecheck',
    category: 'deterministic' as const,
    name: 'typecheck',
    passed: false,
    severity: 'HIGH' as const,
    evidence: 'tsc failed on app/page.tsx',
  });
  const secondaryCheck = Object.freeze({
    id: 'check-lint',
    category: 'deterministic' as const,
    name: 'lint',
    passed: false,
    severity: 'MEDIUM' as const,
    evidence: 'eslint reported 2 warnings',
  });
  const incidentalCheck = Object.freeze({
    id: 'check-console',
    category: 'browser' as const,
    name: 'console-noise',
    passed: false,
    severity: 'LOW' as const,
    evidence: 'favicon 404',
  });
  return Object.freeze({
    id: 'failure-1',
    createdAt: '2026-08-28T10:06:00.000Z',
    qualityProfile: 'STANDARD' as const,
    summary: 'typecheck failed after the edit',
    failedChecks: [check, secondaryCheck, incidentalCheck],
    acceptanceCriteria: ['page still builds'],
    repairInstructions: 'Fix the invalid JSX attribute in app/page.tsx',
    attempt: 1,
    attemptId: 'attempt-1',
    classification: 'PRIMARY' as const,
    failureType: 'typecheck',
    failedTodoId: 'todo-2',
    failedStepId: 'step-2',
    evidenceRefs: ['check-typecheck'],
    implicatedFiles: ['app/page.tsx'],
    expectation: { expectedBehavior: 'typecheck passes' },
    actual: { actualBehavior: 'typecheck fails' },
    primaryFailure: {
      role: 'PRIMARY' as const,
      check,
      category: 'deterministic',
      expectedBehavior: 'typecheck passes',
      actualBehavior: 'typecheck fails',
      requiredOutcome: 'typecheck exits 0',
    },
    secondaryFailures: [{
      role: 'SECONDARY' as const,
      check: secondaryCheck,
      category: 'deterministic',
      severity: 'MEDIUM',
      evidence: 'eslint reported 2 warnings',
    }],
    incidentalFailures: [{
      role: 'INCIDENTAL' as const,
      check: incidentalCheck,
      category: 'browser',
      severity: 'LOW',
      evidence: 'favicon 404',
    }],
    ...overrides,
  });
}

export function makeRepairHistory(): RepairAttemptHistory {
  return Object.freeze({
    attempts: Object.freeze([
      Object.freeze({
        attemptId: 'attempt-1',
        kind: 'ORIGINAL' as const,
        failedTodoId: 'todo-2',
        failedStepId: 'step-2',
        todoIds: ['todo-1', 'todo-2'],
        planFingerprint: 'app/page.tsx::inspect|Read app/page.tsx|app/page.tsx',
        expected: 'typecheck passes',
        actual: 'typecheck fails',
        filesTouched: ['app/page.tsx'],
        verificationPassed: false,
        verificationScope: 'WHOLE_RUN' as const,
        failureContractId: 'failure-1',
        evidenceRefs: ['check-typecheck'],
        expansionLevel: 0,
        outcome: 'FAILED' as const,
      }),
      Object.freeze({
        attemptId: 'attempt-2',
        kind: 'REPAIR' as const,
        failedTodoId: 'todo-2',
        todoIds: ['todo-1'],
        planFingerprint: 'app/page.tsx::modify|Fix JSX|app/page.tsx',
        filesTouched: ['app/page.tsx'],
        verificationPassed: false,
        verificationScope: 'WHOLE_RUN' as const,
        failureContractId: 'failure-1',
        evidenceRefs: ['check-typecheck'],
        expansionLevel: 1,
        outcome: 'LIMIT_REACHED' as const,
      }),
    ]),
  });
}

export function makeWorkflowResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  const plan = makeExecutionPlan();
  return Object.freeze({
    sessionId: 'session-abc',
    success: true,
    plan,
    impactReport: null,
    reviewReport: null,
    patchResult: null,
    reflection: null,
    plannerContext: makePlannerContext(),
    verificationReport: makeVerificationReport(true),
    stepResults: plan.steps.map(step => Object.freeze({
      stepId: step.id,
      success: true,
      completedAt: '2026-08-28T10:04:00.000Z',
    })),
    touchedFiles: ['app/page.tsx'],
    ...overrides,
  });
}
