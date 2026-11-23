/**
 * G.5: ContractPlanner Contract (Planning v2)
 * 
 * Generates ExecutionContract with precondition/action/observation steps.
 * Coder only receives the contract, not the raw user prompt.
 */

import { ExecutionContract, ContractStep } from '../domain/pre-execution/contract';
import { TaskIntent } from '../domain/pre-execution/intent';
import { ProjectInspection } from './preflight-analyzer';
import { RiskAssessment } from '../domain/pre-execution/risk';
import { Evidence } from '../domain/pre-execution/evidence';

/** Planning result */
export interface ContractPlanningResult {
  readonly contract: ExecutionContract;
  readonly stepsGenerated: number;
  readonly mode: 'EASY' | 'MEDIUM' | 'HARD';
  readonly planningDurationMs: number;
}

export interface ContractPlanner {
  /**
   * Generate an execution contract from intent and evidence.
   * 
   * @param intent - The normalized task intent
   * @param inspection - Project inspection result
   * @param riskAssessment - Risk assessment
   * @param evidence - Collected evidence
   * @returns Execution contract
   */
  plan(
    intent: TaskIntent,
    inspection: ProjectInspection,
    riskAssessment: RiskAssessment,
    evidence: ReadonlyArray<Evidence>,
  ): Promise<ContractPlanningResult>;
}
