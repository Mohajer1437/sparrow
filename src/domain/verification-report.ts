import { QualityProfile } from './quality-profile';
import { VerificationCheck } from './verification-check';
import { FailureContract } from './failure-contract';
import { ProductAnalysis } from './product-analysis';
import { TodoPlan } from './todo-plan';
import { Skill } from './skill';

export interface VerificationReport {
  readonly id: string;
  readonly createdAt: string;
  readonly qualityProfile: QualityProfile;
  readonly passed: boolean;
  readonly checks: ReadonlyArray<VerificationCheck>;
  readonly evidence: ReadonlyArray<string>;
  readonly failureContract?: FailureContract;
  /** R1.25-R1.27: what verification did (or was blocked from doing) to project state. */
  readonly sideEffects?: import('./verification-side-effect').VerificationSideEffectLedger;
}

export interface VerificationRequest {
  readonly task: string;
  readonly qualityProfile: QualityProfile;
  readonly workspacePath: string;
  readonly changedFiles?: ReadonlyArray<string>;
  /** PHASE-09: authoritative files touched by this run (not dirty-tree only). */
  readonly runChangeSet?: import('./run-change-set').RunChangeSet;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly intentContract?: ProductAnalysis;
  readonly repairAttempt?: number;
  readonly todoPlan?: TodoPlan;
  readonly skills?: ReadonlyArray<Skill>;
  /**
   * R1.21/R1.26: verification is read-only by default. A verifier may only
   * mutate project state when the caller declares CONTROLLED_MUTATION.
   */
  readonly sideEffectPolicy?: import('./verification-side-effect').VerificationSideEffectPolicy;
  readonly executionMode?: import('./execution-mode').ExecutionMode;
}
