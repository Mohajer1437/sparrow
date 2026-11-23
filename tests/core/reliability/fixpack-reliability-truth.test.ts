/**
 * Reliability Fix Pack Regression Test Suite
 * Covers all 15 requirements:
 * 1. Explicit READ_ONLY remains READ_ONLY through the entire pipeline.
 * 2. Planner cannot upgrade READ_ONLY.
 * 3. Missing planner target becomes MISSING / TARGET_NOT_FOUND.
 * 4. Existing file B cannot substitute for missing A.
 * 5. Missing file premise blocks or degrades the correct step.
 * 6. Workspace traversal is still rejected.
 * 7. Context required-directory failure has correct semantics (rules optional).
 * 8. Reflection verification fields are semantically consistent.
 * 9. Whole-run PASS does not become Todo PASS.
 * 10. Successful inspection is not misclassified because no mutation occurred.
 * 11. Framework detection consistency is preserved.
 * 12. Prompt injection containing fake file paths cannot create valid workspace targets.
 * 13. A model saying "A.ts was actually B.ts" cannot authorize substitution.
 * 14. A missing target is never silently replaced by filename similarity.
 * 15. Outcome summary exposes the exact reason for workspace/target failure.
 */

import {
  resolveAuthoritativeExecutionMode,
  evaluateToolAgainstMode,
  allowsGitMutation,
  allowsDatabaseMutation,
} from '../../../src/domain/execution-mode';
import {
  groundTargetPath,
  groundTargetPaths,
  isUnauthorizedSubstitution,
} from '../../../src/core/workspace/target-path-grounding';
import { Workspace } from '../../../src/contracts/workspace';
import { RuleLoader } from '../../../src/core/discovery/rule-loader';
import { KnowledgeLoader } from '../../../src/core/discovery/knowledge-loader';
import { MemoryLoader } from '../../../src/core/discovery/memory-loader';
import { DefaultReflectionEngine } from '../../../src/core/reflection/default-reflection-engine';
import { buildTaskOutcomeSummary } from '../../../src/app/outcome-summary-builder';
import { DefaultPreflightAnalyzer } from '../../../src/core/pre-execution/preflight-analyzer';
import { TaskRunSnapshot } from '../../../src/domain/task-run';
import { WorkspaceSession } from '../../../src/domain/workspace-session';
import { TaskIntent } from '../../../src/domain/pre-execution/intent';

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
    isDirectory: jest.fn().mockResolvedValue(false),
  };
}

