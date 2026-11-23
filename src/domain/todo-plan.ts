import { PlanStepType } from './execution-plan';
import { PlannerOutputRejectedError, TodoPlanValidationError } from './errors/todo-plan-errors';
import { SKILL_ID_PATTERN } from './skill';
import { ImpactAnalysis } from './impact-analysis';
import { PlannerAllowedTargets } from './planner-allowed-targets';
import { partitionDeclaredFiles } from './planner-file-reference';

export const TODO_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TodoRiskLevel = (typeof TODO_RISK_LEVELS)[number];

export const TODO_VERIFICATION_REQUIREMENTS = [
  'typecheck',
  'lint',
  'browser',
  'unit-test',
  'api',
  'auth',
  'authorization',
  'error-handling',
  'database-read-check',
  'deterministic',
  'ui-acceptance',
  'intent-contract',
] as const;
export type TodoVerificationRequirement = (typeof TODO_VERIFICATION_REQUIREMENTS)[number];

export const TODO_ACTIONS = ['inspect', 'modify', 'test', 'verify'] as const;
export type TodoAction = (typeof TODO_ACTIONS)[number];

export const TODO_ID_PATTERN = /^todo-[1-9][0-9]*$/;
export const MAX_TODOS_PER_PLAN = 16;

const FALLBACK_SKILL_IDS = Object.freeze([
  'frontend.core',
  'backend.core',
  'backend.api',
  'backend.nestjs',
  'backend.testing',
  'backend.database-verification',
  'testing.core',
]);

export interface TodoItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly reason: string;
  readonly files: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly skillIds: ReadonlyArray<string>;
  readonly verificationRequirements: ReadonlyArray<TodoVerificationRequirement>;
  readonly risk: TodoRiskLevel;
  readonly action?: TodoAction;
  readonly impactAnalysis?: ImpactAnalysis;
  readonly regressionRequirements?: ReadonlyArray<string>;
  /** Compatibility only: tools requested by a legacy execution-plan step. */
  readonly requestedTools?: ReadonlyArray<string>;
  /** Reasoning-only files from PlannerContext. Never executed or mutated. */
  readonly contextReferences?: ReadonlyArray<string>;
  /** Project descriptors and documentation. Never executed or mutated. */
  readonly metadataReferences?: ReadonlyArray<string>;
}

export interface TodoPlan {
  readonly goal: string;
  readonly contextSummary: string;
  readonly affectedFiles: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
  readonly todos: ReadonlyArray<TodoItem>;
  /** Original failed Todo this repair plan targets. May refer to a prior plan's todo id. */
  readonly failedTodoId?: string;
  readonly impactAnalysis?: ImpactAnalysis;
  /** Reasoning-only files from PlannerContext. Never executed or mutated. */
  readonly contextReferences?: ReadonlyArray<string>;
  /** Project descriptors and documentation. Never executed or mutated. */
  readonly metadataReferences?: ReadonlyArray<string>;
}

export interface TodoPlanValidationOptions {
  readonly allowedSkillIds?: ReadonlyArray<string>;
  readonly allowedTargets?: PlannerAllowedTargets | ReadonlyArray<string>;
}

function isTargetAllowedByOptions(
  file: string,
  allowedTargets: PlannerAllowedTargets | ReadonlyArray<string>,
): boolean {
  if (!file || file === '.' || file === './') return true;
  if (file.includes('*')) return false;
  if (typeof (allowedTargets as any).isAllowed === 'function') {
    return (allowedTargets as PlannerAllowedTargets).isAllowed(file);
  }
  if (Array.isArray(allowedTargets)) {
    const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
    return (allowedTargets as ReadonlyArray<string>).includes(norm);
  }
  return true;
}

const CONTEXT_REFERENCE_FIELDS = ['contextReferences', 'contextFiles', 'references'] as const;
const METADATA_REFERENCE_FIELDS = ['metadataReferences', 'documentationFiles'] as const;

/**
 * Collects non-execution file references. These are never validated against
 * PlannerAllowedTargets, so a planner may cite anything PlannerContext showed
 * it without claiming permission to act on it.
 */
function collectNonExecutionReferences(
  raw: Record<string, unknown>,
  fields: ReadonlyArray<string>,
): string[] {
  const collected: string[] = [];
  for (const field of fields) {
    const value = raw[field];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const normalized = entry.trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (normalized.length === 0) continue;
      if (normalized.split('/').includes('..')) continue;
      if (!collected.includes(normalized)) collected.push(normalized);
    }
  }
  return uniqueSorted(collected);
}

