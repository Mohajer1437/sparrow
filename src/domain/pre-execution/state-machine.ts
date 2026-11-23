/**
 * G.0: Pre-Execution State Machine
 * 
 * States:
 * INTAKE → ANALYZING → INSPECTING_PROJECT → IDENTIFYING_UNCERTAINTIES
 * → WAITING_FOR_USER → REANALYZING → READY_FOR_PLANNING → PLANNING
 * → PLAN_CRITIQUE → PLAN_VALIDATION → CONTRACT_READY → EXECUTION_GATE
 * → EXECUTING → VERIFYING → COMPLETED / RECOVERY / BLOCKED
 */

/** All possible states in the pre-execution pipeline */
export type PreExecutionState =
  | 'INTAKE'
  | 'ANALYZING'
  | 'INSPECTING_PROJECT'
  | 'IDENTIFYING_UNCERTAINTIES'
  | 'WAITING_FOR_USER'
  | 'REANALYZING'
  | 'READY_FOR_PLANNING'
  | 'PLANNING'
  | 'PLAN_CRITIQUE'
  | 'PLAN_VALIDATION'
  | 'CONTRACT_READY'
  | 'EXECUTION_GATE'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'RECOVERY'
  | 'BLOCKED';

/** Valid state transitions */
export const VALID_TRANSITIONS: ReadonlyMap<PreExecutionState, ReadonlyArray<PreExecutionState>> = new Map<PreExecutionState, ReadonlyArray<PreExecutionState>>([
  ['INTAKE', Object.freeze(['ANALYZING', 'BLOCKED'])],
  ['ANALYZING', Object.freeze(['INSPECTING_PROJECT', 'BLOCKED'])],
  ['INSPECTING_PROJECT', Object.freeze(['IDENTIFYING_UNCERTAINTIES', 'BLOCKED'])],
  ['IDENTIFYING_UNCERTAINTIES', Object.freeze(['WAITING_FOR_USER', 'READY_FOR_PLANNING', 'BLOCKED'])],
  ['WAITING_FOR_USER', Object.freeze(['REANALYZING', 'BLOCKED'])],
  ['REANALYZING', Object.freeze(['IDENTIFYING_UNCERTAINTIES', 'READY_FOR_PLANNING', 'BLOCKED'])],
  ['READY_FOR_PLANNING', Object.freeze(['PLANNING', 'BLOCKED'])],
  ['PLANNING', Object.freeze(['PLAN_CRITIQUE', 'BLOCKED'])],
  ['PLAN_CRITIQUE', Object.freeze(['PLAN_VALIDATION', 'PLANNING', 'BLOCKED'])],
  ['PLAN_VALIDATION', Object.freeze(['CONTRACT_READY', 'PLANNING', 'BLOCKED'])],
  ['CONTRACT_READY', Object.freeze(['EXECUTION_GATE', 'BLOCKED'])],
  ['EXECUTION_GATE', Object.freeze(['EXECUTING', 'BLOCKED', 'RECOVERY'])],
  ['EXECUTING', Object.freeze(['VERIFYING', 'RECOVERY', 'BLOCKED'])],
  ['VERIFYING', Object.freeze(['COMPLETED', 'RECOVERY', 'BLOCKED'])],
  ['COMPLETED', Object.freeze([])],
  ['RECOVERY', Object.freeze(['EXECUTING', 'VERIFYING', 'BLOCKED', 'COMPLETED'])],
  ['BLOCKED', Object.freeze([])],
]);

/** Check if a state transition is valid */
export function isValidTransition(from: PreExecutionState, to: PreExecutionState): boolean {
  const validTargets = VALID_TRANSITIONS.get(from);
  return validTargets ? validTargets.includes(to) : false;
}

/** Terminal states (no further transitions) */
export const TERMINAL_STATES: ReadonlyArray<PreExecutionState> = Object.freeze([
  'COMPLETED',
  'BLOCKED',
]);

/** States that require user interaction */
export const USER_INTERACTION_STATES: ReadonlyArray<PreExecutionState> = Object.freeze([
  'WAITING_FOR_USER',
]);

/** States that are part of the planning phase */
export const PLANNING_STATES: ReadonlyArray<PreExecutionState> = Object.freeze([
  'READY_FOR_PLANNING',
  'PLANNING',
  'PLAN_CRITIQUE',
  'PLAN_VALIDATION',
]);
