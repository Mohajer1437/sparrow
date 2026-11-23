/**
 * MicroTask Domain Types
 *
 * A MicroTask is the smallest executable unit in the pipeline.
 * Designed for weak local coding models (7B-14B).
 * Every task has one responsibility, clear I/O, and minimal context.
 */

export type MicroTaskComplexity = 'trivial' | 'simple' | 'moderate';
export type MicroTaskRisk = 'low' | 'medium' | 'high';
export type ReasoningLevel = 'none' | 'basic' | 'architecture';

export interface MicroTaskContext {
  readonly files: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<string>;
  readonly previousTaskOutputs: ReadonlyArray<string>;
}

export interface MicroTaskHealingState {
  readonly attempts: number;
  readonly lastErrorLog?: string;
  readonly escalationLevel: 'none' | 'escalated';
}

export interface MicroTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly targetFiles: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly expectedOutput: string;
  readonly verificationSteps: ReadonlyArray<string>;
  readonly rollbackStrategy: string;
  readonly complexity: MicroTaskComplexity;
  readonly riskLevel: MicroTaskRisk;
  readonly reasoningRequired: ReasoningLevel;
  readonly difficultyScore: number; // 1-10
  readonly requiredContext: MicroTaskContext;
  /** F.7: Expected files for E.3 scope guardrails (optional for backward compat) */
  readonly expectedFiles?: ReadonlyArray<string>;
}

export interface MicroTaskGraph {
  readonly planId: string;
  readonly tasks: ReadonlyArray<MicroTask>;
  readonly totalTasks: number;
  readonly highRiskTasks: number;
  readonly averageDifficulty: number;
  readonly createdAt: string;
}

/**
 * DecompositionContext provides project awareness for decomposition.
 * Version 1 uses minimal data; interface supports future expansion.
 */
export interface DecompositionContext {
  readonly projectStructure?: ReadonlyArray<string>;
  readonly existingFiles?: ReadonlyArray<string>;
  readonly architectureRules?: ReadonlyArray<string>;
  readonly constraints?: ReadonlyArray<string>;
  readonly memoryContext?: string;
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
}
