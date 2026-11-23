import { QualityProfile } from '../domain/quality-profile';
import { VerificationCheck } from '../domain/verification-check';

export interface SecurityVerifier {
  verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<VerificationCheck>>;
}
