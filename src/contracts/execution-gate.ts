/**
 * G.8: ExecutionGate Contract
 * 
 * The final checkpoint before mutation.
 * Checks risk, scope, evidence, confirmation, and verifiability.
 * In BLOCKED state, no Coder executes.
 */

import { ExecutionContract } from '../domain/pre-execution/contract';
import { TaskIntent } from '../domain/pre-execution/intent';
import { RiskAssessment, RiskPolicy } from '../domain/pre-execution/risk';
import { GateDecision, GateEvaluation, GatePolicy } from '../domain/pre-execution/gate';
import { Evidence } from '../domain/pre-execution/evidence';
import { CritiqueResult } from './plan-critic';

/** Gate check input */
export interface GateCheckInput {
  readonly contract: ExecutionContract;
  readonly intent: TaskIntent;
  readonly riskAssessment: RiskAssessment;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly critiqueResult?: CritiqueResult;
  readonly userConfirmed?: boolean;
}

export interface ExecutionGate {
  /**
   * Evaluate whether execution can proceed.
   * 
   * @param input - All information needed for gate evaluation
   * @param policy - Gate policy to apply
   * @returns Gate evaluation with decision
   */
  evaluate(
    input: GateCheckInput,
    policy?: GatePolicy,
  ): Promise<GateEvaluation>;

  /**
   * Check if execution is blocked.
   * 
   * @param evaluation - Gate evaluation result
   * @returns Whether execution is blocked
   */
  isBlocked(evaluation: GateEvaluation): boolean;
}
