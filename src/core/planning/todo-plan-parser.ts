import { extractJsonFromResponse } from '../knowledge/utils/json-validator';
import { PlannerOutputRejectedError, TodoPlanValidationError } from '../../domain/errors/todo-plan-errors';
import { sanitizeRejectedTargets } from '../../domain/planner-allowed-targets';
import {
  TodoAction,
  TodoPlan,
  TodoPlanValidationOptions,
  TodoRiskLevel,
  TodoVerificationRequirement,
  isTodoAction,
  isTodoRiskLevel,
  isTodoVerificationRequirement,
  validateTodoPlan,
} from '../../domain/todo-plan';

/**
 * Parse untrusted LLM planner output into a validated TodoPlan.
 * Legacy ExecutionPlan JSON is adapted, then validated. Malformed output is rejected.
 */
export function parseTodoPlanFromPlannerOutput(
  content: string,
  options?: TodoPlanValidationOptions,
): TodoPlan {
  if (!content || content.trim().length === 0) {
    throw new PlannerOutputRejectedError('Planner output was empty', ['empty output']);
  }

  const parsed = extractJsonFromResponse<Record<string, unknown>>(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PlannerOutputRejectedError('Planner output was not valid JSON', ['malformed json']);
  }

  try {
    if (Array.isArray(parsed.todos)) {
      const rawAffected = Array.isArray(parsed.affectedFiles)
        ? (parsed.affectedFiles as unknown[])
        : (Array.isArray((parsed as any).affected_files) ? ((parsed as any).affected_files as unknown[]) : []);
      const todoFiles = parsed.todos.flatMap((t: any) =>
        t && typeof t === 'object' && Array.isArray(t.files)
          ? t.files.filter((f: any) => typeof f === 'string')
          : []
      );
      // Only declared execution files merge into affectedFiles. Context and
      // metadata references stay out of the execution scope entirely.
      const candidateAffected = Array.from(
        new Set([...rawAffected, ...todoFiles].filter((f): f is string => typeof f === 'string' && f.trim().length > 0)),
      );
      const mergedAffected = sanitizeRejectedTargets(candidateAffected);
      const normalizedPlan = {
        ...parsed,
        affectedFiles: mergedAffected,
      };
      return validateTodoPlan(normalizedPlan, options);
    }
    if (Array.isArray(parsed.steps)) {
      return validateTodoPlan(adaptLegacyExecutionPlan(parsed), options);
    }
  } catch (error) {
    if (error instanceof TodoPlanValidationError) {
      const ungroundedIssues = error.issues.filter(
        i => i.includes('Ungrounded target') || i.includes('PLANNER_UNGROUNDED_TARGET'),
      );
      if (ungroundedIssues.length > 0) {
        const rawUngrounded = ungroundedIssues.map(u => {
          const match = u.match(/Ungrounded target "([^"]+)"/);
          return match ? match[1] : u;
        });
        const ungroundedFiles = sanitizeRejectedTargets(rawUngrounded);
        throw new PlannerOutputRejectedError(
          `PLANNER_UNGROUNDED_TARGET: Planner referenced files not grounded in workspace evidence: ${ungroundedFiles.join(', ')}`,
          error.issues,
          ungroundedFiles,
          'PLANNER_UNGROUNDED_TARGET',
        );
      }
      throw new PlannerOutputRejectedError(
        `Planner output failed TodoPlan validation: ${error.message}`,
        error.issues,
      );
    }
    throw error;
  }

  throw new PlannerOutputRejectedError(
    'Planner output is not a TodoPlan or legacy execution plan',
    ['missing todos'],
  );
}

function adaptLegacyExecutionPlan(raw: Record<string, unknown>): Record<string, unknown> {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const idMap = new Map<string, string>();
  steps.forEach((step, index) => {
    const rawId = step && typeof step === 'object' && typeof (step as { id?: unknown }).id === 'string'
      ? (step as { id: string }).id
      : `step-${index + 1}`;
    idMap.set(rawId, `todo-${index + 1}`);
  });

  const todos = steps.map((step, index) => adaptLegacyStep(step, index, idMap, raw));
  const affectedFiles = unique(todos.flatMap(todo => todo.files as string[]));
  const contextSummary = typeof raw.reasoning === 'string' && raw.reasoning.trim().length > 0
    ? raw.reasoning.trim()
    : 'Adapted from legacy execution plan output.';
  const goal = typeof raw.objective === 'string' && raw.objective.trim().length > 0
    ? raw.objective.trim()
    : 'Complete the requested task';

  return {
    goal,
    contextSummary,
    affectedFiles,
    constraints: [],
    todos,
  };
}

function adaptLegacyStep(
  step: unknown,
  index: number,
  idMap: Map<string, string>,
  plan: Record<string, unknown>,
): Record<string, unknown> {
  const raw = (step && typeof step === 'object') ? step as Record<string, unknown> : {};
  const description = typeof raw.description === 'string' && raw.description.trim().length > 0
    ? raw.description.trim()
    : 'Execute planned step';
  const files = Array.isArray(raw.expectedFiles)
    ? raw.expectedFiles.filter((item): item is string => typeof item === 'string')
    : [];
  const rawDeps = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const dependencies = rawDeps
    .filter((item): item is string => typeof item === 'string')
    .map(dep => idMap.get(dep))
    .filter((item): item is string => typeof item === 'string');
  const requiredTests = Array.isArray((plan.validationStrategy as { requiredTests?: unknown } | undefined)?.requiredTests)
    ? ((plan.validationStrategy as { requiredTests: unknown[] }).requiredTests)
    : [];
  const verification = [
    ...((Array.isArray(raw.validationCriteria) ? raw.validationCriteria : []) as unknown[]),
    ...requiredTests,
  ].map(coerceVerification).filter((item): item is TodoVerificationRequirement => item !== undefined);

  const type = typeof raw.type === 'string' ? raw.type : 'analysis';
  const action: TodoAction | undefined = type === 'modify'
    ? 'modify'
    : type === 'test'
      ? 'test'
      : type === 'validation'
        ? 'verify'
        : 'inspect';

  const complexity = plan.complexity;
  const risk: TodoRiskLevel = complexity === 'complex'
    ? 'HIGH'
    : complexity === 'simple'
      ? 'LOW'
      : isTodoRiskLevel(complexity)
        ? complexity
        : 'MEDIUM';

  return {
    id: `todo-${index + 1}`,
    title: description.slice(0, 120),
    description,
    reason: description,
    files,
    dependencies,
    skillIds: [],
    verificationRequirements: verification,
    risk,
    action: isTodoAction(action) ? action : undefined,
    requestedTools: Array.isArray(raw.requiredTools)
      ? raw.requiredTools.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function coerceVerification(value: unknown): TodoVerificationRequirement | undefined {
  if (isTodoVerificationRequirement(value)) return value;
  if (typeof value !== 'string') return undefined;
  if (/\.test\./i.test(value) || /test/i.test(value)) return 'unit-test';
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
