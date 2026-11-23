/**
 * G.0: Pre-Execution Invariants
 * 
 * These are the non-negotiable rules of the pre-execution pipeline.
 * Violation of any invariant → BLOCKED state.
 */

/** Invariant violation */
export interface InvariantViolation {
  readonly invariant: string;
  readonly message: string;
  readonly severity: 'WARNING' | 'ERROR' | 'CRITICAL';
  readonly detectedAt: string;
}

/** Invariant check result */
export interface InvariantCheckResult {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<InvariantViolation>;
}

/** All invariants that must hold */
export const INVARIANTS = Object.freeze({
  /** No evidence → No assumption → No mutation */
  NO_EVIDENCE_NO_MUTATION: 'NO_EVIDENCE_NO_MUTATION',
  
  /** No informed decision → No high-risk mutation */
  NO_UNINFORMED_HIGH_RISK: 'NO_UNINFORMED_HIGH_RISK',
  
  /** LLM analyzes; Validator/Policy decides */
  LLM_ANALYZES_POLICY_DECIDES: 'LLM_ANALYZES_POLICY_DECIDES',
  
  /** Questions only when plan-changing */
  QUESTIONS_ONLY_PLAN_CHANGING: 'QUESTIONS_ONLY_PLAN_CHANGING',
  
  /** User sets goal; Agent handles technical decisions */
  USER_GOAL_AGENT_TECHNICAL: 'USER_GOAL_AGENT_TECHNICAL',
  
  /** No unapproved plan reaches Coder */
  NO_UNAPPROVED_PLAN_TO_CODER: 'NO_UNAPPROVED_PLAN_TO_CODER',
  
  /** Unknown is a valid state; no hallucination */
  UNKNOWN_IS_VALID: 'UNKNOWN_IS_VALID',
  
  /** High-risk changes require safe experiment or dry-run */
  HIGH_RISK_REQUIRES_EXPERIMENT: 'HIGH_RISK_REQUIRES_EXPERIMENT',
  
  /** Coder only receives ExecutionContract, not raw prompt */
  CODER_RECEIVES_CONTRACT_ONLY: 'CODER_RECEIVES_CONTRACT_ONLY',
  
  /** BLOCKED state prevents all execution */
  BLOCKED_PREVENTS_EXECUTION: 'BLOCKED_PREVENTS_EXECUTION',
});

/** Readiness criteria (from spec) */
export interface ReadinessCriteria {
  readonly criticalInformationMissing: boolean;
  readonly unresolvedRequiredQuestions: number;
  readonly feasibility: 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN';
  readonly planContractValid: boolean;
  readonly riskPolicySatisfied: boolean;
}

/** Check if execution is ready */
export function isReady(criteria: ReadinessCriteria): boolean {
  return (
    criteria.criticalInformationMissing === false &&
    criteria.unresolvedRequiredQuestions === 0 &&
    criteria.feasibility !== 'INFEASIBLE' &&
    criteria.planContractValid === true &&
    criteria.riskPolicySatisfied === true
  );
}

/** Compute readiness score (0-100) for observability */
export function computeReadinessScore(criteria: ReadinessCriteria): number {
  let score = 0;
  
  // Critical info not missing: 20 points
  if (!criteria.criticalInformationMissing) score += 20;
  
  // No unresolved questions: 20 points
  if (criteria.unresolvedRequiredQuestions === 0) score += 20;
  
  // Feasibility: 20 points
  if (criteria.feasibility === 'FEASIBLE') score += 20;
  else if (criteria.feasibility === 'UNKNOWN') score += 10;
  
  // Contract valid: 20 points
  if (criteria.planContractValid) score += 20;
  
  // Risk policy satisfied: 20 points
  if (criteria.riskPolicySatisfied) score += 20;
  
  return score;
}
