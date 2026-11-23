import { ExecutionPlan } from './execution-plan';
import { ExecutionContract } from './pre-execution/contract';
import { ConfigurationSnapshot } from './configuration-snapshot';
import { RuntimeHealth, GovernorDecision } from './runtime-health';

export interface StepResult {
  readonly stepId: string;
  readonly success: boolean;
  readonly error?: string;
  readonly completedAt: string;
}

export interface StepExecutionResult {
  readonly success: boolean;
  readonly results: ReadonlyArray<StepResult>;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ExecutionContext {
  readonly sessionId: string;
  readonly plan: ExecutionPlan | null;
  readonly currentStepIndex: number;
  readonly totalSteps: number;
  readonly projectStructure?: string;
  readonly configurationSnapshot?: ConfigurationSnapshot;
  readonly runtimeHealth?: RuntimeHealth;
  readonly governorDecision?: GovernorDecision;
  readonly startedAt: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly executionId?: string;
  readonly checkpointId?: string;
  readonly resumedFromCheckpoint?: boolean;
  readonly healingState?: Readonly<Record<string, import('./micro-task').MicroTaskHealingState>>;
  /** Stage 7: ExecutionContract policy boundary */
  readonly contract?: ExecutionContract;
  readonly acceptanceContract?: import('./acceptance-contract').AcceptanceContract;
  readonly preserveObservables?: import('./acceptance-contract').PreserveSnapshot;
  /** Authoritative project root for this execution. Same root as tools and evidence. */
  readonly workspacePath?: string;
  /** Milestone B1: strategy output for future gathering. Not consumed by step execution yet. */
  readonly plannerContext?: import('./planner-context').PlannerContext;
  /** R1.18: system-level execution mode carried into every tool call. */
  readonly executionMode?: import('./execution-mode').ExecutionMode;
}
