/**
 * G.0: Execution Gate Domain Types
 * 
 * The Execution Gate is the final checkpoint before mutation.
 * It checks risk, scope, evidence, confirmation, and verifiability.
 * In BLOCKED state, no Coder executes.
 */

import { RiskLevel } from './risk';

/** Gate decision */
export type GateDecision =
  | 'PROCEED'           // All checks passed, proceed to execution
  | 'PROCEED_WITH_CONFIRMATION'  // Proceed but require user confirmation
  | 'BLOCKED'           // Cannot proceed, blocked
  | 'REQUIRES_SAFE_EXPERIMENT';  // Must run safe experiment first

/** Reason for gate decision */
export interface GateReason {
  readonly code: string;
  readonly message: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
}

/** Gate check result */
export interface GateCheckResult {
  readonly passed: boolean;
  readonly reasons: ReadonlyArray<GateReason>;
}

/** Complete gate evaluation */
export interface GateEvaluation {
  readonly decision: GateDecision;
  readonly checks: ReadonlyArray<GateCheckResult>;
  readonly riskLevel: RiskLevel;
  readonly requiresConfirmation: boolean;
  readonly blockedReasons: ReadonlyArray<string>;
  readonly evaluatedAt: string;
}

/** Gate policy configuration */
export interface GatePolicy {
  /** Whether to require confirmation for HIGH risk */
  readonly requireConfirmationForHighRisk: boolean;
  
  /** Whether to block CRITICAL risk entirely */
  readonly blockCriticalRisk: boolean;
  
  /** Whether to require safe experiment for HIGH risk */
  readonly requireSafeExperimentForHighRisk: boolean;
  
  /** Maximum number of files that can be modified without confirmation */
  readonly maxFilesWithoutConfirmation: number;
  
  /** Whether to require evidence for all mutations */
  readonly requireEvidenceForMutation: boolean;
}

/** Default gate policy */
export const DEFAULT_GATE_POLICY: GatePolicy = Object.freeze({
  requireConfirmationForHighRisk: true,
  blockCriticalRisk: true,
  requireSafeExperimentForHighRisk: true,
  maxFilesWithoutConfirmation: 5,
  requireEvidenceForMutation: true,
});
