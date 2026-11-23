import { AgentExecutionRequest, AgentExecutionResult } from '../domain/agent-execution';

export interface AgentOrchestrator {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}
