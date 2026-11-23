import { ExecutionPlan } from '../domain/execution-plan';
import { MicroTaskGraph, DecompositionContext, GraphValidationResult } from '../domain/micro-task';

/**
 * TaskDecomposer transforms a validated ExecutionPlan into a MicroTaskGraph.
 *
 * Position in pipeline:
 *   Planner → ExecutionPlanner → PlanValidator → TaskDecomposer → StepExecutionEngine
 *
 * Rules:
 *   - Deterministic (no LLM calls in default implementation)
 *   - Every micro task has one responsibility
 *   - Tasks form a DAG (no circular dependencies)
 *   - High-risk operations are detected and flagged
 *   - Context is minimized for weak models
 */
export interface TaskDecomposer {
  decompose(plan: ExecutionPlan, context?: DecompositionContext): MicroTaskGraph;
  validateGraph(graph: MicroTaskGraph): GraphValidationResult;
}
