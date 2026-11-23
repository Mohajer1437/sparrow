/**
 * G.9: SafeExperiment Contract
 * 
 * Runs changes in an isolated environment before applying to main project.
 * Apply → test → inspect → rollback → report.
 */

import { ExecutionContract } from '../domain/pre-execution/contract';
import { PatchOperation } from '../domain/patch';

/** Experiment result */
export interface ExperimentResult {
  readonly success: boolean;
  readonly buildPassed: boolean;
  readonly testsPassed: boolean;
  readonly affectedFiles: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly durationMs: number;
  readonly rolledBack: boolean;
}

/** Experiment report */
export interface ExperimentReport {
  readonly experimentId: string;
  readonly contractId: string;
  readonly result: ExperimentResult;
  readonly impactSummary: string;
  readonly recommendation: 'APPLY' | 'REVISE' | 'ABORT';
  readonly createdAt: string;
}

export interface SafeExperiment {
  /**
   * Run a safe experiment for a contract.
   * 
   * @param contract - The contract to experiment with
   * @param operations - The patch operations to apply
   * @returns Experiment report with recommendation
   */
  run(
    contract: ExecutionContract,
    operations: ReadonlyArray<PatchOperation>,
  ): Promise<ExperimentReport>;
}
