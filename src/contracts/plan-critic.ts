/**
 * G.6: PlanCritic Contract
 * 
 * Independently critiques plans before execution.
 * Assumes the plan is wrong and tries to find problems.
 * Can reject plans and trigger replanning.
 */

import { ExecutionContract, ContractStep } from '../domain/pre-execution/contract';
import { TaskIntent } from '../domain/pre-execution/intent';
import { RiskAssessment } from '../domain/pre-execution/risk';

/** Issue found during critique */
export interface CritiqueIssue {
  readonly id: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  readonly category: 
    | 'UNSUPPORTED_ASSUMPTION'
    | 'MISSING_EVIDENCE'
    | 'AMBIGUITY'
    | 'SCOPE_CREEP'
    | 'PREMATURE_MUTATION'
    | 'INCOMPLETE_SUCCESS_CRITERIA'
    | 'SCHEMA_VIOLATION'
    | 'INVARIANT_VIOLATION';
  readonly message: string;
  readonly stepId?: string;
  readonly suggestion?: string;
}

/** Critique result */
export interface CritiqueResult {
  readonly approved: boolean;
  readonly issues: ReadonlyArray<CritiqueIssue>;
  readonly criticalIssues: ReadonlyArray<CritiqueIssue>;
  readonly warnings: ReadonlyArray<CritiqueIssue>;
  readonly confidenceScore: number; // 0-100
  readonly recommendation: 'APPROVE' | 'REVISE' | 'REJECT' | 'REPLAN';
}

export interface PlanCritic {
  /**
   * Critique an execution contract.
   * Assumes the plan is wrong and tries to find problems.
   * 
   * @param contract - The contract to critique
   * @param intent - The original task intent
   * @param riskAssessment - Risk assessment
   * @returns Critique result with approval decision
   */
  critique(
    contract: ExecutionContract,
    intent: TaskIntent,
    riskAssessment: RiskAssessment,
  ): Promise<CritiqueResult>;

  /**
   * Validate contract schema and invariants.
   * 
   * @param contract - The contract to validate
   * @returns Validation errors (empty if valid)
   */
  validateSchema(contract: ExecutionContract): Promise<ReadonlyArray<string>>;
}
