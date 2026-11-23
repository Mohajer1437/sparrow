/**
 * G.0: Task Intent Domain Types
 * 
 * Normalizes user prompt into structured intent before execution.
 * Separates facts, assumptions, hypotheses, and unknowns.
 */

/** Type of task being requested */
export type IntentType =
  | 'BUG_FIX'
  | 'FEATURE'
  | 'REFACTOR'
  | 'INVESTIGATION'
  | 'CONFIGURATION'
  | 'TEST'
  | 'DOCUMENTATION'
  | 'DEPENDENCY'
  | 'PERFORMANCE';

/** Complexity mode for task strategy */
export type TaskMode = 'EASY' | 'MEDIUM' | 'HARD';

/** Information classification */
export type InformationStatus = 'FACT' | 'ASSUMPTION' | 'HYPOTHESIS' | 'UNKNOWN';

/** A single piece of information extracted from user prompt */
export interface InformationItem {
  readonly id: string;
  readonly content: string;
  readonly status: InformationStatus;
  readonly source: 'user_prompt' | 'project_inspection' | 'evidence' | 'agent_inference';
  readonly confidence?: number; // 0-1, optional
  readonly requiresEvidence: boolean;
}

/** Normalized task intent */
export interface TaskIntent {
  readonly id: string;
  readonly rawPrompt: string;
  readonly type: IntentType;
  readonly mode: TaskMode;
  
  /** What the user wants to achieve */
  readonly objective: string;
  
  /** Initial scope (may be refined during preflight) */
  readonly initialScope: ReadonlyArray<string>;
  
  /** Symptoms or errors mentioned by user */
  readonly symptoms: ReadonlyArray<string>;
  
  /** Known errors or error messages */
  readonly knownErrors: ReadonlyArray<string>;
  
  /** Constraints mentioned by user */
  readonly constraints: ReadonlyArray<string>;
  
  /** Success criteria (what "done" means) */
  readonly successCriteria: ReadonlyArray<string>;
  
  /** Classified information items */
  readonly information: ReadonlyArray<InformationItem>;
  
  /** Timestamp of normalization */
  readonly normalizedAt: string;
}

/** Request to normalize a user prompt into TaskIntent */
export interface IntentNormalizationRequest {
  readonly rawPrompt: string;
  readonly projectContext?: string;
  readonly previousIntents?: ReadonlyArray<TaskIntent>;
}

/** Result of intent normalization */
export interface IntentNormalizationResult {
  readonly intent: TaskIntent;
  readonly ambiguities: ReadonlyArray<string>;
  readonly criticalMissingInfo: ReadonlyArray<string>;
  readonly readinessScore: number; // 0-100
}
