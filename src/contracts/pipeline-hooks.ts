import { PlanStep, ExecutionPlan } from '../domain/execution-plan';
import { ExecutionContext } from '../domain/execution-context';

export interface PipelineHooks {
  beforePlan?(task: string): Promise<void>;
  afterPlan?(plan: ExecutionPlan | null): Promise<void>;
  beforeStep?(step: PlanStep, context: ExecutionContext): Promise<void>;
  afterStep?(step: PlanStep, context: ExecutionContext): Promise<void>;
}
