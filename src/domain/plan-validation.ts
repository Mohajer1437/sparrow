export type PlanStatus = 'CREATED' | 'VALIDATED' | 'READY' | 'INVALID';

export interface PlanValidationError {
  readonly code: string;
  readonly message: string;
  readonly stepId?: string;
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<PlanValidationError>;
  readonly warnings: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<string>;
}

export interface PlanningMetadata {
  readonly generatedAt: string;
  readonly stepCount: number;
  readonly complexity: 'simple' | 'medium' | 'complex';
  readonly estimatedRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly affectedAreas: ReadonlyArray<string>;
}