function optionalList(values: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
  return values.length > 0 ? Object.freeze([...values]) : undefined;
}

export function isTodoRiskLevel(value: unknown): value is TodoRiskLevel {
  return typeof value === 'string' && (TODO_RISK_LEVELS as ReadonlyArray<string>).includes(value);
}

export function isTodoVerificationRequirement(value: unknown): value is TodoVerificationRequirement {
  return typeof value === 'string' && (TODO_VERIFICATION_REQUIREMENTS as ReadonlyArray<string>).includes(value);
}

export function isTodoAction(value: unknown): value is TodoAction {
  return typeof value === 'string' && (TODO_ACTIONS as ReadonlyArray<string>).includes(value);
}

export function freezeTodoItem(item: TodoItem): TodoItem {
  return Object.freeze({
    id: item.id,
    title: item.title,
    description: item.description,
    reason: item.reason,
    files: Object.freeze([...item.files]),
    dependencies: Object.freeze([...item.dependencies]),
    skillIds: Object.freeze([...item.skillIds]),
    verificationRequirements: Object.freeze([...item.verificationRequirements]),
    risk: item.risk,
    action: item.action,
    impactAnalysis: item.impactAnalysis,
    regressionRequirements: item.regressionRequirements ? Object.freeze([...item.regressionRequirements]) : undefined,
    requestedTools: item.requestedTools ? Object.freeze([...item.requestedTools]) : undefined,
    contextReferences: item.contextReferences ? Object.freeze([...item.contextReferences]) : undefined,
    metadataReferences: item.metadataReferences ? Object.freeze([...item.metadataReferences]) : undefined,
  });
}

export function freezeTodoPlan(plan: TodoPlan): TodoPlan {
  return Object.freeze({
    goal: plan.goal,
    contextSummary: plan.contextSummary,
    affectedFiles: Object.freeze([...plan.affectedFiles]),
    constraints: Object.freeze([...plan.constraints]),
    todos: Object.freeze(plan.todos.map(todo => freezeTodoItem(todo))),
    failedTodoId: plan.failedTodoId,
    impactAnalysis: plan.impactAnalysis,
    contextReferences: plan.contextReferences ? Object.freeze([...plan.contextReferences]) : undefined,
    metadataReferences: plan.metadataReferences ? Object.freeze([...plan.metadataReferences]) : undefined,
  });
}

export function validateTodoItem(
  input: unknown,
  options?: TodoPlanValidationOptions,
): TodoItem {
  const issues: string[] = [];
  if (input === null || typeof input !== 'object') {
    throw new TodoPlanValidationError('Todo item must be an object', ['todo must be an object']);
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || !TODO_ID_PATTERN.test(raw.id.trim())) {
    issues.push('id must match todo-N with N >= 1');
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    issues.push('title is required');
  }
  if (typeof raw.description !== 'string' || raw.description.trim().length === 0) {
    issues.push('description is required');
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
    issues.push('reason is required');
  }
  if (!isTodoRiskLevel(raw.risk)) {
    issues.push('risk must be LOW, MEDIUM, or HIGH');
  }
  if (!Array.isArray(raw.files)) {
    issues.push('files must be an array');
  }
  if (!Array.isArray(raw.dependencies)) {
    issues.push('dependencies must be an array');
  }
  if (!Array.isArray(raw.skillIds)) {
    issues.push('skillIds must be an array');
  }
  if (!Array.isArray(raw.verificationRequirements)) {
    issues.push('verificationRequirements must be an array');
  }
  if (raw.action !== undefined && !isTodoAction(raw.action)) {
    issues.push('action must be inspect, modify, test, or verify when present');
  }

  const declaredFiles = Array.isArray(raw.files) ? normalizePathList(raw.files, 'files', issues) : [];
  const partitioned = partitionDeclaredFiles(declaredFiles);
  const files = uniqueSorted(partitioned.executionTargets);
  const contextReferences = collectNonExecutionReferences(raw, CONTEXT_REFERENCE_FIELDS);
  const metadataReferences = uniqueSorted([
    ...collectNonExecutionReferences(raw, METADATA_REFERENCE_FIELDS),
    ...partitioned.metadataReferences,
  ]);
  const dependencies = Array.isArray(raw.dependencies)
    ? normalizeIdList(raw.dependencies, 'dependencies', issues)
    : [];
  const skillIds = Array.isArray(raw.skillIds)
    ? normalizeSkillIds(raw.skillIds, options?.allowedSkillIds, issues)
    : [];
  const verificationRequirements = Array.isArray(raw.verificationRequirements)
    ? normalizeVerification(raw.verificationRequirements, issues)
    : [];

  if (typeof raw.id === 'string' && dependencies.includes(raw.id.trim())) {
    issues.push(`${raw.id.trim()} cannot depend on itself`);
  }

  if (options?.allowedTargets) {
    for (const f of files) {
      if (!isTargetAllowedByOptions(f, options.allowedTargets)) {
        issues.push(`Ungrounded target "${f}": not present in confirmed evidence files or workspace`);
      }
    }
  }

  if (issues.length > 0) {
    throw new TodoPlanValidationError(`Invalid todo item: ${issues.join('; ')}`, Object.freeze(issues));
  }

  return freezeTodoItem({
    id: (raw.id as string).trim(),
    title: (raw.title as string).trim(),
    description: (raw.description as string).trim(),
    reason: (raw.reason as string).trim(),
    files,
    dependencies,
    skillIds,
    verificationRequirements,
    risk: raw.risk as TodoRiskLevel,
    action: isTodoAction(raw.action) ? raw.action : undefined,
    requestedTools: Array.isArray(raw.requestedTools)
      ? Object.freeze(raw.requestedTools.filter((item): item is string => typeof item === 'string'))
      : undefined,
    contextReferences: optionalList(contextReferences),
    metadataReferences: optionalList(metadataReferences),
  });
}

