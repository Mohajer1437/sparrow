import { AppFactory } from '../../core/app-factory';
import { Session, SessionState } from '../../contracts/session';
import { ConversationOrchestrator } from '../../core/conversation/conversation-orchestrator';
import { ToolDefinition } from '../../contracts/provider';
import { KnownProviders } from '../../domain/provider-id';
import { DefaultCliRole } from '../shared/cli-role';
import { loadEffectiveConfiguration } from '../../core/configuration/default-configuration-loader';
import { ExecutionLogger } from '../../core/observability/execution-logger';
import { ExecutionMode, resolveAuthoritativeExecutionMode } from '../../domain/execution-mode';
import { TaskRunSnapshot } from '../../domain/task-run';
import { formatOutcomeSummaryText } from '../../domain/task-outcome-summary';
import { buildTaskOutcomeSummary } from '../../app/outcome-summary-builder';

/**
 * R1 evidence lines. Every value comes from the recorded snapshot, so the
 * REPL shows exactly what the Web read model shows and nothing it inferred.
 */
export function formatR1Evidence(snapshot: TaskRunSnapshot): string[] {
  const lines: string[] = [];
  const comparison = snapshot.workspaceComparison;
  if (comparison) {
    lines.push('Workspace comparison: ' + comparison.state);
    lines.push('  Intended files: ' + (comparison.intendedFiles.join(', ') || '(none)'));
    lines.push('  Actual changed: ' + (comparison.actualChangedFiles.join(', ') || '(none)'));
    lines.push('  Unintended: ' + (comparison.unintendedChangedFiles.join(', ') || '(none)'));
    lines.push('  Missing expected: ' + (comparison.missingExpectedChanges.join(', ') || '(none)'));
    lines.push('  Pre-existing dirty: ' + (comparison.preExistingDirtyFiles.join(', ') || '(none)'));
    lines.push('  Wrong-file modification: ' + comparison.wrongFileModification);
  }
  const mutations = snapshot.mutationSafety;
  if (mutations) {
    lines.push(
      `Mutation safety: ${mutations.successfulMutations} applied, ${mutations.rejectedMutations} rejected, `
      + `${mutations.blockedMutations} blocked, ${mutations.rolledBackMutations} rolled back `
      + `(of ${mutations.mutationAttempts} attempt(s))`);
    for (const mutation of mutations.mutations) {
      const codes = mutation.failureCodes.length > 0 ? ` [${mutation.failureCodes.join(', ')}]` : '';
      lines.push(
        `  ${mutation.path} ${mutation.operation} → ${mutation.status}${codes} `
        + `(+${mutation.linesAdded}/-${mutation.linesRemoved}, syntax=${describeVerdict(mutation.syntaxValid)}, `
        + `expectedChange=${describeVerdict(mutation.expectedChangePresent)})`);
      if (mutation.rolledBack) {
        lines.push(`    rollback ${mutation.rollbackVerified ? 'verified' : 'FAILED'}; before=${short(mutation.beforeHash)} afterRollback=${short(mutation.afterRollbackHash)}`);
      }
    }
  }
  // R3.29: same projection the CLI and Web read; the REPL only formats it.
  const expansion = snapshot.repair?.expansion;
  if (expansion) {
    lines.push(
      `Repair context expansion: ${expansion.decision} at level ${expansion.expansionLevel}`
      + (expansion.stopCode ? ` (stop=${expansion.stopCode})` : ''));
    lines.push(`  reason: ${expansion.reason || '(none)'}`);
    lines.push(
      `  context ${expansion.previousContextFingerprint ?? '-'} -> ${expansion.contextFingerprint ?? '-'}`
      + ` · new=${expansion.newFiles.length} changed=${expansion.changedFiles.length}`
      + ` · newEvidence=${expansion.hasNewEvidence ? 'yes' : 'no'}`);
    if (expansion.selectedFiles.length > 0) {
      lines.push('  selected: ' + expansion.selectedFiles.join(', '));
    }
    for (const item of expansion.missingEvidence) {
      lines.push(`  missing ${item.kind}: ${item.reference}`
        + ` (${item.resolved ? 'found in workspace' : 'NOT FOUND'})`);
    }
    for (const item of expansion.rejected) {
      lines.push(`  rejected ${item.path}: ${item.rejection}`);
    }
  }
  // R4.35: the same projection again; the REPL never re-derives the verdict.
  const target = snapshot.repair?.target;
  if (target) {
    lines.push('Repair target:');
    lines.push(`  original Todo: ${target.originalTodoId ?? '(unknown)'}`);
    lines.push(`  intent: ${target.intent} (${target.intentConfidence})`);
    lines.push(`  acceptance: ${target.acceptanceCriteria.length > 0
      ? target.acceptanceCriteria.join(' | ')
      : 'UNKNOWN'}`);
    lines.push(`  allowed files: ${target.allowedFiles.join(', ') || '(none)'}`);
    lines.push(`  allowed operations: ${target.allowedOperations.join(', ') || '(none)'}`);
    lines.push(`  proposed: ${target.proposedFiles.join(', ') || '(none)'}`
      + ` [${target.proposedOperations.join(', ') || 'none'}]`);
    lines.push(`  decision: ${target.decision}`);
    if (target.decision !== 'ALLOW') lines.push(`  reason: ${target.decisionReason}`);
    for (const finding of target.findings) {
      lines.push(`  finding=${finding.kind} severity=${finding.severity}`
        + ` subject=${finding.subject}`);
      lines.push(`    reason=${finding.reason}`);
    }
    if (target.completion) {
      lines.push(`  completion: ${target.completion.state}`
        + ` · acceptance=${target.completion.acceptancePreserved === undefined
          ? 'UNKNOWN'
          : target.completion.acceptancePreserved ? 'PRESERVED' : 'NOT_PRESERVED'}`
        + ` · scope=${target.completion.scopeRespected ? 'OK' : 'ESCAPED'}`);
      lines.push(`    ${target.completion.reason}`);
    }
  }
  const todoVerification = snapshot.todoVerification;
  if (todoVerification) {
    lines.push('Todo verification scope: ' + todoVerification.scope);
    for (const verdict of todoVerification.verdicts) {
      lines.push(`  ${verdict.todoId} = ${verdict.verdict} (${verdict.scope}) — ${verdict.reason}`);
    }
  }
  const sideEffects = snapshot.verificationSideEffects;
  if (sideEffects) {
    lines.push(`V&V side effects: policy=${sideEffects.policy} performed=${sideEffects.performedCount} blocked=${sideEffects.blockedCount}`);
  }
  const confirmation = snapshot.confirmation;
  if (confirmation) {
    lines.push('Confirmation:');
    if (confirmation.requestId) lines.push(`  ID: ${confirmation.requestId}`);
    if (confirmation.type) lines.push(`  Type: ${confirmation.type}`);
    if (confirmation.status) lines.push(`  Status: ${confirmation.status}`);
    if (confirmation.risk) lines.push(`  Risk: ${confirmation.risk}`);
    if (confirmation.reason) lines.push(`  Reason: ${confirmation.reason}`);
    if (confirmation.affectedFiles && confirmation.affectedFiles.length > 0) {
      lines.push(`  Affected Files: ${confirmation.affectedFiles.join(', ')}`);
    }
  }
  return lines;
}

