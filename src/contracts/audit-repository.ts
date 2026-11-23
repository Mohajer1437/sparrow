import { ExecutionAuditEvent } from '../domain/execution-audit';

export interface ExecutionAuditRepository {
  append(event: ExecutionAuditEvent): Promise<void>;
  listByExecution(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  listBySession(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  getLatest(executionId: string): Promise<ExecutionAuditEvent | null>;
}
