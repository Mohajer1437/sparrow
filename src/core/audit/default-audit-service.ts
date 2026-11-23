import { AuditService } from '../../contracts/audit-service';
import { ExecutionAuditRepository } from '../../contracts/audit-repository';
import { ExecutionAuditEvent } from '../../domain/execution-audit';

export class DefaultAuditService implements AuditService {
  constructor(private readonly repository: ExecutionAuditRepository) {}

  async record(event: Omit<ExecutionAuditEvent, 'auditId' | 'timestamp'>): Promise<void> {
    try {
      const fullEvent: ExecutionAuditEvent = Object.freeze({
        ...event,
        auditId: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: new Date().toISOString(),
      });
      await this.repository.append(fullEvent);
    } catch (e: any) {
      console.warn(`[AuditService] Audit record failed (non-fatal): ${e.message}`);
    }
  }

  async getHistory(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>> {
    return this.repository.listByExecution(executionId);
  }

  async getSessionHistory(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>> {
    return this.repository.listBySession(sessionId);
  }
}
