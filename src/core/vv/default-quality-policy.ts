import { QualityPolicy } from '../../contracts/quality-policy';
import { QualityProfile } from '../../domain/quality-profile';

export class DefaultQualityPolicy implements QualityPolicy {
  readonly profile: QualityProfile;
  readonly maxRepairAttempts: number;
  readonly maxContextExpansion: number;
  readonly maxRepairFiles: number;
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

  constructor(profile: QualityProfile = 'STANDARD') {
    this.profile = profile;
    if (profile === 'MVP') {
      this.maxRepairAttempts = 1;
      this.maxContextExpansion = 1;
      this.maxRepairFiles = 6;
      this.requiresPrePlanningValidation = false;
      this.requiresDeterministicVerification = true;
      this.requiresApiVerification = false;
      this.requiresBrowserVerification = false;
      this.requiresSecurityVerification = false;
      this.requiresAdversarialTesting = false;
      this.requiresRegressionReplay = false;
      this.failOnMissingBrowserTooling = false;
      this.allowInferableAssumptions = true;
      this.blockOnlyMaterialAmbiguity = true;
    } else if (profile === 'PRODUCTION') {
      this.maxRepairAttempts = 3;
      this.maxContextExpansion = 2;
      this.maxRepairFiles = 8;
      this.requiresPrePlanningValidation = true;
      this.requiresDeterministicVerification = true;
      this.requiresApiVerification = true;
      this.requiresBrowserVerification = true;
      this.requiresSecurityVerification = true;
      this.requiresAdversarialTesting = true;
      this.requiresRegressionReplay = true;
      this.failOnMissingBrowserTooling = true;
      this.allowInferableAssumptions = true;
      this.blockOnlyMaterialAmbiguity = true;
    } else {
      this.maxRepairAttempts = 2;
      this.maxContextExpansion = 2;
      this.maxRepairFiles = 8;
      this.requiresPrePlanningValidation = true;
      this.requiresDeterministicVerification = true;
      this.requiresApiVerification = true;
      this.requiresBrowserVerification = true;
      this.requiresSecurityVerification = true;
      this.requiresAdversarialTesting = false;
      this.requiresRegressionReplay = false;
      this.failOnMissingBrowserTooling = false;
      this.allowInferableAssumptions = true;
      this.blockOnlyMaterialAmbiguity = true;
    }
  }

  static fromProfile(profile: QualityProfile): DefaultQualityPolicy {
    return new DefaultQualityPolicy(profile);
  }
}