/** An unavailable verdict is shown as UNKNOWN, never as a pass. */
function describeVerdict(value: boolean | null): string {
  return value === null ? 'UNKNOWN' : value ? 'OK' : 'FAIL';
}

function short(hash: string | undefined): string {
  return hash ? hash.slice(0, 12) : '(none)';
}

export class ReplSession {
  private orchestrator!: ConversationOrchestrator;
  private session!: Session;
  private sessionState!: SessionState;
  private toolDefinitions!: ReadonlyArray<ToolDefinition>;
  
  constructor(
    private readonly factory: AppFactory,
    public readonly workspacePath: string,
    public readonly model: string
  ) {}

  async initialize(): Promise<void> {
    const config = this.factory.createConfiguration();
    await config.load();
    
    const effectiveConfig = await loadEffectiveConfiguration(this.workspacePath);
    const limits = effectiveConfig.contextLimits;
    this.session = this.factory.createSession();
    this.orchestrator = this.factory.createConversationOrchestrator(config, limits, this.session);
    this.toolDefinitions = this.factory.createToolDefinitions();
    this.sessionState = await this.session.start('REPL Session');
    ExecutionLogger.init(this.workspacePath, this.sessionState.id);

    // Load user-defined role assignments from disk
    try {
      const assignmentService = this.factory.createRoleAssignmentService();
      await assignmentService.reload();
    } catch {
      // Non-fatal: use default assignments if reload fails
    }
  }

