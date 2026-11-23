import { ExecutionAuditRepository } from '../../contracts/audit-repository';
import { ExecutionAuditEvent } from '../../domain/execution-audit';
import { RuntimeRepository } from '../../contracts/runtime-repository';

const AUDIT_DIR = 'audit';

export class FileAuditRepository implements ExecutionAuditRepository {
  constructor(private readonly runtime: RuntimeRepository) {}

  private auditPath(executionId: string): string {
    const safeId = executionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${AUDIT_DIR}/${safeId}.json`;
  }

  async append(event: ExecutionAuditEvent): Promise<void> {
    await this.runtime.mkdir(AUDIT_DIR);
    const existing = await this.loadEvents(event.executionId);
    const updated = [...existing, event];
    await this.runtime.writeFile(
      this.auditPath(event.executionId),
      JSON.stringify(updated, null, 2)
    );
  }

  async listByExecution(executionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>> {
    return Object.freeze(await this.loadEvents(executionId));
  }

  async listBySession(sessionId: string): Promise<ReadonlyArray<ExecutionAuditEvent>> {
    try {
      const dirExists = await this.runtime.exists(AUDIT_DIR);
      if (!dirExists) return Object.freeze([]);
      const files = await this.runtime.listFiles(AUDIT_DIR);
      const events: ExecutionAuditEvent[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.runtime.readFile(`${AUDIT_DIR}/${file}`);
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const event of parsed) {
              if (event.sessionId === sessionId) {
                events.push(Object.freeze(event));
              }
            }
          }
        } catch {
          // Skip corrupted files
        }
      }
      return Object.freeze(events);
    } catch {
      return Object.freeze([]);
    }
  }

  async getLatest(executionId: string): Promise<ExecutionAuditEvent | null> {
    const events = await this.loadEvents(executionId);
    if (events.length === 0) return null;
    return events[events.length - 1];
  }

  private async loadEvents(executionId: string): Promise<ExecutionAuditEvent[]> {
    try {
      const exists = await this.runtime.exists(this.auditPath(executionId));
      if (!exists) return [];
      const raw = await this.runtime.readFile(this.auditPath(executionId));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((e: any) => Object.freeze(e));
    } catch {
      return [];
    }
  }
}
