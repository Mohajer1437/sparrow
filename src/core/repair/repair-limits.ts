import {
  DEFAULT_REPAIR_LIMITS,
  RepairAttemptHistory,
  RepairLimits,
  RepairSafetyState,
} from '../../domain/repair-intelligence';
import { QualityPolicy } from '../../contracts/quality-policy';

export function resolveRepairLimits(policy?: QualityPolicy, overrides?: Partial<RepairLimits>): RepairLimits {
  return Object.freeze({
    maxRepairAttempts: overrides?.maxRepairAttempts
      ?? policy?.maxRepairAttempts
      ?? DEFAULT_REPAIR_LIMITS.maxRepairAttempts,
    maxContextExpansion: overrides?.maxContextExpansion
      ?? policy?.maxContextExpansion
      ?? DEFAULT_REPAIR_LIMITS.maxContextExpansion,
    maxRepairFiles: overrides?.maxRepairFiles
      ?? policy?.maxRepairFiles
      ?? DEFAULT_REPAIR_LIMITS.maxRepairFiles,
  });
}

export function evaluateRepairLimits(input: {
  readonly history: RepairAttemptHistory;
  readonly limits: RepairLimits;
  readonly expansionLevel: number;
  readonly candidateFileCount: number;
  readonly startingRepair?: boolean;
}): RepairSafetyState | undefined {
  const completedRepairs = input.history.attempts.filter(item => item.kind === 'REPAIR').length;
  if (input.startingRepair && completedRepairs >= input.limits.maxRepairAttempts) {
    return 'REPAIR_LIMIT_REACHED';
  }
  if (input.expansionLevel > input.limits.maxContextExpansion) {
    return 'REPAIR_LIMIT_REACHED';
  }
  if (input.candidateFileCount > input.limits.maxRepairFiles) {
    return 'REPAIR_LIMIT_REACHED';
  }
  return undefined;
}

export function isRepairLimitReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && reason.includes('REPAIR_LIMIT_REACHED');
}
