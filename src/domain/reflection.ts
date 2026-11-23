export interface Reflection {
  readonly sessionId: string;
  readonly timestamp: string;
  readonly taskAttempted: string;
  readonly executionOutcome: 'success' | 'partial_failure' | 'failed' | 'rolled_back' | 'paused';
  readonly stepsCompleted: number;
  readonly totalSteps: number;
  readonly toolsUsed: ReadonlyArray<string>;
  readonly filesModified: ReadonlyArray<string>;
  readonly verificationExecuted: boolean;
  readonly verificationPassed: boolean;
  readonly retriesRequired: number;
  readonly rollbackPerformed: boolean;
  readonly stepFailureCount: number;
  readonly stepsStarted: number;
  readonly toolFailureCount: number;
  readonly toolSuccessCount: number;
  readonly summary: string;
}
