import { KnowledgeCandidate } from '../domain/knowledge-feedback';
import { WorkflowResult } from './workflow-orchestrator';

export interface KnowledgeFeedbackEngine {
  analyze(result: WorkflowResult): Promise<ReadonlyArray<KnowledgeCandidate>>;
  recordImmediateFailure(sessionId: string, taskId: string, errorLog: string): Promise<void>;
  mergeToKnowledgeBase(sessionId: string): Promise<void>;
}
