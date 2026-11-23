/**
 * G.7: ContractBuilder Contract
 * 
 * Builds the final ExecutionContract from a validated plan.
 * Separates user's raw prompt from coder's task.
 * Coder only receives the contract, never the raw prompt.
 */

import { ExecutionContract } from '../domain/pre-execution/contract';
import { TaskIntent } from '../domain/pre-execution/intent';
import { ProjectInspection } from './preflight-analyzer';
import { RiskAssessment } from '../domain/pre-execution/risk';
import { Evidence } from '../domain/pre-execution/evidence';
import { CritiqueResult } from './plan-critic';

/** Contract build result */
export interface ContractBuildResult {
  readonly contract: ExecutionContract;
  readonly validated: boolean;
  readonly validationErrors: ReadonlyArray<string>;
  readonly critiqueApproved: boolean;
  readonly builtAt: string;
}

export interface ContractBuilder {
  /**
   * Build the final execution contract.
   * 
   * @param intent - The task intent
   * @param inspection - Project inspection
   * @param riskAssessment - Risk assessment
   * @param evidence - Collected evidence
   * @param critiqueResult - Critique result (if available)
   * @returns Final execution contract
   */
  build(
    intent: TaskIntent,
    inspection: ProjectInspection,
    riskAssessment: RiskAssessment,
    evidence: ReadonlyArray<Evidence>,
    critiqueResult?: CritiqueResult,
    executionPlan?: import('../domain/execution-plan').ExecutionPlan,
  ): Promise<ContractBuildResult>;

  /**
   * Validate a contract before execution.
   * 
   * @param contract - The contract to validate
   * @returns Validation errors (empty if valid)
   */
  validate(contract: ExecutionContract): Promise<ReadonlyArray<string>>;
}