  async ask(message: string): Promise<string> {
    // Read model from coder role assignment
    const assignmentService = this.factory.createRoleAssignmentService();
    await assignmentService.reload();
    const coderAssignment = await assignmentService.getAssignment('coder');

    const model = coderAssignment?.modelId ?? this.model;
    const providerId = coderAssignment?.providerId
      ? (coderAssignment.providerId as any)
      : KnownProviders.OLLAMA;

    ExecutionLogger.log('REPL', 'coder', model, `Task: "${message.substring(0, 100)}"`, {
      assignmentSource: coderAssignment?.source ?? 'default',
      providerId: String(providerId),
    });

    const response = await this.orchestrator.handleTurn({
      sessionId: this.sessionState.id,
      message,
      role: new DefaultCliRole(),
      providerId,
      model,
      tools: this.toolDefinitions
    });
    return response.content;
  }

  async executeTask(task: string, requestedMode?: ExecutionMode): Promise<string> {
    const modeResolution = resolveAuthoritativeExecutionMode({
      executionMode: requestedMode,
      task,
    });
    const executionMode = modeResolution.mode;
    ExecutionLogger.log('REPL', 'coder', '-', 'Pipeline execution: ' + task.substring(0, 100), {
      executionMode,
    });

    await this.factory.discoverOllamaModels();

    // The REPL owns presentation only; the pipeline runs through the shared
    // application service that the Web API observes.
    const outcome = await this.factory.createTaskExecutionService().execute({
      roleId: 'coder',
      task,
      sessionId: this.sessionState?.id,
      executionMode,
    });
    const result: any = outcome.result;

    const lines: string[] = [];
    lines.push('Task id: ' + outcome.taskId);
    lines.push('Run id: ' + outcome.runId);
    if (this.sessionState?.id) {
      lines.push('Session id: ' + this.sessionState.id);
    }
    lines.push('Execution Mode: ' + (outcome.snapshot.executionMode ?? executionMode));
    lines.push(...formatR1Evidence(outcome.snapshot));

    const truth = outcome.snapshot.finalTruth;
    const authoritativeSuccess = truth
      ? truth.status === 'COMPLETED'
      : result.success;

    if (authoritativeSuccess) {
      lines.push('PIPELINE COMPLETED SUCCESSFULLY');
      lines.push('  FinalTruth: COMPLETED');
      const wf: any = result.workflowResult;
      if (wf) {
        lines.push('  Session: ' + (wf.sessionId || 'N/A'));
        if (wf.productAnalysis) {
          const goal = wf.productAnalysis.intent?.userGoal || wf.productAnalysis.objective;
          lines.push('  Product QA goal: ' + goal);
          lines.push('  Acceptance criteria: ' + (wf.productAnalysis.acceptanceCriteria || []).length);
          lines.push('  Assumptions: ' + (wf.productAnalysis.assumptions || []).length);
        }
        if (wf.plannerContext) {
          const ctx = wf.plannerContext;
          lines.push('  Context strategy: repairMode=' + ctx.repairMode);
          lines.push('  Project: ' + ctx.projectProfile.projectType
            + ' frameworks=' + (ctx.projectProfile.detectedFrameworks.join(',') || '(none)'));
          lines.push('  Skills: ' + (ctx.resolvedSkills.skills.map((s: { id: string }) => s.id).join(', ') || '(none)')
            + ' (' + ctx.resolvedSkills.mode + ')');
          lines.push('  Selected: ' + (ctx.strategy.selectedSources.join(', ') || '(none)'));
          lines.push('  Excluded: ' + (ctx.strategy.excludedSources.join(', ') || '(none)'));
          lines.push('  Deferred: ' + (ctx.strategy.deferredSources.join(', ') || '(none)'));
          if (ctx.strategy.missingRequired.length > 0) {
            lines.push('  Missing required: ' + ctx.strategy.missingRequired.join(', '));
          }
        }
        if (wf.plan) {
          lines.push('  Plan: ' + wf.plan.steps.length + ' steps, complexity: ' + wf.plan.complexity);
          if (wf.plan.todoPlan) {
            lines.push('  TodoPlan: ' + wf.plan.todoPlan.todos.length + ' todos; goal=' + wf.plan.todoPlan.goal);
            lines.push('  Affected files: ' + (wf.plan.todoPlan.affectedFiles.join(', ') || '(none)'));
          }
        }
        if (wf.impactReport?.analysis) {
          lines.push('  Impact: ' + wf.impactReport.analysis.summary);
          lines.push('  Impact Confidence: ' + wf.impactReport.analysis.confidence);
        }
        if (wf.regressionPlan) {
          lines.push('  Regression Policy: ' + wf.regressionPlan.policy);
          lines.push('  Regression Checks: ' + wf.regressionPlan.selectedChecks.join(', '));
        }
        if (wf.patchResult) {
          lines.push('  Patch: ' + (wf.patchResult.success ? 'applied' : 'failed'));
        }
        if (wf.reflection && wf.reflection.summary) {
          lines.push('  Reflection: ' + wf.reflection.summary);
        }
      }
    } else {
      lines.push('PIPELINE FAILED');
      if (truth) {
        lines.push('  FinalTruth: ' + truth.status + (truth.reason ? ` (${truth.reason})` : ''));
      }
      lines.push('  Error: ' + (result.error || truth?.reason || 'Unknown error'));
      const wf: any = result.workflowResult;
      if (wf) {
        if (wf.abortedAt) lines.push('  Aborted at: ' + wf.abortedAt);
        if (wf.abortReason) lines.push('  Reason: ' + wf.abortReason);
        if (wf.abortedAt === 'product-validation' && wf.productAnalysis) {
          lines.push('  Product QA checkpoint (single human checkpoint):');
          const questions = wf.productAnalysis.checkpointQuestions || [];
          if (questions.length > 0) {
            for (const question of questions) {
              lines.push('  Q: ' + question.question);
              if (question.context) lines.push('    Context: ' + question.context);
              if (question.options && question.options.length > 0) {
                lines.push('    Options: ' + question.options.join(' | '));
              }
            }
          }
        }
        if (wf.sessionId) lines.push('  Session: ' + wf.sessionId);
        if (wf.impactReport?.analysis) {
          lines.push('  Impact: ' + wf.impactReport.analysis.summary);
          lines.push('  Impact Confidence: ' + wf.impactReport.analysis.confidence);
        }
        if (wf.regressionPlan) {
          lines.push('  Regression Policy: ' + wf.regressionPlan.policy);
          lines.push('  Regression Checks: ' + wf.regressionPlan.selectedChecks.join(', '));
        }
        if (wf.plannerContext) {
          const ctx = wf.plannerContext;
          lines.push('  Context strategy: repairMode=' + ctx.repairMode);
          lines.push('  Skills: ' + (ctx.resolvedSkills.skills.map((s: { id: string }) => s.id).join(', ') || '(none)'));
          lines.push('  Selected: ' + (ctx.strategy.selectedSources.join(', ') || '(none)'));
        }
      }
    }

    const summary = outcome.outcomeSummary ?? buildTaskOutcomeSummary(outcome.snapshot);
    lines.push('');
    lines.push(formatOutcomeSummaryText(summary));

    return lines.join('\n');
  }

