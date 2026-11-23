export type DecisionType =
  | 'ROLLBACK_CHOSEN'
  | 'RETRY_SCHEDULED'
  | 'VERIFICATION_STRATEGY_SELECTED'
  | 'PATCH_REJECTED'
  | 'GENERIC_RUNTIME_DECISION';

export type DecisionSource = 'runtime' | 'planner' | 'user';

export interface Decision {
  readonly id: string;
  readonly type: DecisionType;
  readonly rationale: string;
  readonly evidence: ReadonlyArray<string>;
  readonly timestamp: string;
  readonly source: DecisionSource;
}
