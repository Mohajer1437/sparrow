/**
 * G.0: Execution Contract Domain Types
 * 
 * The Execution Contract is the ONLY input Coder receives.
 * It contains objective, context, evidence, constraints, and steps.
 * User's raw prompt is NOT passed to Coder.
 */

import { RiskLevel } from './risk';

/** A single step in the execution contract */
export interface ContractStep {
  readonly id: string;
  
  /** What must be true before this step executes */
  readonly precondition: string;
  
  /** The action to perform */
  readonly action: string;
  
  /** What should be observed after the action */
  readonly expectedObservation: string;
  
  /** How to verify success */
  readonly successCriteria: ReadonlyArray<string>;
  
  /** What to do if this step fails */
  readonly failureHandling: string;
  
  /** Files this step is allowed to modify */
  readonly filesInScope: ReadonlyArray<string>;
  
  /** Files this step must NOT modify */
  readonly filesOutOfScope: ReadonlyArray<string>;
  
  /** Estimated risk of this step */
  readonly riskLevel: RiskLevel;
}

/** The complete execution contract */
export interface ExecutionContract {
  readonly id: string;

  /** Plan identifier this contract is bound to (G.6 Stage 6) */
  readonly planId: string;
  
  /** What the user wants to achieve */
  readonly objective: string;
  
  /** Project context (framework, structure, etc.) */
  readonly context: string;
  
  /** Verified facts about the project */
  readonly knownFacts: ReadonlyArray<string>;
  
  /** Evidence supporting the plan */
  readonly evidence: ReadonlyArray<string>;
  
  /** Hypotheses that were tested */
  readonly hypotheses: ReadonlyArray<string>;
  
  /** Constraints on execution */
  readonly constraints: ReadonlyArray<string>;
  
  /** Actions the agent is allowed to perform */
  readonly allowedActions: ReadonlyArray<string>;
  
  /** Actions the agent must NOT perform */
  readonly forbiddenActions: ReadonlyArray<string>;
  
  /** Files the agent is allowed to modify */
  readonly filesInScope: ReadonlyArray<string>;
  
  /** Files the agent must NOT modify */
  readonly filesOutOfScope: ReadonlyArray<string>;
  
  /** Preconditions that must be met before execution */
  readonly preconditions: ReadonlyArray<string>;
  
  /** The steps to execute */
  readonly steps: ReadonlyArray<ContractStep>;
  
  /** Overall risk assessment */
  readonly risk: RiskLevel;
  
  /** Impact analysis */
  readonly impact: string;
  
  /** Rollback strategy */
  readonly rollback: string;
  
  /** Verification strategy */
  readonly verification: string;
  
  /** Output requirements */
  readonly outputRequirements: ReadonlyArray<string>;
  
  /** When the contract was created */
  readonly createdAt: string;
  
  /** Contract version */
  readonly version: string;
  
  /** Whether this contract has been validated */
  readonly validated: boolean;
  
  /** Validation errors (if any) */
  readonly validationErrors: ReadonlyArray<string>;
}

/** Request to build an execution contract */
export interface ContractBuildRequest {
  readonly objective: string;
  readonly context: string;
  readonly knownFacts: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<ContractStep>;
  readonly risk: RiskLevel;
  readonly impact: string;
  readonly rollback: string;
  readonly verification: string;
}
