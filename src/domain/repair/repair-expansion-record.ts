/**
 * R3.14/R3.28/R3.29: the one shape that carries expansion evidence out of a
 * run and into the read models. CLI, REPL, Web and the reliability record all
 * project from this rather than each deriving expansion state of their own.
 */

import {
  ContextDelta,
  ExpansionCandidate,
  ExpansionDecision,
  ExpansionStopCode,
  MissingEvidence,
  RejectedCandidate,
} from './context-expansion';

export interface RepairExpansionRecord {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly expansionLevel: number;
  readonly decision: ExpansionDecision;
  readonly reason: string;
  readonly stopCode?: ExpansionStopCode;
  readonly missingEvidence: ReadonlyArray<MissingEvidence>;
  readonly candidates: ReadonlyArray<ExpansionCandidate>;
  readonly rejected: ReadonlyArray<RejectedCandidate>;
  /** Files this expansion added on top of the previous context. */
  readonly selectedFiles: ReadonlyArray<string>;
  readonly previousContextFingerprint?: string;
  readonly contextFingerprint?: string;
  readonly contextDelta?: ContextDelta;
  readonly previousPlanFingerprint?: string;
  readonly planFingerprint?: string;
  readonly duplicatePlan: boolean;
}

export function summarizeRepairExpansion(record: RepairExpansionRecord): string {
  const parts = [
    `${record.attemptId}`,
    `level=${record.expansionLevel}`,
    `decision=${record.decision}`,
  ];
  if (record.stopCode) parts.push(`stop=${record.stopCode}`);
  if (record.selectedFiles.length > 0) parts.push(`added=${record.selectedFiles.join(',')}`);
  if (record.contextDelta) {
    parts.push(`newEvidence=${record.contextDelta.hasNewEvidence ? 'yes' : 'no'}`);
  }
  return parts.join(' ');
}
