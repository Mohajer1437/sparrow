/**
 * G.10: PreExecutionOrchestrator Contract
 * 
 * Coordinates the entire pre-execution pipeline:
 * Intent → Preflight → Evidence → Clarification → Decision → Planning → Critique → Contract → Gate
 * 
 * This is the single entry point for the pre-execution layer.
 */

import { TaskIntent, IntentNormalizationRequest } from '../domain/pre-execution/intent';
import { PreExecutionState } from '../domain/pre-execution/state-machine';
import { ExecutionContract } from '../domain/pre-execution/contract';
import { Question, QuestionResponse } from '../domain/pre-execution/question';
import { RiskAssessment } from '../domain/pre-execution/risk';
import { Evidence } from '../domain/pre-execution/evidence';
import { GateEvaluation } from '../domain/pre-execution/gate';
import { PreflightResult } from './preflight-analyzer';
import { ClarificationResult } from './clarification-engine';
import { CritiqueResult } from './plan-critic';

/** Pre-execution pipeline result */
export interface PreExecutionResult {
  readonly state: PreExecutionState;
  readonly intent: TaskIntent | null;
  readonly preflight: PreflightResult | null;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly questions: ReadonlyArray<Question>;
  readonly riskAssessment: RiskAssessment | null;
  readonly contract: ExecutionContract | null;
  readonly critique: CritiqueResult | null;
  readonly gateEvaluation: GateEvaluation | null;
  readonly readinessScore: number;
  readonly blockedReasons: ReadonlyArray<string>;
  readonly durationMs: number;
}

/** Pre-execution pipeline configuration */
export interface PreExecutionConfig {
  readonly skipClarification: boolean;
  readonly skipCritique: boolean;
  readonly skipGate: boolean;
  readonly requireEvidence: boolean;
  readonly maxQuestions: number;
}

/** Default configuration */
export const DEFAULT_PRE_EXECUTION_CONFIG: PreExecutionConfig = Object.freeze({
  skipClarification: false,
  skipCritique: false,
  skipGate: false,
  requireEvidence: true,
  maxQuestions: 3,
});

export interface PreExecutionOrchestrator {
  /**
   * Run the complete pre-execution pipeline.
   * 
   * @param rawPrompt - User's raw prompt
   * @param config - Pipeline configuration
   * @returns Complete pre-execution result
   */
  run(
    rawPrompt: string,
    config?: PreExecutionConfig,
  ): Promise<PreExecutionResult>;

  /**
   * Answer a pending question and continue the pipeline.
   * 
   * @param questionId - ID of the question to answer
   * @param response - User's response
   * @returns Updated pre-execution result
   */
  answerQuestion(
    questionId: string,
    response: QuestionResponse,
  ): Promise<PreExecutionResult>;

  /**
   * Get the current state of the pipeline.
   */
  getState(): PreExecutionState;

  /**
   * Check if the pipeline is ready for execution.
   */
  isReady(): boolean;
}
