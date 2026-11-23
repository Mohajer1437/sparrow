import { QualityProfile } from '../domain/quality-profile';
import { VerificationCheck } from '../domain/verification-check';

export interface BrowserVerifier {
  verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly task?: string;
    readonly acceptanceCriteria?: ReadonlyArray<string>;
    /** R1.8: enables route-level attribution of browser checks to a Todo. */
    readonly todoPlan?: import('../domain/todo-plan').TodoPlan;
  }): Promise<ReadonlyArray<VerificationCheck>>;
}
