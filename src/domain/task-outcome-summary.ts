import { ExecutionMode } from './execution-mode';

export type TaskOutcomeStatus =
  | 'SUCCESS'
  | 'SUCCESS_AFTER_REPAIR'
  | 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'PAUSED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNKNOWN';

export type TaskOutcomeReasonCode =
  | 'TASK_COMPLETED'
  | 'TASK_COMPLETED_AFTER_REPAIR'
  | 'WORKSPACE_MISMATCH'
  | 'TARGET_NOT_FOUND'
  | 'PLANNER_UNGROUNDED_TARGET'
  | 'SCOPE_BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'CREDENTIAL_REQUIRED'
  | 'CONFIRMATION_REJECTED'
  | 'VALIDATION_FAILED'
  | 'PLANNER_FAILED'
  | 'EXECUTION_FAILED'
  | 'MUTATION_BLOCKED'
  | 'MUTATION_ROLLED_BACK'
  | 'VERIFICATION_FAILED'
  | 'REPAIR_FAILED'
  | 'REPAIR_LIMIT_REACHED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'PROVIDER_FAILURE'
  | 'CLARIFICATION_REQUIRED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type ChangedFilesEvidenceKind =
  | 'PROVEN'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_CHANGES_PROVEN'
  | 'NOT_APPLICABLE';

export interface TaskOutcomeDetails {
  readonly rejectedTargets?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

/**
 * Concise, human-readable outcome summary read model (UX-OUTCOME.1).
 *
 * Deterministically built from structured system state (WorkflowResult / TaskRunSnapshot)
 * to provide a 2-3 line immediate explanation of execution results across CLI, REPL, and Web.
 */
export interface TaskOutcomeSummary {
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly attemptId?: string;
  readonly status: TaskOutcomeStatus;
  readonly outcome: string;
  readonly summary: string;
  readonly reasonCode: TaskOutcomeReasonCode;
  readonly reason: string;
  readonly nextAction?: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly changedFilesEvidence: ChangedFilesEvidenceKind;
  readonly logFileName?: string;
  readonly logFilePath?: string;
  readonly executionMode?: ExecutionMode;
  readonly failurePrimaryCheck?: string;
  readonly expectedWorkspace?: string;
  readonly activeWorkspace?: string;
  readonly details?: ReadonlyArray<string> | TaskOutcomeDetails;
  readonly rejectedTargets?: ReadonlyArray<string>;
}

/**
 * Standardized human-readable text formatter for CLI and REPL (UX-OUTCOME.12, UX-OUTCOME.13).
 */
export function formatOutcomeSummaryText(summary: TaskOutcomeSummary): string {
  const lines: string[] = [];
  lines.push('TASK RESULT');
  lines.push('───────────');

  const symbol =
    summary.status === 'SUCCESS' || summary.status === 'SUCCESS_AFTER_REPAIR'
      ? '✓'
      : summary.status === 'PAUSED'
        ? '⏸'
        : summary.status === 'BLOCKED'
          ? '⊘'
          : summary.status === 'REJECTED'
            ? '⊗'
            : summary.status === 'CANCELLED'
              ? '⊘'
              : '✗';

  lines.push(`${symbol} ${summary.outcome}`);

  if (summary.status === 'SUCCESS' || summary.status === 'SUCCESS_AFTER_REPAIR') {
    if (summary.changedFilesEvidence === 'NO_CHANGES_PROVEN' || summary.changedFiles.length === 0) {
      lines.push('No files were changed.');
    } else {
      lines.push('Changed files:');
      for (const file of summary.changedFiles) {
        lines.push(`  - ${file}`);
      }
    }
  } else if (summary.reason) {
    lines.push(`Reason: ${summary.reason}`);
    if (summary.details) {
      if (Array.isArray(summary.details) && summary.details.length > 0) {
        lines.push('Details:');
        for (const d of summary.details) {
          lines.push(`  - ${d}`);
        }
      } else if (typeof summary.details === 'object' && Array.isArray((summary.details as any).rejectedTargets)) {
        lines.push('Details:');
        for (const d of (summary.details as any).rejectedTargets) {
          lines.push(`  - ${d}`);
        }
      }
    } else if (summary.rejectedTargets && summary.rejectedTargets.length > 0) {
      lines.push('Details:');
      for (const d of summary.rejectedTargets) {
        lines.push(`  - ${d}`);
      }
    }
    if (summary.expectedWorkspace && summary.activeWorkspace) {
      lines.push(`Expected: ${summary.expectedWorkspace}`);
      lines.push(`Active:   ${summary.activeWorkspace}`);
    }
    if (summary.failurePrimaryCheck) {
      lines.push(`Primary check: ${summary.failurePrimaryCheck}`);
    }
    if (summary.nextAction) {
      lines.push(`Next: ${summary.nextAction}`);
    }
  }

  lines.push('');
  lines.push(`Run: ${summary.runId}`);
  if (summary.logFileName && summary.logFileName !== 'NOT_CREATED') {
    lines.push(`Log: ${summary.logFileName}`);
  } else {
    lines.push('Log: NOT_CREATED');
  }

  return lines.join('\n');
}
