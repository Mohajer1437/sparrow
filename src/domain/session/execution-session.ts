import { SessionStatus } from './session-status';
import { ExecutionStep } from './step-state';
import { DecisionRecord } from './decision-record';

export interface ExecutionSession {
  readonly id: string;
  readonly workspace: string;
  readonly task: string;
  readonly executionPlanId?: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly steps: ReadonlyArray<ExecutionStep>;
  readonly decisions: ReadonlyArray<DecisionRecord>;
  readonly error?: string;
  readonly failedStepId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionSessionInput {
  readonly id: string;
  readonly workspace: string;
  readonly task: string;
  readonly executionPlanId?: string;
  readonly status: SessionStatus;
  readonly steps?: ReadonlyArray<ExecutionStep>;
  readonly decisions?: ReadonlyArray<DecisionRecord>;
  readonly error?: string;
  readonly failedStepId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