export function validateTodoPlan(
  input: unknown,
  options?: TodoPlanValidationOptions,
): TodoPlan {
  if (input === null || typeof input !== 'object') {
    throw new TodoPlanValidationError('TodoPlan must be an object', ['plan must be an object']);
  }
  const raw = input as Record<string, unknown>;
  const issues: string[] = [];

  if (typeof raw.goal !== 'string' || raw.goal.trim().length === 0) {
    issues.push('goal is required');
  }
  if (typeof raw.contextSummary !== 'string' && typeof (raw as { context_summary?: unknown }).context_summary !== 'string') {
    issues.push('contextSummary is required');
  }
  const contextSummaryRaw = typeof raw.contextSummary === 'string'
    ? raw.contextSummary
    : (raw as { context_summary?: unknown }).context_summary;
  if (typeof contextSummaryRaw === 'string' && contextSummaryRaw.trim().length === 0) {
    issues.push('contextSummary is required');
  }

  const affectedRaw = raw.affectedFiles ?? (raw as { affected_files?: unknown }).affected_files;
  const constraintsRaw = raw.constraints;
  const todosRaw = raw.todos;

  if (!Array.isArray(affectedRaw)) issues.push('affectedFiles must be an array');
  if (!Array.isArray(constraintsRaw)) issues.push('constraints must be an array');
  if (!Array.isArray(todosRaw)) issues.push('todos must be an array');

  if (issues.length > 0) {
    throw new TodoPlanValidationError(`Invalid TodoPlan: ${issues.join('; ')}`, Object.freeze(issues));
  }

  if (!Array.isArray(todosRaw) || todosRaw.length === 0) {
    throw new TodoPlanValidationError('TodoPlan must contain at least one todo', ['todos must not be empty']);
  }
  if (todosRaw.length > MAX_TODOS_PER_PLAN) {
    throw new TodoPlanValidationError(
      `TodoPlan exceeds max ${MAX_TODOS_PER_PLAN} todos`,
      ['too many todos'],
    );
  }

  const itemIssues: string[] = [];
  const todos: TodoItem[] = [];

  for (let index = 0; index < todosRaw.length; index++) {
    const item = todosRaw[index];
    try {
      todos.push(validateTodoItem(item, options));
    } catch (error) {
      if (error instanceof TodoPlanValidationError) {
        itemIssues.push(`Invalid todo at index ${index}: ${error.message}`);
        itemIssues.push(...error.issues);
      } else {
        throw error;
      }
    }
  }

  const allIssues: string[] = [...issues, ...itemIssues];
  const declaredAffected = normalizePathList(affectedRaw as unknown[], 'affectedFiles', allIssues);
  const partitionedAffected = partitionDeclaredFiles(declaredAffected);
  const affectedFiles = uniqueSorted(partitionedAffected.executionTargets);
  const contextReferences = uniqueSorted([
    ...collectNonExecutionReferences(raw, CONTEXT_REFERENCE_FIELDS),
    ...todos.flatMap(todo => [...(todo.contextReferences ?? [])]),
  ]);
  const metadataReferences = uniqueSorted([
    ...collectNonExecutionReferences(raw, METADATA_REFERENCE_FIELDS),
    ...partitionedAffected.metadataReferences,
    ...todos.flatMap(todo => [...(todo.metadataReferences ?? [])]),
  ]);
  const constraints = uniqueSorted(
    (constraintsRaw as unknown[])
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item.length > 0),
  );

  if (options?.allowedTargets) {
    for (const f of affectedFiles) {
      if (!isTargetAllowedByOptions(f, options.allowedTargets)) {
        allIssues.push(`Ungrounded target "${f}": not present in confirmed evidence files or workspace`);
      }
    }
  }

  if (allIssues.length > 0) {
    throw new TodoPlanValidationError(`Invalid TodoPlan: ${allIssues.join('; ')}`, Object.freeze(allIssues));
  }

  const ids = todos.map(todo => todo.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new TodoPlanValidationError('Todo IDs must be unique', ['duplicate todo ids']);
  }

  const expectedIds = Array.from({ length: todos.length }, (_, i) => `todo-${i + 1}`);
  const missingExpected = expectedIds.filter(id => !unique.has(id));
  if (missingExpected.length > 0) {
    throw new TodoPlanValidationError(
      `Todo IDs must be todo-1..todo-${todos.length}`,
      [`missing ids: ${missingExpected.join(', ')}`],
    );
  }

  for (const todo of todos) {
    for (const dep of todo.dependencies) {
      if (!unique.has(dep)) {
        throw new TodoPlanValidationError(
          `Todo ${todo.id} depends on unknown id ${dep}`,
          ['unknown dependency'],
        );
      }
    }
  }

  if (hasCycle(todos)) {
    throw new TodoPlanValidationError('TodoPlan contains a dependency cycle', ['cyclic dependency']);
  }

  const ordered = topologicalSort(todos);

  for (const todo of ordered) {
    for (const file of todo.files) {
      if (!affectedFiles.includes(file)) {
        throw new TodoPlanValidationError(
          `Todo ${todo.id} file ${file} is not listed in affectedFiles`,
          ['affected-file consistency'],
        );
      }
    }
  }

  const failedTodoId = typeof raw.failedTodoId === 'string' && raw.failedTodoId.trim().length > 0
    ? raw.failedTodoId.trim()
    : undefined;
  if (failedTodoId && !TODO_ID_PATTERN.test(failedTodoId)) {
    throw new TodoPlanValidationError(
      `failedTodoId ${failedTodoId} is not a valid todo id`,
      ['invalid failedTodoId'],
    );
  }

  return freezeTodoPlan({
    goal: (raw.goal as string).trim(),
    contextSummary: (contextSummaryRaw as string).trim(),
    affectedFiles,
    constraints,
    todos: ordered,
    failedTodoId,
    contextReferences: optionalList(contextReferences),
    metadataReferences: optionalList(metadataReferences),
  });
}

