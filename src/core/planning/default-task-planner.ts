import { TaskPlanner } from '../../contracts/task-planner';
import { ExecutionPlan, PlanStep, PlanningRequest } from '../../domain/execution-plan';
import { Provider } from '../../contracts/provider';
import { WorkspaceMemory } from '../../contracts/workspace-memory';
import { MemoryContextBuilder } from '../../contracts/memory-context-builder';
import { PLANNER_SYSTEM_PROMPT, PLANNER_USER_TEMPLATE } from './planner-prompt';
import {
  DefaultPlannerContextSerializer,
  digestPlannerContextConsumption,
} from './planner-context-serializer';
import { ExecutionLogger } from '../observability/execution-logger';
import { extractFilePaths } from '../vv/infer-source-files';
import { bindAcceptanceContract } from '../vv/acceptance-contract';
import { formatAcceptanceContract } from '../../domain/acceptance-contract';
import { PlannerOutputRejectedError } from '../../domain/errors/todo-plan-errors';
import { formatTodoPlan, TodoItem } from '../../domain/todo-plan';
import { parseTodoPlanFromPlannerOutput } from './todo-plan-parser';
import { todoPlanToExecutionPlan } from './todo-plan-to-execution-plan';
import { isMutatingTool } from '../../domain/execution-mode';

/** R1.19: the tool list the planner is allowed to see for this mode. */
function readOnlyTools(request: PlanningRequest): ReadonlyArray<string> {
  return request.executionMode === 'READ_ONLY'
    ? request.availableTools.filter(tool => !isMutatingTool(tool))
    : request.availableTools;
}

const MIN_TASK_LENGTH_FOR_PLANNING = 30;

export class DefaultTaskPlanner implements TaskPlanner {
  constructor(
    private readonly provider: Provider,
    private readonly workspaceMemory: WorkspaceMemory,
    private readonly memoryContextBuilder: MemoryContextBuilder,
    private readonly defaultProviderId: string = 'ollama',
    private readonly defaultModel: string = 'gpt-oss:120b-cloud',
    private readonly plannerContextSerializer: DefaultPlannerContextSerializer = new DefaultPlannerContextSerializer(),
  ) {}

