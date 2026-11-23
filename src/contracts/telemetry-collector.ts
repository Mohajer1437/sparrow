import { TimelineEvent, StepTelemetry, ExecutionTelemetry } from '../domain/execution-telemetry';

/**
 * TelemetryCollector passively records execution telemetry.
 *
 * It NEVER influences execution decisions.
 * All recorded data is immutable once written.
 */
export interface TelemetryCollector {
  recordEvent(event: TimelineEvent): void;
  recordStep(step: StepTelemetry): void;
  getTelemetry(): ExecutionTelemetry;
  reset(): void;
}
