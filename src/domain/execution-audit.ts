export type AuditEventType =
  | 'execution_started'
  | 'execution_resumed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'checkpoint_created'
  | 'recovery_triggered'
  | 'execution_completed'
  | 'execution_failed';

export interface ExecutionAuditEvent {
  readonly auditId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly eventType: AuditEventType;
  readonly stepId?: string;
  readonly timestamp: string;
  readonly status: string;
  readonly metadata?: Readonly<Record<string, string>>;
}