  async plan(request: PlanningRequest): Promise<ExecutionPlan | null> {
    let rawPlannerOutput = '';
    try {
      if (!this.shouldPlan(request)) {
        return null;
      }

      const memoryContext = await this.buildMemoryContext();
      const serializedContext = this.plannerContextSerializer.serialize(request.plannerContext);
      const userPrompt = this.buildUserPrompt(request, memoryContext, serializedContext);
      const digest = digestPlannerContextConsumption(request.plannerContext, serializedContext);
      const model = request.model ?? this.defaultModel;

      ExecutionLogger.log('PLANNING', 'planner', model,
        `Planning: "${request.task.substring(0, 80)}..."`);
      ExecutionLogger.log(
        'PLANNER_CONTEXT',
        'planner',
        model,
        `consumed=${digest.consumed}; skills=${digest.skills.join(',') || '(none)'}; `
          + `files=${digest.records.filter(record => record.source === 'SOURCE_FILES' && record.contentIncluded).map(record => record.reference).join(',') || '(none)'}; `
          + `ai=${digest.records.filter(record => record.source === 'AI_CONTEXT' && record.contentIncluded).map(record => record.reference).join(',') || '(none)'}; `
          + `limitReached=${digest.limitReached}`,
        { ...digest },
      );

      ExecutionLogger.logPrompt('planner', model, PLANNER_SYSTEM_PROMPT, userPrompt);

      const response = await this.provider.generate({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        model: request.model ?? this.defaultModel,
        temperature: 0.2,
        signal: request.signal,
        observability: {
          stage: 'planner',
          retryAttempt: 0,
        },
      });

      rawPlannerOutput = response.content;
      ExecutionLogger.logResponse('planner', request.model ?? this.defaultModel, rawPlannerOutput, 0);
      // Execution authority comes only from evidence-derived allowed targets.
      // PlannerContext visibility never authorizes a target, and a repair plan
      // is driven by verification evidence rather than pre-planning context.
      // Filesystem grounding still applies before execution in both cases.
      const authority = request.plannerAllowedTargets;
      const allowedTargets = authority?.hasAuthority && !request.failureContract
        ? authority
        : undefined;

      const todoPlan = parseTodoPlanFromPlannerOutput(rawPlannerOutput, {
        allowedSkillIds: request.plannerContext?.resolvedSkills.skills.map(skill => skill.id),
        allowedTargets,
      });
      ExecutionLogger.log(
        'TODO_PLAN',
        'planner',
        model,
        formatTodoPlan(todoPlan),
        {
          goal: todoPlan.goal,
          contextSummary: todoPlan.contextSummary,
          affectedFiles: todoPlan.affectedFiles,
          constraints: todoPlan.constraints,
          failedTodoId: todoPlan.failedTodoId,
          todos: todoPlan.todos.map((todo: TodoItem) => ({
            id: todo.id,
            title: todo.title,
            description: todo.description,
            reason: todo.reason,
            files: todo.files,
            dependencies: todo.dependencies,
            skillIds: todo.skillIds,
            verificationRequirements: todo.verificationRequirements,
            risk: todo.risk,
            action: todo.action,
          })),
        },
      );

      const plan = todoPlanToExecutionPlan(todoPlan, request.availableTools);
      ExecutionLogger.log('PLANNING', 'planner', request.model ?? this.defaultModel,
        `Plan: ${plan.steps.length} todos, complexity: ${plan.complexity}`);
      ExecutionLogger.log(
        'TODO_BRIDGE',
        'planner',
        request.model ?? this.defaultModel,
        plan.steps.map(step =>
          `${step.id}←${step.sourceTodoId ?? step.id}`
          + ` files=${(step.expectedFiles ?? []).join(',') || '(none)'}`
          + ` skills=${(step.skillIds ?? []).join(',') || '(none)'}`
          + ` verify=${(step.validationCriteria ?? []).join(',') || '(none)'}`,
        ).join(' | '),
      );

      return this.validatePlan(plan, request.availableTools, request);
    } catch (error: any) {
      if (error instanceof PlannerOutputRejectedError) {
        ExecutionLogger.log(
          'PLANNER_OUTPUT_REJECTED',
          'planner',
          request.model ?? this.defaultModel,
          error.message,
          {
            issues: error.issues,
            rejectedTargets: error.rejectedTargets,
            reasonCode: error.reasonCode,
            contentPreview: typeof rawPlannerOutput === 'string' ? rawPlannerOutput.substring(0, 2000) : '',
          },
        );
        throw error;
      }
      ExecutionLogger.log(
        'PLANNING_FAILED',
        'planner',
        request.model ?? this.defaultModel,
        `Task planner failed: ${error.message}`,
        { error: error.message },
      );
      console.warn(
        `[TaskPlanner] Planning failed, returning null. Error: ${error.message}`
      );
      return null;
    }
  }

  private shouldPlan(request: PlanningRequest): boolean {
    if (!request.task || request.task.trim().length === 0) {
      return false;
    }
    if (request.failureContract || request.task.includes('[REPAIR]')) {
      return true;
    }
    if (request.task.length < MIN_TASK_LENGTH_FOR_PLANNING) {
      return false;
    }
    return true;
  }

  private async buildMemoryContext(): Promise<string> {
    try {
      const knowledge = await this.workspaceMemory.load();
      if (knowledge.isEmpty) {
        return '(No project memory available — plan based on the task only.)';
      }
      const context = this.memoryContextBuilder.build(knowledge);
      return context && context.length > 0
        ? context
        : '(Project memory loaded but no useful context extracted.)';
    } catch (error: any) {
      console.warn(`[TaskPlanner] Memory loading failed: ${error.message}`);
      return '(Project memory unavailable.)';
    }
  }

