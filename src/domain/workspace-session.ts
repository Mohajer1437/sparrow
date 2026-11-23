import { Decision } from './decision';
/**
 * R2.4 + R2.5 + R2.6: WorkspaceSession Domain
 */
import { ExecutionPlan } from './execution-plan';

// G.0: Pre-Execution State (Stage 0 — optional fields for future integration)
import { TaskIntent } from './pre-execution/intent';
import { Evidence } from './pre-execution/evidence';
import { RiskAssessment } from './pre-execution/risk';
import { ExecutionContract } from './pre-execution/contract';
import { Question } from './pre-execution/question';


/**
 * R2.4 Hardening: Retry attempt record for failure tracking
 */
export interface RetryAttempt {
  readonly attempt: number;
  readonly timestamp: string;
  readonly action: string;
  readonly error: string;
  readonly resolution?: string;
}


export type SessionStatus =
  | 'created'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'rolled_back';

export type SessionEventType =
  | 'SESSION_CREATED'
  | 'PLAN_CREATED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'TOOL_EXECUTED'
  | 'VALIDATION_FAILED'
  | 'SESSION_COMPLETED'
  | 'SESSION_FAILED'
  | 'SESSION_PAUSED'
  | 'SESSION_RESUMED'
  | 'BACKUP_CREATED'
  | 'PATCH_APPLIED'
  | 'PATCH_FAILED'
  | 'VALIDATION_STARTED'
  | 'VALIDATION_PASSED'
  | 'TESTS_STARTED'
  | 'TESTS_PASSED'
  | 'TESTS_FAILED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_COMPLETED'
  | 'GIT_COMMIT_STARTED'
  | 'GIT_COMMIT_COMPLETED'
  | 'GIT_COMMIT_FAILED'
  | 'GIT_ROLLBACK_STARTED'
  | 'GIT_ROLLBACK_COMPLETED'
  | 'DECISION_MADE'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_COMPLETED'
  | 'VERIFICATION_FAILED'
  | 'INTENT_NORMALIZED'
  | 'PREFLIGHT_COMPLETED'  // G.2: Preflight observation (Stage 2)
  | 'EVIDENCE_COLLECTED'  // G.2: Evidence observation (Stage 2)
  | 'CLARIFICATION_STARTED'  // G.3: Clarification started (Stage 3)
  | 'CLARIFICATION_REQUIRED'  // G.3: Blocking clarification needed (Stage 3)
  | 'CLARIFICATION_COMPLETED'  // G.3: Clarification completed (Stage 3)
  | 'RISK_ASSESSED'  // G.4: Risk assessment completed (Stage 4)
  | 'CONTRACT_BUILT'  // G.5: Execution contract built (Stage 5)
  | 'EXECUTION_GATE_EVALUATED'  // G.6: Execution gate evaluated (Stage 6)
  | 'EXECUTION_ALLOWED'  // G.6: Execution allowed by gate (Stage 6)
  | 'EXECUTION_BLOCKED';  // G.6: Execution blocked by gate (Stage 6)

import { Reflection } from './reflection';

export interface SessionEvent {
  readonly id: string;
  readonly type: SessionEventType;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface WorkspaceSession {
  readonly id: string;
  readonly workspacePath: string;
  readonly task: string;
  readonly plan: ExecutionPlan | null;
  readonly status: SessionStatus;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly events: ReadonlyArray<Readonly<SessionEvent>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modifiedFiles?: ReadonlyArray<string>;
  readonly retryHistory?: ReadonlyArray<RetryAttempt>;
  readonly reflection?: Reflection;
  readonly decisions?: ReadonlyArray<Decision>;
  readonly configurationSnapshot?: import('./configuration-snapshot').ConfigurationSnapshot;
  // G.0: Pre-Execution State (Stage 0 — optional, not yet used in execution)
  readonly intent?: TaskIntent;
  readonly evidence?: ReadonlyArray<Evidence>;
  readonly risk?: RiskAssessment;
  readonly contract?: ExecutionContract;
  // G.3: Clarification state (Stage 3)
  readonly questions?: ReadonlyArray<Question>;
  readonly clarificationStatus?: 'none' | 'required' | 'completed';
}

export function isResumable(status: SessionStatus): boolean {
  return status !== 'completed' && status !== 'failed';
}

export function isTerminal(status: SessionStatus): boolean {
  return status === 'completed' || status === 'failed';
}
