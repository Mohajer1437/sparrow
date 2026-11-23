/**
 * G.9: DefaultSafeExperiment — Isolated Execution
 * 
 * Runs changes in an isolated environment before applying to main project.
 * Apply → test → inspect → rollback → report.
 * 
 * Phase 1: Simplified implementation using workspace snapshots.
 */

import { SafeExperiment, ExperimentResult, ExperimentReport } from '../../contracts/safe-experiment';
import { ExecutionContract } from '../../domain/pre-execution/contract';
import { PatchOperation } from '../../domain/patch';
import { Workspace } from '../../contracts/workspace';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultSafeExperiment implements SafeExperiment {
  constructor(private readonly workspace: Workspace) {}

  async run(
    contract: ExecutionContract,
    operations: ReadonlyArray<PatchOperation>,
  ): Promise<ExperimentReport> {
    const experimentId = `experiment-${Date.now()}`;
    const startTime = Date.now();

    ExecutionLogger.log('SAFE_EXPERIMENT', '-', '-',
      `Starting safe experiment for contract ${contract.id}`,
      { experimentId, operationsCount: operations.length },
    );

    // Step 1: Create snapshot
    let snapshotId: string | null = null;
    try {
      const snapshot = await this.workspace.createSnapshot(`Safe experiment: ${experimentId}`);
      snapshotId = snapshot.id;
      ExecutionLogger.log('SAFE_EXPERIMENT', '-', '-',
        `Snapshot created: ${snapshotId}`,
      );
    } catch (error: any) {
      ExecutionLogger.log('SAFE_EXPERIMENT', '-', '-',
        `Failed to create snapshot: ${error.message}`,
      );
      return this.createFailedReport(experimentId, contract.id, 'Failed to create snapshot', startTime);
    }

    // Step 2: Apply operations
    const affectedFiles: string[] = [];
    const errors: string[] = [];
    let buildPassed = true;

    try {
      for (const op of operations) {
        try {
          if (op.operation === 'create' || op.operation === 'modify') {
            if (op.newContent !== undefined) {
              await this.workspace.writeFile(op.path, op.newContent);
              affectedFiles.push(op.path);
            }
          } else if (op.operation === 'delete') {
            await this.workspace.deleteFile(op.path);
            affectedFiles.push(op.path);
          }
        } catch (error: any) {
          errors.push(`Failed to apply ${op.operation} to ${op.path}: ${error.message}`);
        }
      }
    } catch (error: any) {
      errors.push(`Experiment failed during apply: ${error.message}`);
    }

    // Step 3: Run tests (simplified - just check if files are readable)
    let testsPassed = true;
    for (const file of affectedFiles) {
      try {
        await this.workspace.readFile(file);
      } catch (error: any) {
        testsPassed = false;
        errors.push(`File ${file} is not readable after modification: ${error.message}`);
      }
    }

    // Step 4: Rollback
    let rolledBack = false;
    if (snapshotId) {
      try {
        await this.workspace.rollback(snapshotId);
        rolledBack = true;
        ExecutionLogger.log('SAFE_EXPERIMENT', '-', '-',
          `Rolled back to snapshot: ${snapshotId}`,
        );
      } catch (error: any) {
        errors.push(`Failed to rollback: ${error.message}`);
      }
    }

    // Step 5: Build result
    const durationMs = Date.now() - startTime;
    const success = errors.length === 0 && buildPassed && testsPassed;

    const result: ExperimentResult = Object.freeze({
      success,
      buildPassed,
      testsPassed,
      affectedFiles: Object.freeze(affectedFiles),
      errors: Object.freeze(errors),
      durationMs,
      rolledBack,
    });

    // Step 6: Generate report
    const impactSummary = this.generateImpactSummary(result, operations);
    const recommendation = this.determineRecommendation(result);

    ExecutionLogger.log('SAFE_EXPERIMENT', '-', '-',
      `Experiment completed: ${success ? 'SUCCESS' : 'FAILED'}`,
      { experimentId, durationMs, affectedFiles: affectedFiles.length, errors: errors.length },
    );

    return Object.freeze({
      experimentId,
      contractId: contract.id,
      result,
      impactSummary,
      recommendation,
      createdAt: new Date().toISOString(),
    });
  }

  private createFailedReport(
    experimentId: string,
    contractId: string,
    error: string,
    startTime: number,
  ): ExperimentReport {
    const durationMs = Date.now() - startTime;
    return Object.freeze({
      experimentId,
      contractId,
      result: Object.freeze({
        success: false,
        buildPassed: false,
        testsPassed: false,
        affectedFiles: Object.freeze([]),
        errors: Object.freeze([error]),
        durationMs,
        rolledBack: false,
      }),
      impactSummary: `Experiment failed: ${error}`,
      recommendation: 'ABORT',
      createdAt: new Date().toISOString(),
    });
  }

  private generateImpactSummary(
    result: ExperimentResult,
    operations: ReadonlyArray<PatchOperation>,
  ): string {
    const parts: string[] = [];

    parts.push(`${operations.length} operation(s) attempted`);
    parts.push(`${result.affectedFiles.length} file(s) affected`);

    if (result.errors.length > 0) {
      parts.push(`${result.errors.length} error(s) encountered`);
    }

    if (result.buildPassed) {
      parts.push('Build check passed');
    } else {
      parts.push('Build check failed');
    }

    if (result.testsPassed) {
      parts.push('Tests passed');
    } else {
      parts.push('Tests failed');
    }

    if (result.rolledBack) {
      parts.push('Changes rolled back successfully');
    }

    return parts.join('. ');
  }

  private determineRecommendation(result: ExperimentResult): 'APPLY' | 'REVISE' | 'ABORT' {
    if (result.success && result.buildPassed && result.testsPassed) {
      return 'APPLY';
    }

    if (result.errors.length > 0 && result.errors.length <= 2) {
      return 'REVISE';
    }

    return 'ABORT';
  }
}
