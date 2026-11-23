import { ExecutionPlan, PlanningRequest } from '../domain/execution-plan';

export interface TaskPlanner {
  plan(request: PlanningRequest): Promise<ExecutionPlan | null>;
}
