import { WorkflowResult } from './workflow-orchestrator';

export interface PostExecutionPipeline {
  execute(result: WorkflowResult): Promise<void>;
}
