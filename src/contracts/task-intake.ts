/**
 * G.1: TaskIntake Contract
 * 
 * Responsible for normalizing raw user prompts into structured TaskIntent.
 * Uses deterministic rules first; LLM can be added later.
 */

import {
  IntentNormalizationRequest,
  IntentNormalizationResult,
} from '../domain/pre-execution/intent';

export interface TaskIntake {
  /**
   * Normalize a raw user prompt into a structured TaskIntent.
   * 
   * @param request - The raw prompt and optional context
   * @returns Normalized intent with ambiguities and readiness score
   */
  normalize(request: IntentNormalizationRequest): Promise<IntentNormalizationResult>;
}
