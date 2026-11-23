import { QualityProfile } from '../domain/quality-profile';
import { VerificationCheck } from '../domain/verification-check';
import { VerificationReport } from '../domain/verification-report';

export interface AdaptiveAdversary {
  generate(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly priorChecks: ReadonlyArray<VerificationCheck>;
    readonly priorReports?: ReadonlyArray<VerificationReport>;
  }): Promise<ReadonlyArray<VerificationCheck>>;
}
