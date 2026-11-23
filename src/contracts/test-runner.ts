import { CommandResult } from '../domain/patch';

/**
 * R2.6: TestRunner Contract
 *
 * Runs project tests after patch application.
 */
export interface TestRunner {
  /**
   * Run configured test command.
   * Returns pass/fail with stdout/stderr captured.
   */
  run(changedFiles?: ReadonlyArray<string>): Promise<CommandResult>;
}