export function todoActionToStepType(action: TodoAction | undefined, todo: TodoItem): PlanStepType {
  if (action === 'inspect') return 'analysis';
  if (action === 'modify') return 'modify';
  if (action === 'test') return 'test';
  if (action === 'verify') return 'validation';
  const text = `${todo.title} ${todo.description}`.toLowerCase();
  if (/\b(test|coverage|regression)\b/.test(text)) return 'test';
  if (/\b(verify|validation|typecheck|lint)\b/.test(text)) return 'validation';
  if (/\b(inspect|read|analyze|explain|identify)\b/.test(text)) return 'analysis';
  if (todo.files.length > 0 && /\b(modify|change|update|edit|fix|implement|add)\b/.test(text)) {
    return 'modify';
  }
  if (todo.verificationRequirements.includes('unit-test')) return 'test';
  return 'analysis';
}

export function formatTodoPlan(plan: TodoPlan): string {
  const lines = [
    `TODO PLAN`,
    `Goal: ${plan.goal}`,
    `Context: ${plan.contextSummary}`,
    `Affected files: ${plan.affectedFiles.join(', ') || '(none)'}`,
    `Constraints: ${plan.constraints.join('; ') || '(none)'}`,
    `Todos: ${plan.todos.length}`,
  ];
  if (plan.failedTodoId) {
    lines.push(`Failed todo: ${plan.failedTodoId}`);
  }
  for (const todo of plan.todos) {
    lines.push(
      `  ${todo.id} [${todo.risk}] ${todo.title} files=${todo.files.join(',') || '(none)'} `
      + `skills=${todo.skillIds.join(',') || '(none)'} verify=${todo.verificationRequirements.join(',') || '(none)'} `
      + `deps=${todo.dependencies.join(',') || '(none)'}`,
    );
  }
  return lines.join('\n');
}

