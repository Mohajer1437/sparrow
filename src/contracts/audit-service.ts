import { ExecutionAuditEvent } from '../domain/execution-audit';

export interface AuditService {
  record(event: Omit<ExecutionAuditEvent, 'auditId' | 'timestamp'>): Promise<void>;
  getHistory(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
  getSessionHistory(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>>;
}
