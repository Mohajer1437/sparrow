import { CommandResult } from '../domain/patch';

/**
 * R2.6: ValidationEngine Contract
 *
 * Runs build/compile checks to verify patch correctness.
 * Returns aggregated result across all configured commands.
 */
export interface ValidationEngine {
  /**
   * Run all configured validation commands.
   * Returns success only if ALL commands pass.
   */
  validate(changedFiles?: ReadonlyArray<string>): Promise<CommandResult>;
}
