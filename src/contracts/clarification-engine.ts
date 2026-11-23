/**
 * G.3: ClarificationEngine Contract
 * 
 * Generates questions only when they change the plan or execution.
 * Each question has options with risk and consequences.
 */

import { Question, QuestionResponse } from '../domain/pre-execution/question';
import { TaskIntent } from '../domain/pre-execution/intent';
import { RiskAssessment } from '../domain/pre-execution/risk';

/** Clarification result */
export interface ClarificationResult {
  readonly questions: ReadonlyArray<Question>;
  readonly requiredQuestions: ReadonlyArray<Question>;
  readonly optionalQuestions: ReadonlyArray<Question>;
  readonly hasBlockingQuestions: boolean;
}

export interface ClarificationEngine {
  /**
   * Generate clarification questions from intent ambiguities.
   * Only generates questions that change the plan or execution.
   * 
   * @param intent - The task intent with ambiguities
   * @param riskAssessment - Current risk assessment
   * @returns Generated questions
   */
  generateQuestions(
    intent: TaskIntent,
    riskAssessment: RiskAssessment,
    ambiguities?: ReadonlyArray<string>,
  ): Promise<ClarificationResult>;

  /**
   * Process user's response to a question.
   * 
   * @param question - The question being answered
   * @param response - User's response
   * @returns Updated intent after processing response
   */
  processResponse(
    question: Question,
    response: QuestionResponse,
  ): Promise<TaskIntent>;
}