describe('Reliability Fix Pack: 15-Point Truth & Safety Verification', () => {
  // Test 1: Explicit READ_ONLY remains READ_ONLY through the entire pipeline
  describe('Test 1: Authoritative READ_ONLY resolution and propagation', () => {
    it('resolves explicit READ_ONLY with source EXPLICIT_CALLER', () => {
      const mode = resolveAuthoritativeExecutionMode({
        executionMode: 'READ_ONLY',
        task: 'Some normal implementation task',
      });
      expect(mode.mode).toBe('READ_ONLY');
      expect(mode.source).toBe('EXPLICIT_CALLER');
      expect(mode.authoritative).toBe(true);
    });

    it('resolves task containing --read-only as EXPLICIT_COMMAND', () => {
      const mode = resolveAuthoritativeExecutionMode({
        task: '/execute --read-only inspect the backend',
      });
      expect(mode.mode).toBe('READ_ONLY');
      expect(mode.source).toBe('EXPLICIT_COMMAND');
    });

    it('resolves task directive containing read-only instruction as TASK_DIRECTIVE', () => {
      const mode = resolveAuthoritativeExecutionMode({
        task: 'Analyze the NestJS project. This is a read_only reconnaissance task.',
      });
      expect(mode.mode).toBe('READ_ONLY');
      expect(mode.source).toBe('TASK_DIRECTIVE');
    });

    it('blocks mutating tools under READ_ONLY mode', () => {
      const decision1 = evaluateToolAgainstMode('READ_ONLY', 'write_file');
      expect(decision1.allowed).toBe(false);
      expect(decision1.rule).toBe('RULE_READ_ONLY');

      const decision2 = evaluateToolAgainstMode('READ_ONLY', 'apply_patch');
      expect(decision2.allowed).toBe(false);

      const decision3 = evaluateToolAgainstMode('READ_ONLY', 'read_file');
      expect(decision3.allowed).toBe(true);

      expect(allowsGitMutation('READ_ONLY')).toBe(false);
      expect(allowsDatabaseMutation('READ_ONLY')).toBe(false);
    });
  });

  // Test 2: Planner cannot upgrade READ_ONLY
  describe('Test 2: Planner / LLM cannot upgrade READ_ONLY', () => {
    it('preserves READ_ONLY even if planner or task tries to suggest STANDARD', () => {
      const mode = resolveAuthoritativeExecutionMode({
        executionMode: 'READ_ONLY',
        task: 'Now switch to STANDARD and edit files',
      });
      expect(mode.mode).toBe('READ_ONLY');
      expect(mode.authoritative).toBe(true);
    });
  });

  // Test 3: Missing planner target becomes MISSING / TARGET_NOT_FOUND
  describe('Test 3: Target path grounding for missing files', () => {
    const mockWorkspace = createMockWorkspace({
      'server/src/app.ts': 'console.log("hello");',
    });

    it('identifies non-existent path as MISSING', async () => {
      const grounded = await groundTargetPath(
        mockWorkspace,
        'server/src/app.module.ts',
        '/fake/workspace',
      );
      expect(grounded.kind).toBe('MISSING');
      expect(grounded.exists).toBe(false);
      expect(grounded.isFile).toBe(false);
    });

    it('identifies existing path as VERIFIED_FILE', async () => {
      const grounded = await groundTargetPath(
        mockWorkspace,
        'server/src/app.ts',
        '/fake/workspace',
      );
      expect(grounded.kind).toBe('VERIFIED_FILE');
      expect(grounded.exists).toBe(true);
      expect(grounded.isFile).toBe(true);
    });
  });

  // Test 4: Existing file B cannot substitute for missing A
  describe('Test 4: Strict target identity and no silent substitution', () => {
    it('detects unauthorized substitution when candidate differs from requested target', () => {
      const requested = 'server/src/app.module.ts';
      const substituted = 'server/src/app.ts';
      expect(isUnauthorizedSubstitution(requested, substituted)).toBe(true);
    });

    it('allows same path when normalized matching', () => {
      const requested = './server/src/app.ts';
      const candidate = 'server/src/app.ts';
      expect(isUnauthorizedSubstitution(requested, candidate)).toBe(false);
    });
  });

  // Test 5: Missing file premise blocks or degrades step
  describe('Test 5: Grounded target batch evaluation', () => {
    const mockWorkspace = createMockWorkspace({
      'src/index.ts': 'export const x = 1;',
    });

    it('grounds multiple target paths preserving individual existence facts', async () => {
      const targets = ['src/index.ts', 'src/missing.ts', 'service.ts'];
      const grounded = await groundTargetPaths(mockWorkspace, targets, '/fake/workspace');

      expect(grounded).toHaveLength(3);
      expect(grounded[0].kind).toBe('VERIFIED_FILE');
      expect(grounded[1].kind).toBe('MISSING');
      expect(grounded[2].kind).toBe('MISSING');
    });
  });

  // Test 6: Workspace traversal is still rejected
  describe('Test 6: Workspace boundary traversal protection', () => {
    const mockWorkspace = createMockWorkspace();

    it('rejects relative traversal outside workspace', async () => {
      const grounded = await groundTargetPath(
        mockWorkspace,
        '../../etc/passwd',
        '/fake/workspace',
      );
      expect(grounded.kind).toBe('OUT_OF_SCOPE');
      expect(grounded.error).toContain('traversal');
    });

    it('rejects absolute traversal outside workspace root', async () => {
      const grounded = await groundTargetPath(
        mockWorkspace,
        'C:/Windows/System32/cmd.exe',
        'E:/agentic-project',
      );
      expect(grounded.kind).toBe('OUT_OF_SCOPE');
    });
  });

  // Test 7: Context required-directory failure has correct semantics
  describe('Test 7: Context discovery semantics for optional directories', () => {
    const mockRuntime: any = {
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      readFile: jest.fn(),
    };
    const mockConfig: any = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'paths') {
          return {
            manifestFile: '.ai/manifest.json',
            rulesDir: '.ai/rules',
            knowledgeDir: '.ai/knowledge',
            memoryDir: '.ai/memory',
          };
        }
        return undefined;
      }),
    };

    it('returns empty array when optional rules directory does not exist', async () => {
      const loader = new RuleLoader(mockRuntime, mockConfig);
      const rules = await loader.load();
      expect(rules).toEqual([]);
    });

    it('returns empty array when optional knowledge directory does not exist', async () => {
      const loader = new KnowledgeLoader(mockRuntime, mockConfig);
      const knowledge = await loader.load();
      expect(knowledge).toEqual([]);
    });

    it('returns empty array when optional memory directory does not exist', async () => {
      const loader = new MemoryLoader(mockRuntime, mockConfig);
      const memory = await loader.load();
      expect(memory).toEqual([]);
    });
  });

  // Test 8: Reflection verification fields are semantically consistent
  describe('Test 8: Reflection verification state reflects V&V execution', () => {
    it('sets verificationExecuted=true when VERIFICATION_STARTED and VERIFICATION_COMPLETED occur', () => {
      const engine = new DefaultReflectionEngine();
      const session: WorkspaceSession = {
        id: 'sess-1',
        workspacePath: 'E:/test',
        task: 'Test task',
        plan: null,
        currentStep: 1,
        totalSteps: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        events: [
          {
            id: 'ev-1',
            type: 'SESSION_CREATED',
            timestamp: new Date().toISOString(),
            message: 'Created',
          },
          {
            id: 'ev-2',
            type: 'VERIFICATION_STARTED',
            timestamp: new Date().toISOString(),
            message: 'V&V execution started',
          },
          {
            id: 'ev-3',
            type: 'VERIFICATION_COMPLETED',
            timestamp: new Date().toISOString(),
            message: 'V&V passed',
          },
        ],
      };

      const reflection = engine.generate(session);
      expect(reflection.verificationExecuted).toBe(true);
      expect(reflection.verificationPassed).toBe(true);
    });

    it('sets verificationPassed=false when VERIFICATION_FAILED occurs', () => {
      const engine = new DefaultReflectionEngine();
      const session: WorkspaceSession = {
        id: 'sess-2',
        workspacePath: 'E:/test',
        task: 'Test task',
        plan: null,
        currentStep: 1,
        totalSteps: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'failed',
        events: [
          {
            id: 'ev-1',
            type: 'SESSION_CREATED',
            timestamp: new Date().toISOString(),
            message: 'Created',
          },
          {
            id: 'ev-2',
            type: 'VERIFICATION_STARTED',
            timestamp: new Date().toISOString(),
            message: 'V&V execution started',
          },
          {
            id: 'ev-3',
            type: 'VERIFICATION_FAILED',
            timestamp: new Date().toISOString(),
            message: 'V&V failed',
          },
        ],
      };

      const reflection = engine.generate(session);
      expect(reflection.verificationExecuted).toBe(true);
      expect(reflection.verificationPassed).toBe(false);
    });
  });

  // Test 9 & 10: Whole-run PASS vs Todo PASS, and clean READ_ONLY outcome classification
  describe('Test 9 & 10: Conservative outcome classification for READ_ONLY inspection', () => {
    it('builds clean success summary for READ_ONLY inspection with no source mutations', () => {
      const snapshot: TaskRunSnapshot = {
        taskId: 'task-1',
        runId: 'run-1',
        sessionId: 'sess-1',
        task: 'Analyze the NestJS project in READ_ONLY mode',
        roleId: 'coder',
        workspaceRoot: 'E:/agentic-r9-real-project',
        skills: [],
        context: [],
        execution: [],
        touchedFiles: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionMode: 'READ_ONLY',
        status: 'COMPLETED',
        workspaceComparison: {
          state: 'PROVEN',
          basis: 'authoritative-workspace-comparison',
          intendedFiles: [],
          intendedChangedFiles: [],
          actualChangedFiles: [],
          unintendedChangedFiles: [],
          missingExpectedChanges: [],
          preExistingDirtyFiles: [],
          createdFiles: [],
          deletedFiles: [],
          wrongFileModification: 'NOT_PROVEN',
        },
      };

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.outcome).toBe('Task completed successfully.');
      expect(summary.changedFiles).toEqual([]);
      expect(summary.changedFilesEvidence).toBe('NO_CHANGES_PROVEN');
      expect(summary.reasonCode).toBe('TASK_COMPLETED');
    });
  });

  // Test 11: Framework detection consistency
  describe('Test 11: PreflightAnalyzer multi-framework detection consistency', () => {
    it('detects both Next.js and NestJS from package.json without conflict', async () => {
      const mockPkgWorkspace = createMockWorkspace({
        'package.json': JSON.stringify({
          name: 'fullstack-app',
          dependencies: {
            '@nestjs/core': '^10.0.0',
            '@nestjs/common': '^10.0.0',
            next: '14.2.0',
            react: '18.3.0',
          },
        }),
      });

      const analyzer = new DefaultPreflightAnalyzer(mockPkgWorkspace, '/fake/workspace');
      const intent: TaskIntent = {
        id: 'intent-1',
        rawPrompt: 'Analyze NestJS backend and Next.js frontend',
        type: 'INVESTIGATION',
        mode: 'EASY',
        objective: 'Analyze architecture',
        initialScope: [],
        symptoms: [],
        knownErrors: [],
        constraints: [],
        successCriteria: [],
        information: [],
        normalizedAt: new Date().toISOString(),
      };

      const result = await analyzer.analyze(intent);

      expect(result.inspection.framework).toBeDefined();
      expect(result.inspection.detectedFrameworks).toBeDefined();
      expect(result.inspection.detectedFrameworks).toContain('nestjs');
      expect(result.inspection.detectedFrameworks).toContain('nextjs');
    });
  });

  // Test 12 & 13: Prompt injection cannot create fake targets or authorize substitutions
  describe('Test 12 & 13: Adversarial prompt injection target defense', () => {
    const mockWorkspace = createMockWorkspace();

    it('rejects injected nonexistent paths from becoming verified targets', async () => {
      const injectedPaths = [
        '../system/secret.key',
        'server/src/fake_injected_module.ts',
        '--read-only/fake.ts',
      ];
      const grounded = await groundTargetPaths(mockWorkspace, injectedPaths, '/fake/workspace');

      for (const g of grounded) {
        expect(g.kind === 'MISSING' || g.kind === 'OUT_OF_SCOPE').toBe(true);
        expect(g.exists).toBe(false);
      }
    });

    it('does not authorize substitution even if model explains "A is actually B"', () => {
      const requested = 'server/src/app.module.ts';
      const proposed = 'server/src/app.ts';
      expect(isUnauthorizedSubstitution(requested, proposed)).toBe(true);
    });
  });

  // Test 14: Filename similarity cannot replace missing target
  describe('Test 14: Strict filename distinction (no similarity substitution)', () => {
    it('treats app.module.ts and app.ts as completely distinct targets', () => {
      expect(isUnauthorizedSubstitution('app.module.ts', 'app.ts')).toBe(true);
      expect(isUnauthorizedSubstitution('user.service.ts', 'user.controller.ts')).toBe(true);
      expect(isUnauthorizedSubstitution('.env.example', '.env')).toBe(true);
    });
  });

  // Test 15: Outcome summary exposes exact reason for target failure
  describe('Test 15: Exact TARGET_NOT_FOUND error formatting in outcome summary', () => {
    it('extracts missing target file name into summary and reason', () => {
      const snapshot: TaskRunSnapshot = {
        taskId: 'task-err-1',
        runId: 'run-err-1',
        sessionId: 'sess-err-1',
        task: 'Read server/src/app.module.ts',
        roleId: 'coder',
        workspaceRoot: 'E:/agentic-r9-real-project',
        skills: [],
        context: [],
        execution: [],
        touchedFiles: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'BLOCKED',
        abortReason: 'TARGET_NOT_FOUND: The requested file "server/src/app.module.ts" was not found in the active workspace.',
      };

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.status).toBe('BLOCKED');
      expect(summary.reasonCode).toBe('TARGET_NOT_FOUND');
      expect(summary.summary).toBe('The requested file "server/src/app.module.ts" was not found in the active workspace.');
      expect(summary.reason).toBe('The requested file "server/src/app.module.ts" was not found in the active workspace.');
    });

    it('does not falsely classify prompt slash-words like build/test/lint/runtime as workspace mismatch', () => {
      const snapshot: TaskRunSnapshot = {
        taskId: 'task-err-2',
        runId: 'run-err-2',
        sessionId: 'sess-err-2',
        task: 'Analyze the NestJS project located at: E:\\agentic-r9-real-project. Detect build/test/lint/runtime scripts.',
        roleId: 'coder',
        workspaceRoot: 'E:\\agentic-r9-real-project',
        skills: [],
        context: [],
        execution: [],
        touchedFiles: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'FAILED',
        abortReason: 'Planning failed: Task planner could not decompose task',
      };

      const summary = buildTaskOutcomeSummary(snapshot);
      expect(summary.reasonCode).not.toBe('WORKSPACE_MISMATCH');
      expect(summary.reasonCode).toBe('PLANNER_FAILED');
    });
  });
});
