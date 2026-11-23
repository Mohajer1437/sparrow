import { QualityProfile } from '../domain/quality-profile';

export interface QualityPolicy {
  readonly profile: QualityProfile;
  readonly maxRepairAttempts: number;
  readonly maxContextExpansion?: number;
  readonly maxRepairFiles?: number;
  readonly requiresPrePlanningValidation: boolean;
  readonly requiresDeterministicVerification: boolean;
  readonly requiresApiVerification: boolean;
  readonly requiresBrowserVerification: boolean;
  readonly requiresSecurityVerification: boolean;
  readonly requiresAdversarialTesting: boolean;
  readonly requiresRegressionReplay: boolean;
  readonly failOnMissingBrowserTooling: boolean;
  readonly allowInferableAssumptions: boolean;
  readonly blockOnlyMaterialAmbiguity: boolean;
}
