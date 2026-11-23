export type StepState = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ExecutionStep {
  readonly id: string;
  readonly description: string;
  readonly state: StepState;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
