import { TelemetryCollector } from '../../contracts/telemetry-collector';
import {
  TimelineEvent,
  StepTelemetry,
  ExecutionTelemetry,
  ExecutionMetrics,
} from '../../domain/execution-telemetry';

export class DefaultTelemetryCollector implements TelemetryCollector {
  private events: TimelineEvent[] = [];
  private steps: StepTelemetry[] = [];
  private executionId: string;
  private sessionId: string;
  private planId?: string;
  private startedAt: string;

  constructor(executionId: string, sessionId: string, planId?: string) {
    this.executionId = executionId;
    this.sessionId = sessionId;
    this.planId = planId;
    this.startedAt = new Date().toISOString();
  }

  recordEvent(event: TimelineEvent): void {
    this.events.push(Object.freeze(event));
  }

  recordStep(step: StepTelemetry): void {
    this.steps.push(Object.freeze(step));
  }

  getTelemetry(): ExecutionTelemetry {
    const completedAt = new Date().toISOString();
    const totalDurationMs = new Date(completedAt).getTime() - new Date(this.startedAt).getTime();

    const successfulSteps = this.steps.filter(s => s.success).length;
    const failedSteps = this.steps.filter(s => !s.success).length;
    const stepDurations = this.steps.filter(s => s.durationMs !== undefined).map(s => s.durationMs!);
    const averageStepDurationMs = stepDurations.length > 0
      ? Math.round(stepDurations.reduce((a, b) => a + b, 0) / stepDurations.length)
      : 0;
    const governorPauseCount = this.events.filter(e => e.type === 'GOVERNOR_PAUSED').length;
    const retryCount = this.steps.reduce((sum, s) => sum + s.retries, 0);
    const validationFailures = this.events.filter(e => e.type === 'STEP_FAILED').length;

    const metrics: ExecutionMetrics = Object.freeze({
      totalDurationMs,
      stepCount: this.steps.length,
      successfulSteps,
      failedSteps,
      averageStepDurationMs,
      governorPauseCount,
      retryCount,
      validationFailures,
    });

    return Object.freeze({
      executionId: this.executionId,
      sessionId: this.sessionId,
      planId: this.planId,
      startedAt: this.startedAt,
      completedAt,
      timeline: Object.freeze([...this.events]),
      steps: Object.freeze([...this.steps]),
      metrics,
    });
  }

  reset(): void {
    this.events = [];
    this.steps = [];
    this.startedAt = new Date().toISOString();
  }
}