  async runKnowledgePipeline(model?: string): Promise<string> {
    ExecutionLogger.log('REPL', 'coder', '-', 'Knowledge pipeline started');

    await this.factory.discoverOllamaModels();
    // Read model from role assignment (coder) if not explicitly specified
    let effectiveModel = model;
    if (!effectiveModel) {
      try {
        const assignmentRegistry = this.factory.createRoleAssignmentRegistry();
        const coderAssignment = assignmentRegistry.get('coder');
        effectiveModel = coderAssignment?.modelId || this.model;
      } catch { effectiveModel = this.model; }
    }
    const pipeline = this.factory.createKnowledgePipeline(effectiveModel);

    const result = await pipeline.execute();

    const lines: string[] = [];
    if (result.success) {
      lines.push('KNOWLEDGE PIPELINE COMPLETED SUCCESSFULLY');
      lines.push('  Files:');
      lines.push('    ' + result.files.architecturalMap);
      lines.push('    ' + result.files.codebaseMap);
      lines.push('    ' + result.files.knowledgeBase);
      if (result.modes) {
        lines.push('  Modes:');
        lines.push('    Architectural Map: ' + (result.modes.architecturalMap ?? 'unknown'));
        lines.push('    Codebase Map: ' + (result.modes.codebaseMap ?? 'unknown'));
        lines.push('    Knowledge Base: ' + (result.modes.knowledgeBase ?? 'unknown'));
      }
    } else {
      lines.push('KNOWLEDGE PIPELINE FAILED');
      if (result.errors) {
        for (const err of result.errors) {
          lines.push('  Error: ' + err);
        }
      }
    }

    return lines.join('\n');
  }
}
