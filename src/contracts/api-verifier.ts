import { QualityProfile } from '../domain/quality-profile';
import { VerificationCheck } from '../domain/verification-check';

import { TodoPlan } from '../domain/todo-plan';
import { Skill } from '../domain/skill';
import { PersistenceAssertion } from '../domain/endpoint-verification';

export interface ApiVerifier {
  verify(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly task?: string;
    readonly acceptanceCriteria?: ReadonlyArray<string>;
    readonly todoPlan?: TodoPlan;
    readonly skills?: ReadonlyArray<Skill>;
    readonly persistenceAssertions?: ReadonlyArray<{
      readonly endpointId: string;
      readonly assertion: PersistenceAssertion;
    }>;
    /** R1.26: READ_ONLY forbids mutating probes; defaults to READ_ONLY. */
    readonly sideEffectPolicy?: import('../domain/verification-side-effect').VerificationSideEffectPolicy;
  }): Promise<ReadonlyArray<VerificationCheck>>;
  /** R1.27: side effects this verifier performed or refused during the last verify(). */
  drainSideEffects?(): ReadonlyArray<import('../domain/verification-side-effect').VerificationSideEffect>;
  runStoredScenario?(input: {
    readonly baseUrl: string;
    readonly method: string;
    readonly path: string;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly expectedStatuses?: ReadonlyArray<number>;
    readonly scenario?: string;
    readonly route?: string;
    readonly file?: string;
  }): Promise<VerificationCheck>;
}
