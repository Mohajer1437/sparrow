/**
 * Milestone R6 — Pipeline Event Contract.
 *
 * First-class event model for pipeline observability.
 * Every event must belong to exactly one run, with explicit sequence and correlation ids.
 */

export const PIPELINE_EVENT_SCHEMA_VERSION = '1.0';

export interface PipelineEvent {
  readonly eventId: string;
  readonly seq: number;
  readonly ts: string;
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly attemptId?: string;
  readonly phase: string;
  readonly role: string;
  readonly model: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly schemaVersion?: string;
  readonly isLegacy?: boolean;
}
