import { AcceptanceContract } from './acceptance-contract';
import { TodoPlan } from './todo-plan';

/**
 * R2.3: ExecutionPlan Domain Types
 */
export type PlanStepType = 'analysis' | 'search' | 'modify' | 'test' | 'validation';
export type PlanStatus = 'CREATED' | 'VALIDATED' | 'READY' | 'INVALID';

export interface PlanningMetadata {
  readonly generatedAt: string;
  readonly stepCount: number;
  readonly complexity: 'simple' | 'medium' | 'complex';
  readonly estimatedRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly affectedAreas: ReadonlyArray<string>;
}
export type PlanComplexity = 'simple' | 'medium' | 'complex';

export interface PlanStep {
  readonly id: string;
  readonly description: string;
  readonly type: PlanStepType;
  readonly requiredTools: ReadonlyArray<string>;
  readonly expectedOutcome: string;
  readonly objective?: string;
  readonly dependencies?: ReadonlyArray<string>;
  readonly expectedFiles?: ReadonlyArray<string>;
  readonly validationCriteria?: ReadonlyArray<string>;
  /** Skill IDs copied from the source Todo when a TodoPlan was bridged. */
  readonly skillIds?: ReadonlyArray<string>;
  /** Original Todo id. Survives the compatibility bridge for V&V/failure mapping. */
  readonly sourceTodoId?: string;
}

export interface ValidationStrategy {
  readonly requiredTests: ReadonlyArray<string>;
  readonly successCriteria: ReadonlyArray<string>;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly objective: string;
  readonly complexity: PlanComplexity;
  readonly reasoning: string;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly affectedDomains: ReadonlyArray<string>;
  readonly validationStrategy: ValidationStrategy;
  readonly createdAt: string;
  readonly status?: PlanStatus;
  readonly metadata?: PlanningMetadata;
  readonly acceptanceContract?: AcceptanceContract;
  /** Milestone B4: structured planning artifact. Execution still uses steps. */
  readonly todoPlan?: TodoPlan;
}

export interface PlanningRequest {
  readonly task: string;
  readonly availableTools: ReadonlyArray<string>;
  readonly memoryContext?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly productAnalysis?: string;
  readonly verificationRequirements?: string;
  readonly failureContract?: string;
  readonly acceptanceContract?: import('./acceptance-contract').AcceptanceContract;
  /** Milestone B3: assembled planner context consumed by the planner prompt. */
  readonly plannerContext?: import('./planner-context').PlannerContext;
  /** Authoritative grounding scope from EvidenceBuilder and workspace discovery. */
  readonly plannerAllowedTargets?: import('./planner-allowed-targets').PlannerAllowedTargets;
  /**
   * R1.19: system constraint, not a suggestion. In READ_ONLY the planner may
   * only produce inspection Todos; the executor blocks mutation regardless of
   * what the planner emits.
   */
  readonly executionMode?: import('./execution-mode').ExecutionMode;
}

export function formatExecutionPlan(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push(`EXECUTION PLAN (${plan.complexity.toUpperCase()})`);
  lines.push(`Objective: ${plan.objective}`);
  lines.push('');
  lines.push('Reasoning:');
  lines.push(plan.reasoning);
  lines.push('');
  lines.push('Steps:');
  for (const step of plan.steps) {
    lines.push(`  ${step.id}. [${step.type.toUpperCase()}] ${step.description}`);
    if (step.requiredTools.length > 0) {
      lines.push(`     Tools: ${step.requiredTools.join(', ')}`);
    }
    lines.push(`     Expected: ${step.expectedOutcome}`);
  }
  if (plan.affectedDomains.length > 0) {
    lines.push('');
    lines.push(`Affected domains: ${plan.affectedDomains.join(', ')}`);
  }
  if (plan.validationStrategy.successCriteria.length > 0) {
    lines.push('');
    lines.push('Success criteria:');
    for (const c of plan.validationStrategy.successCriteria) {
      lines.push(`  - ${c}`);
    }
  }
  return lines.join('\n');
}
