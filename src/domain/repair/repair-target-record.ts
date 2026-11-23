/**
 * R4.34/R4.35/R4.36: the one shape that carries repair-targeting evidence out
 * of a run. CLI, REPL, the Web API and the reliability record all project from
 * this, so no interface recomputes whether a repair was legitimate.
 */

import {
  OriginalIntent,
  IntentConfidence,
  RepairCompletion,
  RepairOperation,
  RepairSafetyFinding,
  RepairSafetyFindingKind,
  RepairTargetDecision,
} from './repair-objective';

export interface RepairTargetRecord {
  readonly attemptId: string;
  readonly attemptNumber: number;
  /** R4.1: the user's original words. */
  readonly originalTask: string;
  /** R4.2: empty means UNKNOWN, not "none required". */
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly intent: OriginalIntent;
  readonly intentConfidence: IntentConfidence;
  readonly intentEvidence?: string;
  readonly originalTodoId?: string;
  readonly originalFiles: ReadonlyArray<string>;
  readonly primaryFailure?: string;
  readonly allowedFiles: ReadonlyArray<string>;
  readonly allowedOperations: ReadonlyArray<RepairOperation>;
  readonly proposedFiles: ReadonlyArray<string>;
  readonly proposedOperations: ReadonlyArray<RepairOperation>;
  readonly disallowedFiles: ReadonlyArray<string>;
  readonly decision: RepairTargetDecision;
  readonly decisionReason: string;
  readonly findings: ReadonlyArray<RepairSafetyFinding>;
  readonly completion?: RepairCompletion;
}

export function findingKinds(
  record: Pick<RepairTargetRecord, 'findings'>,
): ReadonlyArray<RepairSafetyFindingKind> {
  return Object.freeze([...new Set(record.findings.map(item => item.kind))].sort());
}

export function hasFinding(
  record: Pick<RepairTargetRecord, 'findings'>,
  kind: RepairSafetyFindingKind,
): boolean {
  return record.findings.some(item => item.kind === kind);
}

export function summarizeRepairTarget(record: RepairTargetRecord): string {
  const parts = [
    record.attemptId,
    `intent=${record.intent}`,
    `decision=${record.decision}`,
    `allowed=${record.allowedFiles.join(',') || '(none)'}`,
    `proposed=${record.proposedFiles.join(',') || '(none)'}`,
  ];
  const kinds = findingKinds(record);
  if (kinds.length > 0) parts.push(`findings=${kinds.join(',')}`);
  if (record.completion) parts.push(`completion=${record.completion.state}`);
  return parts.join(' ');
}
