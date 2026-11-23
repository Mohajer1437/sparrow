import { ExecutionPlan } from '../domain/execution-plan';
import { PlanValidationResult } from '../domain/plan-validation';

export interface PlanValidator {
  validate(plan: ExecutionPlan, availableTools: ReadonlyArray<string>): Promise<PlanValidationResult>;
  resolveDependencies(steps: ReadonlyArray<any>): ReadonlyArray<any>;
}
