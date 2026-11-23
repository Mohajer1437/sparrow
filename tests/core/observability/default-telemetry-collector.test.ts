import { DefaultTelemetryCollector } from '../../../src/core/observability/default-telemetry-collector';
import { TimelineEvent, StepTelemetry } from '../../../src/domain/execution-telemetry';

describe('DefaultTelemetryCollector', () => {
  let collector: DefaultTelemetryCollector;

  beforeEach(() => {
    collector = new DefaultTelemetryCollector('exec-1', 'sess-1', 'plan-1');
  });

  it('records events and produces telemetry', () => {
    const event: TimelineEvent = { type: 'SESSION_STARTED', timestamp: new Date().toISOString() };
    collector.recordEvent(event);

    const telemetry = collector.getTelemetry();
    expect(telemetry.executionId).toBe('exec-1');
    expect(telemetry.sessionId).toBe('sess-1');
    expect(telemetry.planId).toBe('plan-1');
    expect(telemetry.timeline).toHaveLength(1);
    expect(telemetry.timeline[0].type).toBe('SESSION_STARTED');
  });

  it('records steps and calculates metrics', () => {
    const step1: StepTelemetry = {
      stepId: 'step-1', description: 'Step 1', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), durationMs: 100, success: true, retries: 0,
    };
    const step2: StepTelemetry = {
      stepId: 'step-2', description: 'Step 2', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), durationMs: 200, success: false, error: 'Failed', retries: 1,
    };
    collector.recordStep(step1);
    collector.recordStep(step2);

    const telemetry = collector.getTelemetry();
    expect(telemetry.metrics.stepCount).toBe(2);
    expect(telemetry.metrics.successfulSteps).toBe(1);
    expect(telemetry.metrics.failedSteps).toBe(1);
    expect(telemetry.metrics.averageStepDurationMs).toBe(150);
    expect(telemetry.metrics.retryCount).toBe(1);
  });

  it('counts governor pauses', () => {
    collector.recordEvent({ type: 'GOVERNOR_PAUSED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'GOVERNOR_RESUMED', timestamp: new Date().toISOString() });
    collector.recordEvent({ type: 'GOVERNOR_PAUSED', timestamp: new Date().toISOString() });

    const telemetry = collector.getTelemetry();
    expect(telemetry.metrics.governorPauseCount).toBe(2);
  });

  it('produces immutable telemetry', () => {
    const telemetry = collector.getTelemetry();
    expect(Object.isFrozen(telemetry)).toBe(true);
    expect(Object.isFrozen(telemetry.timeline)).toBe(true);
    expect(Object.isFrozen(telemetry.steps)).toBe(true);
    expect(Object.isFrozen(telemetry.metrics)).toBe(true);
  });

  it('resets state', () => {
    collector.recordEvent({ type: 'SESSION_STARTED', timestamp: new Date().toISOString() });
    collector.reset();
    const telemetry = collector.getTelemetry();
    expect(telemetry.timeline).toHaveLength(0);
    expect(telemetry.steps).toHaveLength(0);
  });

  it('handles empty telemetry', () => {
    const telemetry = collector.getTelemetry();
    expect(telemetry.metrics.stepCount).toBe(0);
    expect(telemetry.metrics.averageStepDurationMs).toBe(0);
    expect(telemetry.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
