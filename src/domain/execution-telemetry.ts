export type TimelineEventType =
  | 'SESSION_STARTED'
  | 'PLAN_CREATED'
  | 'PLAN_VALIDATED'
  | 'GOVERNOR_PAUSED'
  | 'GOVERNOR_RESUMED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'REFLECTION_COMPLETED'
  | 'MEMORY_UPDATED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED';

export interface TimelineEvent {
  readonly type: TimelineEventType;
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StepTelemetry {
  readonly stepId: string;
  readonly description: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly success: boolean;
  readonly error?: string;
  readonly retries: number;
  readonly governorAction?: string;
}

export interface ExecutionMetrics {
  readonly totalDurationMs: number;
  readonly stepCount: number;
  readonly successfulSteps: number;
  readonly failedSteps: number;
  readonly averageStepDurationMs: number;
  readonly governorPauseCount: number;
  readonly retryCount: number;
  readonly validationFailures: number;
}

export interface ExecutionTelemetry {
  readonly executionId: string;
  readonly sessionId: string;
  readonly planId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly timeline: ReadonlyArray<TimelineEvent>;
  readonly steps: ReadonlyArray<StepTelemetry>;
  readonly metrics: ExecutionMetrics;
}

export type DiagnosticOutcome =
  | 'succeeded'
  | 'partially_completed'
  | 'aborted'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'failed';

export interface ExecutionDiagnostics {
  readonly executionId: string;
  readonly outcome: DiagnosticOutcome;
  readonly reason?: string;
  readonly timeline: ReadonlyArray<TimelineEvent>;
  readonly metrics: ExecutionMetrics;
  readonly warnings: ReadonlyArray<string>;
  readonly failures: ReadonlyArray<string>;
  readonly generatedAt: string;
}

export interface ObservabilityConfig {
  readonly enabled: boolean;
  readonly verbosity: 'minimal' | 'standard' | 'detailed';
  readonly timelineRetention: number;
}
