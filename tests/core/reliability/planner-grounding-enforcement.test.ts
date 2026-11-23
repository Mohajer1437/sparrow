import { Workspace } from '../../../src/contracts/workspace';
import {
  validateTodoPlanGrounding,
  groundTargetPath,
  isPathExplicitlyRequested,
} from '../../../src/core/workspace/target-path-grounding';
import { TodoPlan, validateTodoPlan } from '../../../src/domain/todo-plan';
import { ExecutionPlan } from '../../../src/domain/execution-plan';
import { buildTaskOutcomeSummary } from '../../../src/app/outcome-summary-builder';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { createPlannerAllowedTargets, sanitizeRejectedTargets } from '../../../src/domain/planner-allowed-targets';
import { parseTodoPlanFromPlannerOutput } from '../../../src/core/planning/todo-plan-parser';
import { Evidence } from '../../../src/domain/pre-execution/evidence';
import { PlannerContext } from '../../../src/domain/planner-context';
import { DefaultWorkflowOrchestrator } from '../../../src/core/workflow/default-workflow-orchestrator';
import { PlannerOutputRejectedError } from '../../../src/domain/errors/todo-plan-errors';
import { projectTaskRun } from '../../../src/app/task-run-projection';

function createMockWorkspace(files: Record<string, string> = {}): Workspace {
  return {
    readFile: jest.fn().mockImplementation(async (p: string) => {
      if (files[p] !== undefined) return files[p];
      throw new Error(`ENOENT: no such file or directory: ${p}`);
    }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockImplementation(async (p: string) => files[p] !== undefined),
    listFiles: jest.fn().mockResolvedValue(Object.keys(files)),
    listEntries: jest.fn().mockResolvedValue(Object.keys(files)),
    createSnapshot: jest.fn().mockResolvedValue({ id: 'snap-1', timestamp: new Date() }),
    rollback: jest.fn().mockResolvedValue(undefined),
    diff: jest.fn().mockResolvedValue([]),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    isDirectory: jest.fn().mockImplementation(async (p: string) => {
      if (p === '.' || p === '') return true;
      const prefix = p.endsWith('/') ? p : `${p}/`;
      return Object.keys(files).some(k => k.startsWith(prefix));
    }),
  };
}

describe('Planner Todo File Grounding Enforcement', () => {
  describe('PlannerAllowedTargets from EvidenceBuilder & PlannerContext', () => {
    it('creates authoritative allowed targets from confirmed evidence and context', () => {
      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          type: 'FILE_EXISTS',
          status: 'CONFIRMED',
          source: 'package.json',
          description: 'package.json exists',
        },
        {
          id: 'ev-2',
          type: 'FILE_EXISTS',
          status: 'NOT_FOUND',
          source: 'server/src/app.module.ts',
          description: 'app.module.ts not found',
        },
        {
          id: 'ev-3',
          type: 'FILE_CONTENT',
          status: 'CONFIRMED',
          source: 'server/src/auth/tokens.ts',
          description: 'auth tokens content',
        },
      ];

      const allowed = createPlannerAllowedTargets({ evidence });
      expect(allowed.isAllowed('package.json')).toBe(true);
      expect(allowed.isAllowed('server/src/auth/tokens.ts')).toBe(true);
      expect(allowed.isAllowed('.')).toBe(true);
      expect(allowed.isAllowed('server/src/app.module.ts')).toBe(false);
      expect(allowed.isAllowed('server/src/tasks/tasks.service.ts')).toBe(false);
      expect(allowed.isAllowed('*.module.ts')).toBe(false);
    });

    it('rejects ungrounded targets during parseTodoPlanFromPlannerOutput', () => {
      const allowed = createPlannerAllowedTargets({
        verifiedFiles: ['package.json', 'server/src/auth/tokens.ts'],
      });

      const plannerJson = JSON.stringify({
        goal: 'Analyze backend',
        contextSummary: 'Analysis context',
        affectedFiles: ['server/src/app.module.ts'],
        constraints: [],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect app module',
            description: 'Inspect server/src/app.module.ts',
            reason: 'Architecture',
            files: ['server/src/app.module.ts'],
            dependencies: [],
            skillIds: ['backend.nestjs'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      expect(() => {
        parseTodoPlanFromPlannerOutput(plannerJson, { allowedTargets: allowed });
      }).toThrow(/PLANNER_UNGROUNDED_TARGET/);
    });
  });

  // Test 1: Evidence contains package.json only. Planner returns server/src/app.module.ts.
  it('Test 1: Rejects ungrounded planner file with PLANNER_UNGROUNDED_TARGET when evidence only contains package.json', async () => {
    const workspace = createMockWorkspace({
      'package.json': JSON.stringify({ name: 'test-project', dependencies: { '@nestjs/core': '^10.0.0' } }),
    });

    const todoPlan: TodoPlan = {
      goal: 'Analyze project architecture',
      contextSummary: 'Only package.json was discovered',
      affectedFiles: ['package.json', 'server/src/app.module.ts'],
      constraints: [],
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect app module',
          description: 'Inspect NestJS app module',
          reason: 'Architecture analysis',
          files: ['server/src/app.module.ts'],
          dependencies: [],
          skillIds: ['backend.nestjs'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    const prompt = 'Analyze the project architecture and detect NestJS module structure.';
    const result = await validateTodoPlanGrounding(workspace, todoPlan, prompt);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.ungroundedFiles).toContain('server/src/app.module.ts');
    expect(result.error).toContain('PLANNER_UNGROUNDED_TARGET');

    // Verify outcome summary builder outputs expected format
    const snapshot: TaskRunSnapshot = {
      taskId: 'task-1',
      runId: 'run-1',
      sessionId: 'sess-1',
      task: prompt,
      roleId: 'coder',
      workspaceRoot: 'E:/project',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'BLOCKED',
      abortReason: result.error,
    };

    const summary = buildTaskOutcomeSummary(snapshot);
    expect(summary.status).toBe('BLOCKED');
    expect(summary.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(summary.summary).toBe('Planner referenced files not grounded in workspace evidence');
    expect(summary.rejectedTargets).toEqual(['server/src/app.module.ts']);
    expect(summary.details).toEqual({ rejectedTargets: ['server/src/app.module.ts'] });
  });

  // Test 2: Evidence contains server/src/auth/tokens.ts. Planner uses it.
  it('Test 2: Accepts plan with VALID when planner references grounded files from evidence', async () => {
    const workspace = createMockWorkspace({
      'package.json': '{"name": "test"}',
      'tsconfig.json': '{}',
      'server/src/auth/tokens.ts': 'export const JWT_SECRET = "xyz";',
    });

    const todoPlan: TodoPlan = {
      goal: 'Inspect authentication token configuration',
      contextSummary: 'Auth token file exists',
      affectedFiles: ['server/src/auth/tokens.ts'],
      constraints: [],
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect token logic',
          description: 'Inspect JWT tokens',
          reason: 'Security analysis',
          files: ['server/src/auth/tokens.ts'],
          dependencies: [],
          skillIds: ['backend.api'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    const prompt = 'Analyze authentication mechanisms.';
    const result = await validateTodoPlanGrounding(workspace, todoPlan, prompt);

    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBeUndefined();
    expect(result.ungroundedFiles).toEqual([]);
    expect(result.verifiedFiles).toContain('server/src/auth/tokens.ts');
  });

  // Test 3: Adversarial prompt containing fake NestJS conventional paths returns PLANNER_UNGROUNDED_TARGET (NOT TARGET_NOT_FOUND)
  it('Test 3: Adversarial prompt mentioning fake NestJS conventional paths returns PLANNER_UNGROUNDED_TARGET when planner attempts them', async () => {
    const workspace = createMockWorkspace({
      'package.json': JSON.stringify({ name: 'test-project', dependencies: { '@nestjs/core': '^10.0.0' } }),
      'server/src/auth/tokens.ts': 'export const JWT_SECRET = "test";',
    });

    const adversarialPrompt = `Analyze the NestJS project.
Discover from filesystem:
Modules:
- server/src/app.module.ts
- server/src/tasks/tasks.module.ts
Controllers:
- server/src/tasks/tasks.controller.ts
Services:
- server/src/tasks/tasks.service.ts
Guards:
- server/src/auth/guard.ts`;

    const todoPlan: TodoPlan = {
      goal: 'Analyze architecture from prompt suggestions',
      contextSummary: 'Adversarial prompt parsing',
      affectedFiles: ['server/src/app.module.ts', 'server/src/tasks/tasks.service.ts'],
      constraints: [],
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect app module',
          description: 'Inspect server/src/app.module.ts',
          reason: 'Adversarial prompt suggestion',
          files: ['server/src/app.module.ts'],
          dependencies: [],
          skillIds: ['backend.nestjs'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
        {
          id: 'todo-2',
          title: 'Inspect tasks service',
          description: 'Inspect server/src/tasks/tasks.service.ts',
          reason: 'Adversarial prompt suggestion',
          files: ['server/src/tasks/tasks.service.ts'],
          dependencies: [],
          skillIds: ['backend.nestjs'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    const result = await validateTodoPlanGrounding(workspace, todoPlan, adversarialPrompt);

    // MUST return PLANNER_UNGROUNDED_TARGET and NOT TARGET_NOT_FOUND
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.reasonCode).not.toBe('TARGET_NOT_FOUND');
    expect(result.ungroundedFiles).toContain('server/src/app.module.ts');
    expect(result.ungroundedFiles).toContain('server/src/tasks/tasks.service.ts');

    const snapshot: TaskRunSnapshot = {
      taskId: 'task-adv',
      runId: 'run-adv',
      sessionId: 'sess-adv',
      task: adversarialPrompt,
      roleId: 'coder',
      workspaceRoot: 'E:/project',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'BLOCKED',
      abortReason: result.error,
    };

    const summary = buildTaskOutcomeSummary(snapshot);
    expect(summary.status).toBe('BLOCKED');
    expect(summary.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(summary.summary).toBe('Planner referenced files not grounded in workspace evidence');
    expect(summary.rejectedTargets).toContain('server/src/app.module.ts');
    expect(summary.rejectedTargets).toContain('server/src/tasks/tasks.service.ts');
  });

  // Test 4: Framework detection says NestJS exists. Planner cannot invent app.module.ts or Next.js layout.tsx.
  it('Test 4: Rejects plan when framework detection says NestJS exists but planner invents app.module.ts or layout.tsx', async () => {
    const workspace = createMockWorkspace({
      'package.json': JSON.stringify({ dependencies: { '@nestjs/common': '^10.0.0', 'next': '^14.0.0' } }),
      'server/src/main.ts': 'async function bootstrap() {}',
    });

    const todoPlan: TodoPlan = {
      goal: 'NestJS & Next.js Architecture mapping',
      contextSummary: 'Frameworks detected from dependencies',
      affectedFiles: ['app.module.ts', 'server/src/app.module.ts', 'app/layout.tsx'],
      constraints: [],
      todos: [
        {
          id: 'todo-1',
          title: 'Inspect root NestJS module',
          description: 'Inspect app.module.ts based on NestJS convention',
          reason: 'Framework convention assumption',
          files: ['app.module.ts', 'server/src/app.module.ts'],
          dependencies: [],
          skillIds: ['backend.nestjs'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
        {
          id: 'todo-2',
          title: 'Inspect Next.js root layout',
          description: 'Inspect app/layout.tsx based on Next.js convention',
          reason: 'Framework convention assumption',
          files: ['app/layout.tsx'],
          dependencies: [],
          skillIds: ['frontend.core'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    const prompt = 'Analyze the NestJS and Next.js project. Map module boundaries and root layout.';
    const result = await validateTodoPlanGrounding(workspace, todoPlan, prompt);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.ungroundedFiles).toContain('app.module.ts');
    expect(result.ungroundedFiles).toContain('server/src/app.module.ts');
    expect(result.ungroundedFiles).toContain('app/layout.tsx');
  });

  // Test 5: Wildcard paths (*.module.ts) cannot become concrete execution targets.
  it('Test 5: Rejects wildcard paths like *.module.ts from becoming concrete execution targets', async () => {
    const workspace = createMockWorkspace({
      'package.json': '{"name": "test"}',
    });

    const todoPlan: TodoPlan = {
      goal: 'Find all modules',
      contextSummary: 'Searching for modules',
      affectedFiles: ['*.module.ts'],
      constraints: [],
      todos: [
        {
          id: 'todo-1',
          title: 'Find all module files',
          description: 'Match *.module.ts',
          reason: 'Module discovery',
          files: ['*.module.ts'],
          dependencies: [],
          skillIds: ['backend.core'],
          verificationRequirements: ['intent-contract'],
          risk: 'LOW',
          action: 'inspect',
        },
      ],
    };

    const prompt = 'Discover all modules matching *.module.ts';
    const result = await validateTodoPlanGrounding(workspace, todoPlan, prompt);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
    expect(result.ungroundedFiles).toContain('*.module.ts');
  });

  // Test 6: Explicit single missing file requested by user returns TARGET_NOT_FOUND
  it('Test 6: Returns TARGET_NOT_FOUND when user explicitly requests a single non-existent target in Stage 2', () => {
    const snapshot: TaskRunSnapshot = {
      taskId: 'task-missing',
      runId: 'run-missing',
      sessionId: 'sess-missing',
      task: 'Inspect server/src/missing.ts',
      roleId: 'coder',
      workspaceRoot: 'E:/project',
      skills: [],
      context: [],
      execution: [],
      touchedFiles: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'BLOCKED',
      abortReason: 'TARGET_NOT_FOUND: The requested file "server/src/missing.ts" was not found in the active workspace.',
    };

    const summary = buildTaskOutcomeSummary(snapshot);
    expect(summary.status).toBe('BLOCKED');
    expect(summary.reasonCode).toBe('TARGET_NOT_FOUND');
    expect(summary.summary).toContain('The requested file "server/src/missing.ts" was not found in the active workspace');
  });

  describe('Workflow Hardening: Planner Output Rejection to BLOCKED state', () => {
    let mockSessionManager: any;
    let mockWorkspaceMemory: any;
    let mockTaskPlanner: any;
    let mockImpactAnalyzer: any;
    let mockReviewer: any;
    let mockSafePatchExecutor: any;
    let mockGitManager: any;
    let mockReflectionEngine: any;
    let mockPlanValidator: any;
    let mockVerificationStrategyEngine: any;
    let orchestrator: DefaultWorkflowOrchestrator;

    beforeEach(() => {
      mockSessionManager = {
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
        recordReflection: jest.fn().mockResolvedValue(undefined),
        recordDecision: jest.fn().mockResolvedValue(undefined),
        recordStepStarted: jest.fn().mockResolvedValue(undefined),
        recordStepCompleted: jest.fn().mockResolvedValue(undefined),
        recordStepFailed: jest.fn().mockResolvedValue(undefined),
        pauseSession: jest.fn().mockResolvedValue(undefined),
        resumeSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'executing' }),
      };

      mockWorkspaceMemory = {
        load: jest.fn().mockResolvedValue({ isEmpty: true }),
      };

      mockTaskPlanner = {
        plan: jest.fn(),
      };

      mockImpactAnalyzer = {
        analyze: jest.fn().mockResolvedValue({ targets: [], directImpacts: [] }),
      };

      mockReviewer = {
        review: jest.fn().mockResolvedValue({ failedCount: 0, passedCount: 5, checks: [] }),
      };

      mockSafePatchExecutor = {
        executeWithVerification: jest.fn().mockResolvedValue({ success: true, attempts: 1 }),
      };

      mockGitManager = {
        isRepository: jest.fn().mockResolvedValue(true),
        commit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
        status: jest.fn().mockResolvedValue({ branch: 'main', hasChanges: false, changedFiles: [], isRepo: true }),
      };

      mockReflectionEngine = {
        generate: jest.fn().mockReturnValue({ summary: 'failed' }),
      };

      mockPlanValidator = {
        validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      };

      mockVerificationStrategyEngine = {
        generate: jest.fn().mockResolvedValue({ type: 'build', commands: ['npm run build'] }),
      };

      orchestrator = new DefaultWorkflowOrchestrator(
        mockSessionManager,
        mockWorkspaceMemory,
        mockTaskPlanner,
        mockImpactAnalyzer,
        mockReviewer,
        mockSafePatchExecutor,
        mockGitManager,
        mockReflectionEngine,
        mockPlanValidator,
        mockVerificationStrategyEngine,
      );
    });

    // Case A: Planner generates valid grounded files: plan created, execution can continue
    it('Case A: Planner generates valid grounded files - plan created, execution continues', async () => {
      const validPlan: any = {
        id: 'plan-valid',
        steps: [
          {
            id: 'step-1',
            sourceTodoId: 'todo-1',
            tool: 'readFile',
            params: { path: 'package.json' },
            expectedFiles: ['package.json'],
          },
        ],
        complexity: 'LOW',
        todoPlan: {
          goal: 'Inspect package.json',
          affectedFiles: ['package.json'],
          todos: [
            {
              id: 'todo-1',
              title: 'Inspect package.json',
              files: ['package.json'],
              dependencies: [],
              skillIds: ['backend.api'],
              risk: 'LOW',
              action: 'inspect',
            },
          ],
        },
      };

      mockTaskPlanner.plan.mockResolvedValue(validPlan);

      const result = await orchestrator.execute({
        task: 'Analyze package.json in workspace',
        targetFiles: ['package.json'],
        patchRequest: { sessionId: 'sess-1', operations: [{ path: 'package.json', operation: 'modify', newContent: 'new' }] },
      });

      expect(result.success).toBe(true);
      expect(result.plan).not.toBeNull();
      expect(result.plan?.steps.length).toBe(1);
      expect(mockSafePatchExecutor.executeWithVerification).toHaveBeenCalled();
    });

    // Case B: Planner generates ungrounded files: PlannerOutputRejectedError, workflow status BLOCKED, no TodoPlan created, no executor invocation
    it('Case B: Planner generates ungrounded files - throws PlannerOutputRejectedError, workflow status BLOCKED, no plan created, no executor invocation', async () => {
      const rejectedError = new PlannerOutputRejectedError(
        'PLANNER_UNGROUNDED_TARGET: Planner referenced files not grounded in workspace evidence: server/src/app.module.ts, server/src/auth/guard.ts, server/src/db/connection.ts',
        ['server/src/app.module.ts', 'server/src/auth/guard.ts', 'server/src/db/connection.ts'],
        ['server/src/app.module.ts', 'server/src/auth/guard.ts', 'server/src/db/connection.ts'],
        'PLANNER_UNGROUNDED_TARGET',
      );

      mockTaskPlanner.plan.mockRejectedValue(rejectedError);

      const result = await orchestrator.execute({
        task: 'Analyze NestJS project architecture',
      });

      // Workflow must fail/block immediately
      expect(result.success).toBe(false);
      expect(result.abortedAt).toBe('planning');
      expect(result.abortReason).toContain('PLANNER_UNGROUNDED_TARGET');

      // DO NOT create empty TodoPlan or zero-step plan
      expect(result.plan).toBeNull();
      expect(result.executedTodoPlan).toBeUndefined();

      // No executor invocation, no reviewer invocation
      expect(mockSafePatchExecutor.executeWithVerification).not.toHaveBeenCalled();
      expect(mockReviewer.review).not.toHaveBeenCalled();

      // Project task run to snapshot & verify BLOCKED status and rejectedTargets details
      const snapshot = projectTaskRun({
        taskId: 'task-case-b',
        roleId: 'coder',
        workspaceRoot: 'E:/project',
        task: 'Analyze NestJS project architecture',
        success: false,
        workflowResult: result,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      expect(snapshot.status).toBe('BLOCKED');
      expect(snapshot.abortReason).toContain('PLANNER_UNGROUNDED_TARGET');

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('BLOCKED');
      expect(summary.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
      expect(summary.rejectedTargets).toEqual([
        'server/src/app.module.ts',
        'server/src/auth/guard.ts',
        'server/src/db/connection.ts',
      ]);
      expect(summary.details).toEqual({
        rejectedTargets: [
          'server/src/app.module.ts',
          'server/src/auth/guard.ts',
          'server/src/db/connection.ts',
        ],
      });

      // Case D: Mutation safety - changedFiles=[] and mutationAttempts=0
      expect(summary.changedFiles).toEqual([]);
      expect(snapshot.touchedFiles).toEqual([]);
      expect(snapshot.mutationSafety?.mutationAttempts ?? 0).toBe(0);
    });

    // Case C: Explicit missing target returns TARGET_NOT_FOUND, not PLANNER_UNGROUNDED_TARGET
    it('Case C: Explicit missing target returns TARGET_NOT_FOUND, not PLANNER_UNGROUNDED_TARGET', async () => {
      const snapshot: TaskRunSnapshot = {
        taskId: 'task-case-c',
        runId: 'run-case-c',
        sessionId: 'sess-case-c',
        task: 'Inspect server/src/missing.ts',
        roleId: 'coder',
        workspaceRoot: 'E:/project',
        skills: [],
        context: [],
        execution: [],
        touchedFiles: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'BLOCKED',
        abortReason: 'TARGET_NOT_FOUND: The requested file "server/src/missing.ts" was not found in the active workspace.',
      };

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('BLOCKED');
      expect(summary.reasonCode).toBe('TARGET_NOT_FOUND');
      expect(summary.reasonCode).not.toBe('PLANNER_UNGROUNDED_TARGET');
      expect(summary.summary).toContain('The requested file "server/src/missing.ts" was not found in the active workspace');
      expect(summary.changedFiles).toEqual([]);
    });

    // Precision & Directory-Only Path Elimination Tests (Requirement 5)
    describe('Precision: Exact Nested Rejected File Targets & No Directory-Only Paths', () => {
      it('sanitizeRejectedTargets filters out parent directories and preserves exact file targets', () => {
        const input = [
          'server/src',
          'server/src/auth/guard.ts',
          'server/src/auth/jwt.strategy.ts',
          'server/src/db/connection.ts',
          'server/src/auth/',
        ];

        const sanitized = sanitizeRejectedTargets(input);

        // Assert rejectedTargets contains exact file paths
        expect(sanitized).toEqual([
          'server/src/auth/guard.ts',
          'server/src/auth/jwt.strategy.ts',
          'server/src/db/connection.ts',
        ]);

        // Assert no directory-only path appears
        expect(sanitized).not.toContain('server/src');
        expect(sanitized).not.toContain('server/src/');
        expect(sanitized).not.toContain('server/src/auth');
        expect(sanitized).not.toContain('server/src/auth/');
      });

      it('Planner output with multiple invalid nested files returns exact file paths and no directory-only path in parseTodoPlanFromPlannerOutput', () => {
        const allowed = createPlannerAllowedTargets({
          verifiedFiles: ['package.json'],
        });

        const plannerJson = JSON.stringify({
          goal: 'Analyze backend modules',
          contextSummary: 'Analysis context',
          affectedFiles: ['server/src', 'server/src/auth/guard.ts'],
          constraints: [],
          todos: [
            {
              id: 'todo-1',
              title: 'Inspect guard',
              description: 'Inspect guard & jwt',
              reason: 'Security',
              files: ['server/src/auth/guard.ts', 'server/src/auth/jwt.strategy.ts'],
              dependencies: [],
              skillIds: ['backend.nestjs'],
              verificationRequirements: ['intent-contract'],
              risk: 'LOW',
              action: 'inspect',
            },
            {
              id: 'todo-2',
              title: 'Inspect connection',
              description: 'Inspect db connection',
              reason: 'Database',
              files: ['server/src/db/connection.ts'],
              dependencies: [],
              skillIds: ['backend.database-verification'],
              verificationRequirements: ['intent-contract'],
              risk: 'LOW',
              action: 'inspect',
            },
          ],
        });

        let caughtError: PlannerOutputRejectedError | null = null;
        try {
          parseTodoPlanFromPlannerOutput(plannerJson, { allowedTargets: allowed });
        } catch (err: any) {
          if (err instanceof PlannerOutputRejectedError) {
            caughtError = err;
          }
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');

        // Assert rejectedTargets contains exact file paths
        expect(caughtError?.rejectedTargets).toContain('server/src/auth/guard.ts');
        expect(caughtError?.rejectedTargets).toContain('server/src/auth/jwt.strategy.ts');
        expect(caughtError?.rejectedTargets).toContain('server/src/db/connection.ts');
        expect(caughtError?.rejectedTargets).toHaveLength(3);

        // Assert no directory-only path appears
        expect(caughtError?.rejectedTargets).not.toContain('server/src');
        expect(caughtError?.rejectedTargets).not.toContain('server/src/');
      });

      it('validateTodoPlanGrounding with multiple invalid nested files returns exact file paths and no directory path', async () => {
        const workspace = createMockWorkspace({
          'package.json': '{}',
        });

        const todoPlan: TodoPlan = {
          goal: 'Inspect backend',
          contextSummary: 'Only package.json exists',
          affectedFiles: ['server/src', 'server/src/auth/guard.ts', 'server/src/auth/jwt.strategy.ts', 'server/src/db/connection.ts'],
          constraints: [],
          todos: [
            {
              id: 'todo-1',
              title: 'Inspect guards',
              description: 'Inspect auth guard and jwt strategy',
              reason: 'Auth',
              files: ['server/src/auth/guard.ts', 'server/src/auth/jwt.strategy.ts'],
              dependencies: [],
              skillIds: ['backend.nestjs'],
              verificationRequirements: ['intent-contract'],
              risk: 'LOW',
              action: 'inspect',
            },
            {
              id: 'todo-2',
              title: 'Inspect db',
              description: 'Inspect db connection',
              reason: 'DB',
              files: ['server/src/db/connection.ts'],
              dependencies: [],
              skillIds: ['backend.database-verification'],
              verificationRequirements: ['intent-contract'],
              risk: 'LOW',
              action: 'inspect',
            },
          ],
        };

        const prompt = 'Inspect backend architecture';
        const result = await validateTodoPlanGrounding(workspace, todoPlan, prompt);

        expect(result.valid).toBe(false);
        expect(result.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');

        // Assert rejected targets are exact file paths
        expect(result.ungroundedFiles).toContain('server/src/auth/guard.ts');
        expect(result.ungroundedFiles).toContain('server/src/auth/jwt.strategy.ts');
        expect(result.ungroundedFiles).toContain('server/src/db/connection.ts');
        expect(result.ungroundedFiles).toHaveLength(3);

        // Assert no directory-only path appears
        expect(result.ungroundedFiles).not.toContain('server/src');

        const snapshot: TaskRunSnapshot = {
          taskId: 'task-precision',
          runId: 'run-precision',
          sessionId: 'sess-precision',
          task: prompt,
          roleId: 'coder',
          workspaceRoot: 'E:/project',
          skills: [],
          context: [],
          execution: [],
          touchedFiles: [],
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'BLOCKED',
          abortReason: result.error,
        };

        const summary = buildTaskOutcomeSummary(snapshot);
        expect(summary.status).toBe('BLOCKED');
        expect(summary.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
        expect(summary.rejectedTargets).toEqual([
          'server/src/auth/guard.ts',
          'server/src/auth/jwt.strategy.ts',
          'server/src/db/connection.ts',
        ]);
        expect(summary.rejectedTargets).not.toContain('server/src');
        expect(summary.reason).toContain('server/src/auth/guard.ts');
        expect(summary.reason).toContain('server/src/auth/jwt.strategy.ts');
        expect(summary.reason).toContain('server/src/db/connection.ts');
      });
    });
  });

  describe('Grounding Context Separation: context references vs execution targets', () => {
    const allowed = () => createPlannerAllowedTargets({
      verifiedFiles: ['package.json', 'app/page.tsx'],
    });

    function plannerOutput(overrides: Record<string, unknown>): string {
      return JSON.stringify({
        goal: 'Analyze the application',
        contextSummary: 'Grounded evidence available',
        constraints: [],
        ...overrides,
      });
    }

    // Case A: context-only files are allowed alongside grounded execution targets
    it('Case A: PASS when execution targets are grounded and PlannerContext files are declared as contextReferences', () => {
      const output = plannerOutput({
        affectedFiles: ['package.json'],
        contextReferences: ['.ai/backend.md', 'server/src/auth/tokens.ts'],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect manifest',
            description: 'Inspect package.json',
            reason: 'Dependency review',
            files: ['package.json'],
            contextReferences: ['.ai/backend.md', 'server/src/auth/tokens.ts'],
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      const plan = parseTodoPlanFromPlannerOutput(output, { allowedTargets: allowed() });

      expect(plan.affectedFiles).toEqual(['package.json']);
      expect(plan.todos[0].files).toEqual(['package.json']);
      expect(plan.contextReferences).toEqual(['.ai/backend.md', 'server/src/auth/tokens.ts']);

      // Context references never become execution targets.
      expect(plan.affectedFiles).not.toContain('.ai/backend.md');
      expect(plan.affectedFiles).not.toContain('server/src/auth/tokens.ts');
    });

    // Case B: ungrounded execution target still fails
    it('Case B: FAIL with PLANNER_UNGROUNDED_TARGET when files contains an ungrounded execution target', () => {
      const output = plannerOutput({
        affectedFiles: ['server/src/app.module.ts'],
        contextReferences: ['.ai/backend.md'],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect app module',
            description: 'Inspect server/src/app.module.ts',
            reason: 'Architecture',
            files: ['server/src/app.module.ts'],
            dependencies: [],
            skillIds: ['backend.nestjs'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      let caught: PlannerOutputRejectedError | null = null;
      try {
        parseTodoPlanFromPlannerOutput(output, { allowedTargets: allowed() });
      } catch (err: any) {
        if (err instanceof PlannerOutputRejectedError) caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
      expect(caught?.rejectedTargets).toContain('server/src/app.module.ts');
    });

    // Case C: mixed grounded and ungrounded targets must not partially execute
    it('Case C: FAIL when files is grounded but affectedFiles contains an ungrounded target - no partial execution', () => {
      const output = plannerOutput({
        affectedFiles: ['package.json', 'server/src/auth/guard.ts'],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect manifest',
            description: 'Inspect package.json',
            reason: 'Dependency review',
            files: ['package.json'],
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      let caught: PlannerOutputRejectedError | null = null;
      try {
        parseTodoPlanFromPlannerOutput(output, { allowedTargets: allowed() });
      } catch (err: any) {
        if (err instanceof PlannerOutputRejectedError) caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
      expect(caught?.rejectedTargets).toContain('server/src/auth/guard.ts');
      expect(caught?.rejectedTargets).not.toContain('package.json');
    });

    // Case D: context visibility must not grant execution permission
    it('Case D: context visibility does not grant execution permission', () => {
      const contextVisibleButUngrounded = 'server/src/auth/tokens.ts';
      const targets = allowed();

      // Visible through PlannerContext, but not an allowed execution target.
      expect(targets.isAllowed(contextVisibleButUngrounded)).toBe(false);

      const asContext = plannerOutput({
        affectedFiles: ['app/page.tsx'],
        contextReferences: [contextVisibleButUngrounded],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect page',
            description: 'Inspect app/page.tsx',
            reason: 'UI review',
            files: ['app/page.tsx'],
            contextReferences: [contextVisibleButUngrounded],
            dependencies: [],
            skillIds: ['frontend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      const plan = parseTodoPlanFromPlannerOutput(asContext, { allowedTargets: targets });
      expect(plan.contextReferences).toContain(contextVisibleButUngrounded);
      expect(plan.affectedFiles).not.toContain(contextVisibleButUngrounded);
      expect(plan.todos[0].files).not.toContain(contextVisibleButUngrounded);

      // The same file promoted to an execution target is rejected.
      const asExecutionTarget = plannerOutput({
        affectedFiles: ['app/page.tsx', contextVisibleButUngrounded],
        todos: [
          {
            id: 'todo-1',
            title: 'Modify tokens',
            description: 'Modify token handling',
            reason: 'Escalation attempt',
            files: [contextVisibleButUngrounded],
            dependencies: [],
            skillIds: ['backend.api'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'modify',
          },
        ],
      });

      expect(() => parseTodoPlanFromPlannerOutput(asExecutionTarget, { allowedTargets: targets }))
        .toThrow(/PLANNER_UNGROUNDED_TARGET/);
    });

    it('metadata references under .ai are never grounded as execution targets', async () => {
      const workspace = createMockWorkspace({ 'package.json': '{}' });

      const todoPlan: TodoPlan = {
        goal: 'Read project descriptors',
        contextSummary: 'Docs only',
        affectedFiles: ['package.json'],
        constraints: [],
        metadataReferences: ['.ai/backend.md', '.ai/frontend.md', '.ai/project.md'],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect manifest',
            description: 'Inspect package.json',
            reason: 'Dependencies',
            files: ['package.json'],
            metadataReferences: ['.ai/backend.md'],
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      };

      const result = await validateTodoPlanGrounding(workspace, todoPlan, 'Analyze the project');

      expect(result.valid).toBe(true);
      expect(result.ungroundedFiles).toEqual([]);
    });
  });

  describe('Execution Authority Boundary: PlannerContext visibility is not execution permission', () => {
    // PlannerContext exposes real repository files for reasoning.
    const plannerContextWith = (references: ReadonlyArray<string>): any => ({
      gathered: {
        records: references.map(reference => ({
          reference,
          source: 'SOURCE_FILES',
          status: 'COLLECTED',
        })),
      },
    });

    const CONTEXT_FILES = ['.ai/backend.md', 'server/src/auth/tokens.ts', 'types/domain.ts'];

    const authority = () => createPlannerAllowedTargets({
      plannerContext: plannerContextWith(CONTEXT_FILES),
      verifiedFiles: ['package.json', 'app/page.tsx'],
    });

    it('context references are visible but never authorized as execution targets', () => {
      const targets = authority();

      expect(targets.contextReferences).toEqual([...CONTEXT_FILES].sort());
      for (const file of CONTEXT_FILES) {
        expect(targets.isVisibleContext(file)).toBe(true);
        expect(targets.isAllowed(file)).toBe(false);
      }

      expect(targets.isAllowed('package.json')).toBe(true);
      expect(targets.isAllowed('app/page.tsx')).toBe(true);
      expect(targets.hasAuthority).toBe(true);
    });

    it('existing files that are not allowed targets are rejected, existing allowed targets are accepted', () => {
      const targets = authority();

      // Case A: exists in the repository and visible in context, but unauthorized.
      expect(targets.isAllowed('server/src/auth/tokens.ts')).toBe(false);
      // Case B: exists and authorized.
      expect(targets.isAllowed('package.json')).toBe(true);
    });

    it('context-only promotion attack: promoting context files into affectedFiles is rejected', () => {
      const output = JSON.stringify({
        goal: 'Analyze authentication',
        contextSummary: 'Context exposes auth sources',
        affectedFiles: ['package.json', 'server/src/auth/tokens.ts', 'types/domain.ts'],
        constraints: [],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect manifest',
            description: 'Inspect package.json',
            reason: 'Grounded target',
            files: ['package.json'],
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      let caught: PlannerOutputRejectedError | null = null;
      try {
        parseTodoPlanFromPlannerOutput(output, { allowedTargets: authority() });
      } catch (err: any) {
        if (err instanceof PlannerOutputRejectedError) caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught?.reasonCode).toBe('PLANNER_UNGROUNDED_TARGET');
      expect(caught?.rejectedTargets).toEqual([
        'server/src/auth/tokens.ts',
        'types/domain.ts',
      ]);
      expect(caught?.rejectedTargets).not.toContain('package.json');
    });

    it('valid context usage: authorized execution targets plus context references passes', () => {
      const output = JSON.stringify({
        goal: 'Analyze authentication',
        contextSummary: 'Context exposes auth sources',
        affectedFiles: ['package.json', 'app/page.tsx'],
        contextReferences: CONTEXT_FILES,
        constraints: [],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect authorized targets',
            description: 'Inspect package.json and app/page.tsx',
            reason: 'Both are authorized execution targets',
            files: ['package.json', 'app/page.tsx'],
            contextReferences: CONTEXT_FILES,
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      const plan = parseTodoPlanFromPlannerOutput(output, { allowedTargets: authority() });

      expect(plan.affectedFiles).toEqual(['app/page.tsx', 'package.json']);
      expect(plan.contextReferences).toEqual([...CONTEXT_FILES].sort());
      for (const file of CONTEXT_FILES) {
        expect(plan.affectedFiles).not.toContain(file);
        expect(plan.todos[0].files).not.toContain(file);
      }
    });

    it('metadata isolation: .ai files never become execution targets', () => {
      const metadata = ['.ai/backend.md', '.ai/frontend.md', '.ai/project.md'];
      const output = JSON.stringify({
        goal: 'Read project descriptors',
        contextSummary: 'Descriptors inform planning',
        affectedFiles: ['package.json', ...metadata],
        constraints: [],
        todos: [
          {
            id: 'todo-1',
            title: 'Inspect manifest',
            description: 'Inspect package.json',
            reason: 'Grounded target',
            files: ['package.json', ...metadata],
            dependencies: [],
            skillIds: ['backend.core'],
            verificationRequirements: ['intent-contract'],
            risk: 'LOW',
            action: 'inspect',
          },
        ],
      });

      const plan = parseTodoPlanFromPlannerOutput(output, { allowedTargets: authority() });

      expect(plan.affectedFiles).toEqual(['package.json']);
      expect(plan.todos[0].files).toEqual(['package.json']);
      expect(plan.metadataReferences).toEqual(metadata);
      for (const file of metadata) {
        expect(plan.affectedFiles).not.toContain(file);
        expect(plan.todos[0].files).not.toContain(file);
      }
    });
  });
});