export function rejectPlannerOutput(message: string, issues: ReadonlyArray<string> = []): never {
  throw new PlannerOutputRejectedError(message, Object.freeze([...issues]));
}

function normalizePathList(values: unknown[], field: string, issues: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      issues.push(`${field} entries must be strings`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized === '.') {
      normalized = '.';
    }
    if (normalized.split('/').includes('..') || normalized.startsWith('../')) {
      issues.push(`${field} must not contain path traversal`);
      continue;
    }
    if (/^[A-Za-z]:/.test(normalized) || (normalized.startsWith('/') && normalized !== '/')) {
      issues.push(`${field} must be workspace-relative`);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return uniqueSorted(out);
}

function normalizeIdList(values: unknown[], field: string, issues: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !TODO_ID_PATTERN.test(value.trim())) {
      issues.push(`${field} must contain todo-N ids`);
      continue;
    }
    const id = value.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeSkillIds(
  values: unknown[],
  allowedSkillIds: ReadonlyArray<string> | undefined,
  issues: string[],
): string[] {
  const allowed = new Set(
    (allowedSkillIds && allowedSkillIds.length > 0 ? allowedSkillIds : FALLBACK_SKILL_IDS).map(id => id.trim()),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !SKILL_ID_PATTERN.test(value.trim())) {
      issues.push(`skillIds must be namespaced skill identifiers`);
      continue;
    }
    const id = value.trim();
    if (!allowed.has(id)) {
      issues.push(`unknown skill id: ${id}`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return uniqueSorted(out);
}

const VERIFICATION_ALIASES: Record<string, TodoVerificationRequirement> = {
  'intent-contract': 'intent-contract',
  'acceptance-contract': 'intent-contract',
  'acceptance': 'ui-acceptance',
  'ui': 'ui-acceptance',
  'playwright': 'browser',
  'e2e': 'browser',
  'dom': 'browser',
  'unit': 'unit-test',
  'unit-tests': 'unit-test',
  'tests': 'unit-test',
  'jest': 'unit-test',
  'tsc': 'typecheck',
  'type-check': 'typecheck',
  'eslint': 'lint',
  'endpoint': 'api',
  'rest': 'api',
  'http': 'api',
  'authentication': 'auth',
  'authn': 'auth',
  'authz': 'authorization',
  'error-handling': 'error-handling',
  'errors': 'error-handling',
  'db': 'database-read-check',
  'database': 'database-read-check',
};

function coerceVerificationRequirement(value: unknown): TodoVerificationRequirement | undefined {
  if (isTodoVerificationRequirement(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (isTodoVerificationRequirement(normalized)) return normalized;
  return VERIFICATION_ALIASES[normalized];
}

function normalizeVerification(values: unknown[], issues: string[]): TodoVerificationRequirement[] {
  const out: TodoVerificationRequirement[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const coerced = coerceVerificationRequirement(value);
    if (!coerced) {
      issues.push(`invalid verification requirement: ${String(value)}`);
      continue;
    }
    if (seen.has(coerced)) continue;
    seen.add(coerced);
    out.push(coerced);
  }
  return uniqueSorted(out) as TodoVerificationRequirement[];
}

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function hasCycle(todos: ReadonlyArray<TodoItem>): boolean {
  const ids = new Set(todos.map(todo => todo.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const deps = new Map(todos.map(todo => [todo.id, todo.dependencies]));

  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of deps.get(id) ?? []) {
      if (!ids.has(dep)) continue;
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const todo of todos) {
    if (dfs(todo.id)) return true;
  }
  return false;
}

function topologicalSort(todos: ReadonlyArray<TodoItem>): TodoItem[] {
  const byId = new Map(todos.map(todo => [todo.id, todo]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const todo of todos) {
    inDegree.set(todo.id, 0);
    dependents.set(todo.id, []);
  }
  for (const todo of todos) {
    inDegree.set(todo.id, todo.dependencies.length);
    for (const dep of todo.dependencies) {
      dependents.get(dep)?.push(todo.id);
    }
  }

  const queue = [...todos.map(todo => todo.id).filter(id => inDegree.get(id) === 0)]
    .sort(compareTodoId);
  const ordered: TodoItem[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(byId.get(current)!);
    for (const next of (dependents.get(current) ?? []).slice().sort(compareTodoId)) {
      const nextDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
      queue.sort(compareTodoId);
    }
  }
  return ordered;
}

function compareTodoId(a: string, b: string): number {
  return Number(a.slice('todo-'.length)) - Number(b.slice('todo-'.length));
}
