/**
 * G.0: Question Domain Types
 * 
 * Questions are only asked when they change the plan or execution.
 * Each question has options with risk and consequences.
 */

/** Type of question */
export type QuestionType = 'single_choice' | 'multi_choice';

/** Impact of question on plan/execution */
export type QuestionImpact =
  | 'PLAN_CHANGING'      // Changes the plan structure
  | 'EXECUTION_CHANGING' // Changes how execution happens
  | 'SCOPE_CHANGING'     // Changes what files are in scope
  | 'RISK_CHANGING';     // Changes risk assessment

/** A single option in a question */
export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  
  /** Risk level if this option is chosen */
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  /** Consequences of choosing this option */
  readonly consequences: ReadonlyArray<string>;
  
  /** What this option affects */
  readonly affects: ReadonlyArray<string>;
}

/** A clarification question */
export interface Question {
  readonly id: string;
  
  /** Why this question is being asked */
  readonly reason: string;
  
  /** The actual question text */
  readonly question: string;
  
  /** Type of question */
  readonly type: QuestionType;
  
  /** Agent's recommended option */
  readonly recommendation: string; // option id
  
  /** Available options */
  readonly options: ReadonlyArray<QuestionOption>;
  
  /** Whether this question is required (blocking) */
  readonly required: boolean;
  
  /** What this question affects */
  readonly affects: ReadonlyArray<QuestionImpact>;
  
  /** Status of the question */
  readonly status: 'PENDING' | 'ANSWERED' | 'SKIPPED' | 'EXPIRED';
  
  /** User's answer (if answered) */
  readonly answer?: ReadonlyArray<string>; // option ids
  
  /** When the question was answered */
  readonly answeredAt?: string;
}

/** User's response to a question */
export interface QuestionResponse {
  readonly questionId: string;
  readonly selectedOptions: ReadonlyArray<string>;
  readonly overrodeRecommendation: boolean;
  readonly respondedAt: string;
}
