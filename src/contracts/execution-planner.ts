import { ExecutionPlan } from '../domain/execution-plan';
import { PlanningContext } from '../domain/planning-context';

/**
 * ExecutionPlanner creates a deterministic ExecutionPlan from a PlanningContext.
 *
 * Unlike TaskPlanner (R3, LLM-based), ExecutionPlanner is:
 *   - Deterministic (no LLM calls)
 *   - Rule-based (sentence decomposition + type inference)
 *   - Synchronous (no async needed)
 *
 * Execution and planning remain separate responsibilities.
 * Execution components must never create plans themselves.
 */
export interface ExecutionPlanner {
  createPlan(context: PlanningContext): ExecutionPlan | null;
}
