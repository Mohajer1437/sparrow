import type { PreExecutionState, PostExecutionState, StateComparison } from '../domain/execution/execution-state';

/**
 * Contract interface for tracking execution state changes.
 *
 * Implementations capture file system state before and after execution,
 * then compare states to detect unexpected modifications.
 *
 * Consumers (AppFactory, WorkflowOrchestrator) should depend on this
 * abstraction rather than the concrete implementation in core/.
 */
export interface IExecutionStateTracker {
  /**
   * Capture file system state before execution begins.
   * Records hash and size of each planned file for later comparison.
   */
  capturePreExecutionState(
    sessionId: string,
    task: string,
    plannedFiles: ReadonlyArray<string>,
  ): Promise<PreExecutionState>;

  /**
   * Capture file system state after execution completes.
   * Includes both originally planned files and any modified files.
   */
  capturePostExecutionState(
    sessionId: string,
    preState: PreExecutionState,
    modifiedFiles: ReadonlyArray<string>,
  ): Promise<PostExecutionState>;

  /**
   * Compare pre and post execution states to identify:
   * - Files that were modified
   * - Files that were created
   * - Files that were deleted
   * - Unexpected changes (modifications outside planned files)
   */
  compareStates(
    pre: PreExecutionState,
    post: PostExecutionState,
  ): StateComparison;
}
