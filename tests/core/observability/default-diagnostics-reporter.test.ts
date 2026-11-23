import { DefaultDiagnosticsReporter } from '../../../src/core/observability/default-diagnostics-reporter';
import { ExecutionTelemetry } from '../../../src/domain/execution-telemetry';

function createTelemetry(overrides: Partial<ExecutionTelemetry> = {}): ExecutionTelemetry {
  return Object.freeze({
    executionId: 'exec-1',
    sessionId: 'sess-1',
    planId: 'plan-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    timeline: Object.freeze([]),
    steps: Object.freeze([]),
    metrics: Object.freeze({
      totalDurationMs: 60000,
      stepCount: 3,
      successfulSteps: 3,
      failedSteps: 0,
      averageStepDurationMs: 20000,
      governorPauseCount: 0,
      retryCount: 0,
      validationFailures: 0,
    }),
    ...overrides,
  });
}

describe('DefaultDiagnosticsReporter', () => {
  let reporter: DefaultDiagnosticsReporter;

  beforeEach(() => {
    reporter = new DefaultDiagnosticsReporter();
  });

  it('generates succeeded diagnostics', () => {
    const diagnostics = reporter.generate(createTelemetry());
    expect(diagnostics.outcome).toBe('succeeded');
    expect(diagnostics.failures).toHaveLength(0);
  });

  it('generates partially_completed diagnostics', () => {
    const telemetry = createTelemetry({
      metrics: Object.freeze({
        totalDurationMs: 60000, stepCount: 3, successfulSteps: 2, failedSteps: 1,
        averageStepDurationMs: 20000, governorPauseCount: 0, retryCount: 0, validationFailures: 1,
      }),
      steps: Object.freeze([
        { stepId: 'step-3', description: 'Failed step', startedAt: '', success: false, error: 'Something broke', retries: 0 },
      ]),
    });
    const diagnostics = reporter.generate(telemetry);
    expect(diagnostics.outcome).toBe('partially_completed');
    expect(diagnostics.failures).toHaveLength(1);
    expect(diagnostics.failures[0]).toContain('step-3');
  });

  it('generates aborted diagnostics', () => {
    const telemetry = createTelemetry({
      timeline: Object.freeze([{ type: 'WORKFLOW_FAILED' as const, timestamp: new Date().toISOString() }]),
      metrics: Object.freeze({
        totalDurationMs: 1000, stepCount: 0, successfulSteps: 0, failedSteps: 0,
        averageStepDurationMs: 0, governorPauseCount: 0, retryCount: 0, validationFailures: 0,
      }),
    });
    const diagnostics = reporter.generate(telemetry);
    expect(diagnostics.outcome).toBe('aborted');
  });

  it('generates warnings for governor pauses', () => {
    const telemetry = createTelemetry({
      metrics: Object.freeze({
        totalDurationMs: 60000, stepCount: 3, successfulSteps: 3, failedSteps: 0,
        averageStepDurationMs: 20000, governorPauseCount: 2, retryCount: 0, validationFailures: 0,
      }),
    });
    const diagnostics = reporter.generate(telemetry);
    expect(diagnostics.warnings.some(w => w.includes('paused 2 time'))).toBe(true);
  });

  it('formats report as human-readable string', () => {
    const diagnostics = reporter.generate(createTelemetry());
    const formatted = reporter.format(diagnostics);
    expect(formatted).toContain('EXECUTION DIAGNOSTICS');
    expect(formatted).toContain('SUCCEEDED');
    expect(formatted).toContain('Total Duration');
  });

  it('produces immutable diagnostics', () => {
    const diagnostics = reporter.generate(createTelemetry());
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics.warnings)).toBe(true);
    expect(Object.isFrozen(diagnostics.failures)).toBe(true);
  });
});