  private buildUserPrompt(
    request: PlanningRequest,
    memoryContext: string,
    serializedPlannerContext: string,
  ): string {
    // R1.19: in READ_ONLY the planner is not offered mutation tools at all,
    // so an inspection plan is the only plan it can express.
    const offeredTools = readOnlyTools(request);
    const toolsList = offeredTools.length > 0
      ? offeredTools.map(t => `- ${t}`).join('\n')
      : '(no tools available)';
    const modeDirective = request.executionMode === 'READ_ONLY'
      ? 'EXECUTION MODE: READ_ONLY. The system blocks every file, git and database mutation for this run. '
        + 'Produce inspection-only todos (read, search, analyze). Do not plan writes, patches, deletions or commits.\n\n'
      : '';

    return PLANNER_USER_TEMPLATE
      .replace('__TASK__', modeDirective + request.task)
      .replace('__TOOLS__', toolsList)
      .replace('__MEMORY_CONTEXT__', memoryContext)
      .replace('__PRODUCT_ANALYSIS__', request.productAnalysis || '(none)')
      .replace('__ACCEPTANCE_CONTRACT__', request.acceptanceContract
        ? formatAcceptanceContract(request.acceptanceContract)
        : '(none)')
      .replace('__VERIFICATION_REQUIREMENTS__', request.verificationRequirements || '(none)')
      .replace('__FAILURE_CONTRACT__', request.failureContract || '(none)')
      .replace('__PLANNER_CONTEXT__', serializedPlannerContext);
  }

  private validatePlan(
    plan: ExecutionPlan,
    availableTools: ReadonlyArray<string>,
    request?: PlanningRequest,
  ): ExecutionPlan {
    const toolSet = new Set<string>(
      request?.executionMode === 'READ_ONLY'
        ? availableTools.filter(tool => !isMutatingTool(tool))
        : availableTools,
    );
    const extraFiles = request?.failureContract
      ? this.extractFilePathsFromDescription(request.failureContract)
      : [];

    const enrichedSteps = this.enrichStepsWithExpectedFiles(plan.steps, extraFiles, !!request?.failureContract);

    const validatedSteps = enrichedSteps.map(step => {
      const validTools = step.requiredTools.filter((t: string) => toolSet.has(t));
      if (validTools.length !== step.requiredTools.length) {
        const dropped = step.requiredTools.filter((t: string) => !toolSet.has(t));
        console.warn(
          `[TaskPlanner] Step ${step.id}: removed unavailable tools: ${dropped.join(', ')}`
        );
      }
      return { ...step, requiredTools: validTools };
    });

    const bound: ExecutionPlan = request?.acceptanceContract
      ? bindAcceptanceContract(Object.freeze({ ...plan, steps: validatedSteps }), request.acceptanceContract)
      : Object.freeze({ ...plan, steps: validatedSteps });
    return bound;
  }

  /**
   * F.4: Enrich steps with expectedFiles extracted from description/objective.
   * 
   * This ensures E.3 scope guardrails activate even when LLM doesn't set
   * expectedFiles explicitly. If a step already has expectedFiles (from LLM
   * or elsewhere), it is preserved (not overwritten).
   */
  private enrichStepsWithExpectedFiles(
    steps: ReadonlyArray<PlanStep>,
    extraFiles: ReadonlyArray<string> = [],
    restrictToExtra = false,
  ): PlanStep[] {
    return steps.map(step => {
      const combined = [
        step.description || '',
        step.objective || '',
        step.expectedOutcome || '',
      ].join(' ');
      const extracted = this.extractFilePathsFromDescription(combined);
      const existing = step.expectedFiles ?? [];
      const merged = restrictToExtra
        ? this.uniquePaths([...extraFiles, ...existing])
        : this.uniquePaths([...existing, ...extracted, ...extraFiles]);
      if (merged.length === 0) {
        return step;
      }
      return {
        ...step,
        expectedFiles: Object.freeze(merged),
      };
    });
  }

  private uniquePaths(paths: ReadonlyArray<string>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const file of paths) {
      const normalized = file.replace(/\\/g, '/').replace(/^\.?\//, '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  /**
   * F.4: Extract file paths from text using regex patterns.
   * Matches: relative paths with extensions like .ts, .tsx, .js, .jsx, .json, .md, .css, .scss
   * Examples: "app/quiz/page.tsx", "src/lib/utils.ts", "components/Modal.tsx"
   * 
   * Copied from StepExecutionEngine and DefaultExecutionPlanner for consistency.
   */
  private extractFilePathsFromDescription(text: string): string[] {
    return extractFilePaths(text);
  }
}
