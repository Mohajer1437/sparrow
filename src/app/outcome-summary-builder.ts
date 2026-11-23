import * as path from 'path';
import {
  ChangedFilesEvidenceKind,
  TaskOutcomeReasonCode,
  TaskOutcomeStatus,
  TaskOutcomeSummary,
} from '../domain/task-outcome-summary';
import { TaskRunSnapshot } from '../domain/task-run';
import { redactText } from './secret-redaction';
import { sanitizeRejectedTargets } from '../domain/planner-allowed-targets';

/**
 * Strips stack traces, multiline noise, and secrets from user-facing error reasons.
 */
function sanitizeReason(text: string): string {
  if (!text) return '';
  let cleaned = redactText(text);
  // Simplify Ollama JSON errors
  if (cleaned.includes('Ollama API error: 429') || cleaned.includes('weekly usage limit')) {
    return 'Ollama API error 429: Weekly cloud usage limit reached.';
  }
  if (cleaned.includes('Ollama API error: 402') || cleaned.includes('requires a subscription')) {
    return 'Ollama API error 402: Cloud model requires an active subscription or extra usage.';
  }
  // Strip JavaScript / Node.js stack trace lines
  cleaned = cleaned.replace(/\r?\n\s*at\s+[^\r\n]*/g, '');
  // Take primary summary line if multiline
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] ?? cleaned.trim();
}

/** PHASE-09: outcome is a view of FinalTruth when present. */
function summarizeFromFinalTruth(snapshot: TaskRunSnapshot): TaskOutcomeSummary | null {
  const truth = snapshot.finalTruth;
  if (!truth) return null;

  const taskId = snapshot.taskId;
  const runId = snapshot.runId || snapshot.taskId;
  const sessionId = snapshot.sessionId;
  const attemptId = snapshot.attemptCount ? `attempt-${snapshot.attemptCount}` : 'attempt-1';
  const logFileName = snapshot.logFileName || (snapshot.logFilePath ? path.basename(snapshot.logFilePath) : undefined);
  const logFilePath = snapshot.logFilePath;
  const executionMode = snapshot.executionMode;
  const terminal = ['COMPLETED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(truth.status);

  if (!terminal) {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'UNKNOWN',
      outcome: 'Task running.',
      summary: `Execution is in progress (${truth.status}).`,
      reasonCode: 'UNKNOWN',
      reason: truth.currentOperation || truth.currentStep || 'Run has not reached a terminal FinalTruth state.',
      nextAction: 'Wait for completion or inspect /recovery if the process was interrupted.',
      changedFiles: [...(truth.changeSetFiles ?? [])],
      changedFilesEvidence: (truth.changeSetFiles && truth.changeSetFiles.length > 0) ? 'PROVEN' : 'NOT_APPLICABLE',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  if (truth.status === 'INTERRUPTED') {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'FAILED',
      outcome: 'Task interrupted.',
      summary: truth.reason || 'Execution was interrupted before reaching a terminal state.',
      reasonCode: 'EXECUTION_FAILED',
      reason: truth.reason || 'Interrupted (stale heartbeat or process termination).',
      nextAction: 'Use /recovery to resume or discard the interrupted run.',
      changedFiles: [...(truth.changeSetFiles ?? [])],
      changedFilesEvidence: (truth.changeSetFiles && truth.changeSetFiles.length > 0) ? 'PROVEN' : 'NOT_APPLICABLE',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  if (truth.status === 'COMPLETED') {
    const fromTruth = [...(truth.changeSetFiles ?? [])];
    const extracted = extractChangedFiles(snapshot);
    const changedFiles = fromTruth.length > 0 ? fromTruth : extracted.changedFiles;
    const evidence: ChangedFilesEvidenceKind = changedFiles.length > 0 ? 'PROVEN' : extracted.evidence;
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'SUCCESS',
      outcome: 'Task completed successfully.',
      summary: changedFiles.length > 0
        ? `Task completed successfully. Changed files:\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
        : 'Task completed successfully.',
      reasonCode: 'TASK_COMPLETED',
      reason: truth.reason || 'FinalTruth status is COMPLETED.',
      changedFiles,
      changedFilesEvidence: evidence,
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  if (truth.status === 'BLOCKED') {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary: truth.reason || 'Execution was blocked.',
      reasonCode: 'SCOPE_BLOCKED',
      reason: truth.reason || snapshot.abortReason || 'Blocked by policy or clarification.',
      nextAction: 'Resolve the blocking condition and re-run or resume.',
      changedFiles: [...(truth.changeSetFiles ?? [])],
      changedFilesEvidence: (truth.changeSetFiles && truth.changeSetFiles.length > 0) ? 'PROVEN' : 'NOT_APPLICABLE',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  const extracted = extractChangedFiles(snapshot);
  const changedFiles = (truth.changeSetFiles && truth.changeSetFiles.length > 0)
    ? [...truth.changeSetFiles]
    : extracted.changedFiles;
  const verificationFailed = truth.verificationStatus === 'FAILED' || truth.verificationStatus === 'SKIPPED';
  const failurePrimaryCheck = verificationFailed
    ? (
      snapshot.verification?.checks.find((c) => !c.passed)?.name
      || snapshot.todoVerification?.verdicts.find((v) => v.verdict === 'FAIL')?.todoId
      || snapshot.failure?.primary?.name
      || undefined
    )
    : undefined;
  const reasonCode = truth.mutationStatus === 'FAILED' || truth.mutationStatus === 'ROLLED_BACK'
    ? 'MUTATION_BLOCKED'
    : verificationFailed
      ? 'VERIFICATION_FAILED'
      : 'EXECUTION_FAILED';
  return {
    taskId,
    runId,
    sessionId,
    attemptId,
    status: 'FAILED',
    outcome: 'Task failed.',
    summary: failurePrimaryCheck
      ? `Verification detected that the requested outcome was not satisfied (${failurePrimaryCheck}).`
      : (truth.reason || 'FinalTruth status is FAILED.'),
    reasonCode,
    reason: truth.reason || snapshot.abortReason || snapshot.error || 'Execution failed.',
    failurePrimaryCheck,
    nextAction: verificationFailed
      ? 'Inspect verification tab for failed assertions.'
      : 'Inspect FinalTruth, mutation ledger, and verification evidence.',
    changedFiles,
    changedFilesEvidence: changedFiles.length > 0 ? 'PROVEN' : extracted.evidence,
    logFileName,
    logFilePath,
    executionMode,
  };
}

/**
 * Extracts candidate workspace paths referenced in prompt or error text
 * that do not match the active workspace root.
 */
function extractWorkspaceMismatch(
  prompt: string,
  workspaceRoot: string,
  errorOrAbort?: string,
): { expectedWorkspace?: string; isMismatch: boolean } {
  if (!workspaceRoot) return { isMismatch: false };

  const normActive = path.normalize(workspaceRoot).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');

  // Check if error explicitly mentions workspace mismatch
  const errorHasMismatch = !!(
    errorOrAbort &&
    (errorOrAbort.includes('workspace does not match') ||
      errorOrAbort.includes('outside active workspace') ||
      errorOrAbort.includes('WORKSPACE_MISMATCH'))
  );

  // Match Windows drive paths (e.g. E:\foo\bar or E:/foo/bar) or well-known absolute Unix root paths (/home/..., /Users/..., etc.)
  const winPathRegex = /(?:^|[\s"'`(\[])([A-Za-z]:[\\/][^\s"'`)\],;]+)/g;
  const unixPathRegex = /(?:^|[\s"'`(\[])(\/(?:Users|home|var|tmp|opt|etc|srv|mnt|root|workspace|projects|app)[\\/][^\s"'`)\],;]+)/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = winPathRegex.exec(prompt)) !== null) {
    let candidate = m[1].trim();
    candidate = candidate.replace(/[.,:;!?'")\]]+$/, '');
    if (candidate.length > 3) {
      matches.push(candidate);
    }
  }
  while ((m = unixPathRegex.exec(prompt)) !== null) {
    let candidate = m[1].trim();
    candidate = candidate.replace(/[.,:;!?'")\]]+$/, '');
    if (candidate.length > 3) {
      matches.push(candidate);
    }
  }

  for (const rawCandidate of matches) {
    const normCandidate = path.normalize(rawCandidate).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    // If candidate is a distinct root directory different from active workspace root
    if (
      normCandidate !== normActive &&
      !normCandidate.startsWith(normActive + '/') &&
      (errorHasMismatch ||
        normCandidate.includes('agentic-') ||
        normCandidate.includes('project') ||
        normCandidate.includes('backend') ||
        normCandidate.includes('frontend'))
    ) {
      return { expectedWorkspace: rawCandidate, isMismatch: true };
    }
  }

  if (errorHasMismatch) {
    return { isMismatch: true };
  }

  return { isMismatch: false };
}

/**
 * Extracts and cleans changed files from authoritative workspace / mutation evidence.
 */
function extractChangedFiles(snapshot: TaskRunSnapshot): {
  changedFiles: string[];
  evidence: ChangedFilesEvidenceKind;
} {
  if (snapshot.executionMode === 'READ_ONLY') {
    return { changedFiles: [], evidence: 'NO_CHANGES_PROVEN' };
  }

  // 1. Authoritative R1 workspace comparison
  if (snapshot.workspaceComparison) {
    if (snapshot.workspaceComparison.state === 'PROVEN') {
      const files = [...snapshot.workspaceComparison.actualChangedFiles];
      return {
        changedFiles: files,
        evidence: files.length > 0 ? 'PROVEN' : 'NO_CHANGES_PROVEN',
      };
    }
    if (snapshot.workspaceComparison.state === 'INSUFFICIENT_EVIDENCE') {
      return {
        changedFiles: [],
        evidence: 'INSUFFICIENT_EVIDENCE',
      };
    }
  }

  // 2. Authoritative R1 workspace integrity
  if (snapshot.workspaceIntegrity) {
    const set = new Set<string>([
      ...snapshot.workspaceIntegrity.filesModified,
      ...snapshot.workspaceIntegrity.filesCreated,
    ]);
    const files = Array.from(set);
    return {
      changedFiles: files,
      evidence: files.length > 0 ? 'PROVEN' : 'NO_CHANGES_PROVEN',
    };
  }

  // 3. R2 mutation ledger
  if (snapshot.mutationSafety && snapshot.mutationSafety.mutations.length > 0) {
    const modified = snapshot.mutationSafety.mutations
      .filter((m) => m.changed && !m.rolledBack)
      .map((m) => m.path);
    const set = new Set<string>(modified);
    const files = Array.from(set);
    return {
      changedFiles: files,
      evidence: files.length > 0 ? 'PROVEN' : 'NO_CHANGES_PROVEN',
    };
  }

  // If status is completed but no workspace comparison exists and not read-only
  if (snapshot.status === 'COMPLETED') {
    return { changedFiles: [], evidence: 'NO_CHANGES_PROVEN' };
  }

  return { changedFiles: [], evidence: 'NOT_APPLICABLE' };
}

/**
 * Deterministically constructs a concise, human-readable TaskOutcomeSummary
 * from structured TaskRunSnapshot state (UX-OUTCOME.2).
 */
export function buildTaskOutcomeSummary(snapshot: TaskRunSnapshot): TaskOutcomeSummary {
  const taskId = snapshot.taskId;
  const runId = snapshot.runId || snapshot.taskId;
  const sessionId = snapshot.sessionId;
  const attemptId = snapshot.attemptCount ? `attempt-${snapshot.attemptCount}` : 'attempt-1';
  const logFileName = snapshot.logFileName || (snapshot.logFilePath ? path.basename(snapshot.logFilePath) : undefined);
  const logFilePath = snapshot.logFilePath;
  const executionMode = snapshot.executionMode;
  const activeWorkspace = snapshot.workspaceRoot;

  const rawError = snapshot.error || '';
  const rawAbort = snapshot.abortReason || '';
  const combinedError = `${rawError} ${rawAbort}`.trim();

  // PHASE-09: FinalTruth is the sole terminal authority when present.
  const truthOutcome = summarizeFromFinalTruth(snapshot);
  if (truthOutcome) return truthOutcome;

  // PHASE-09 SM-07: non-terminal legacy statuses are not FAILED.
  // Confirmation/credential pauses still take precedence below.
  if (
    !snapshot.confirmation
    && (
      snapshot.status === 'PLANNING'
      || snapshot.status === 'CONTEXT'
      || snapshot.status === 'EXECUTION'
      || snapshot.status === 'VERIFICATION'
      || snapshot.status === 'ACCEPTANCE'
      || snapshot.status === 'RUNNING'
      || snapshot.status === 'REPAIR'
    )
  ) {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'UNKNOWN',
      outcome: 'Task running.',
      summary: `Execution is in progress (${snapshot.status}).`,
      reasonCode: 'UNKNOWN',
      reason: 'Run has not reached a terminal state.',
      changedFiles: [],
      changedFilesEvidence: 'NOT_APPLICABLE',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 1. CANCELLED Check
  if (
    snapshot.status === 'BLOCKED' &&
    (rawAbort.toLowerCase().includes('cancel') || rawError.toLowerCase().includes('cancel'))
  ) {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'CANCELLED',
      outcome: 'Task cancelled.',
      summary: 'Task execution was cancelled by the operator.',
      reasonCode: 'CANCELLED',
      reason: rawAbort || rawError || 'Execution was stopped by operator request.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 2. CONFIRMATION / CREDENTIAL PAUSED Check
  if (snapshot.confirmation) {
    if (snapshot.confirmation.status === 'PENDING') {
      if (
        snapshot.confirmation.type === 'REQUIRES_TEST_CREDENTIAL' ||
        snapshot.confirmation.credentialRequirement
      ) {
        return {
          taskId,
          runId,
          sessionId,
          attemptId,
          status: 'PAUSED',
          outcome: 'Task paused.',
          summary: 'A test credential is required before this operation can continue.',
          reasonCode: 'CREDENTIAL_REQUIRED',
          reason: snapshot.confirmation.reason || 'Test credential required for admin verification.',
          nextAction: 'Provide the test credential via the Web Operator UI or REPL to resume execution.',
          changedFiles: [],
          changedFilesEvidence: 'NOT_APPLICABLE',
          logFileName,
          logFilePath,
          executionMode,
        };
      }
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'PAUSED',
        outcome: 'Task paused.',
        summary: 'Human confirmation is required before this operation can continue.',
        reasonCode: 'CONFIRMATION_REQUIRED',
        reason: snapshot.confirmation.reason || 'Human confirmation requested for high-risk operation.',
        nextAction: 'Review and approve or reject the confirmation request.',
        changedFiles: [],
        changedFilesEvidence: 'NOT_APPLICABLE',
        logFileName,
        logFilePath,
        executionMode,
      };
    }
    if (
      snapshot.confirmation.status === 'REJECTED' ||
      rawAbort.includes('CONFIRMATION_REJECTED')
    ) {
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'REJECTED',
        outcome: 'Task rejected.',
        summary: 'The requested operation was rejected by the operator.',
        reasonCode: 'CONFIRMATION_REJECTED',
        reason: snapshot.confirmation.reason || 'Operator rejected the confirmation request.',
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }
  }

  // 3. WORKSPACE MISMATCH & TARGET NOT FOUND Check
  const mismatchInfo = extractWorkspaceMismatch(snapshot.task, activeWorkspace, combinedError);
  if (mismatchInfo.isMismatch) {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary: 'The requested workspace does not match the active workspace.',
      reasonCode: 'WORKSPACE_MISMATCH',
      reason: 'The requested workspace does not match the active workspace.',
      expectedWorkspace: mismatchInfo.expectedWorkspace,
      activeWorkspace,
      nextAction: 'Run the command from within the target workspace directory.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 3a-pre. INTERNAL_VALIDATION runs have no planner, so the validator message
  // is propagated verbatim rather than reconstructed as a planner failure.
  if (executionMode === 'INTERNAL_VALIDATION' && combinedError.includes('PLANNER_UNGROUNDED_TARGET')) {
    const raw = rawError || rawAbort || '';
    const summary = raw.replace(/^\s*PLANNER_UNGROUNDED_TARGET:\s*/i, '').trim()
      || 'Validation target is not authorized by declared authority.';
    const listed = summary.match(/declared authority:\s*(.+)$/i);
    const rejectedTargets = Object.freeze(
      listed ? sanitizeRejectedTargets(listed[1].split(',').map(f => f.trim()).filter(Boolean)) : [],
    );
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary,
      reasonCode: 'PLANNER_UNGROUNDED_TARGET',
      reason: summary,
      details: Object.freeze({ rejectedTargets }),
      rejectedTargets,
      activeWorkspace,
      nextAction: 'Declare the target in the validation authority, or remove it from the validated execution targets.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 3a. PLANNER UNGROUNDED TARGET Check
  if (
    combinedError.includes('PLANNER_UNGROUNDED_TARGET') ||
    combinedError.includes('not grounded in workspace evidence') ||
    combinedError.includes('Ungrounded target')
  ) {
    const raw = rawError || rawAbort || '';
    let details: string[] = [];
    const match = raw.match(/not grounded in workspace evidence:\s*(.+)$/i);
    if (match) {
      details = match[1].split(',').map((f: string) => f.trim()).filter(Boolean);
    } else {
      const targetMatches = raw.match(/Ungrounded target "([^"]+)"/g);
      if (targetMatches) {
        details = targetMatches.map(tm => {
          const m = tm.match(/Ungrounded target "([^"]+)"/);
          return m ? m[1] : tm;
        });
      }
    }
    const sanitized = sanitizeRejectedTargets(details);
    const rejectedTargets = Object.freeze([...sanitized]);
    const summary = 'Planner referenced files not grounded in workspace evidence';
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary,
      reasonCode: 'PLANNER_UNGROUNDED_TARGET',
      reason: rejectedTargets.length > 0 ? `${summary}: ${rejectedTargets.join(', ')}` : summary,
      details: Object.freeze({ rejectedTargets }),
      rejectedTargets,
      activeWorkspace,
      nextAction: 'Verify target files exist or provide grounded workspace evidence before planning.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  if (
    combinedError.includes('TARGET_NOT_FOUND') ||
    combinedError.includes('not found in the active workspace') ||
    (combinedError.includes('EvidenceBuilder') && combinedError.includes('confirmed=0'))
  ) {
    const raw = rawError || rawAbort || '';
    const match = raw.match(/The requested file\s+"([^"]+)"\s+was not found in the active workspace/i);
    const targetFile = match ? match[1] : undefined;
    const summary = targetFile
      ? `The requested file "${targetFile}" was not found in the active workspace.`
      : 'Target file was not found in the active workspace.';
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary,
      reasonCode: 'TARGET_NOT_FOUND',
      reason: summary,
      activeWorkspace,
      nextAction: 'Verify target file exists in the active workspace before running.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 3b. CLARIFICATION REQUIRED Check
  if (
    combinedError.includes('clarification') ||
    combinedError.includes('Clarification') ||
    combinedError.includes('blocking question')
  ) {
    const sanitized = sanitizeReason(rawError || rawAbort || 'Requires clarification before execution.');
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary: sanitized || 'Clarification required before execution.',
      reasonCode: 'CLARIFICATION_REQUIRED',
      reason: sanitized,
      nextAction: 'Provide the required details in your prompt or answer clarification questions.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 4. HARD SAFETY / SCOPE BLOCKED Check
  if (
    snapshot.status === 'BLOCKED' ||
    combinedError.includes('scope restriction') ||
    combinedError.includes('MutationGuard') ||
    combinedError.includes('ExecutionGate')
  ) {
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'BLOCKED',
      outcome: 'Task blocked.',
      summary: 'Execution was blocked by workspace integrity or mutation security policy.',
      reasonCode: 'SCOPE_BLOCKED',
      reason: rawAbort || rawError || 'Operation attempted actions outside permitted scope.',
      nextAction: 'Adjust task scope or verify workspace permissions.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 5. MUTATION FAILURE Check
  if (
    snapshot.mutationSafety &&
    (snapshot.mutationSafety.rejectedMutations > 0 || snapshot.mutationSafety.rolledBackMutations > 0)
  ) {
    const rolledBack = snapshot.mutationSafety.rolledBackMutations > 0;
    const { changedFiles, evidence } = extractChangedFiles(snapshot);
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'FAILED',
      outcome: 'Task failed.',
      summary: rolledBack
        ? 'A file mutation failed safety checks and was automatically rolled back.'
        : 'A file mutation was rejected by the mutation safety policy.',
      reasonCode: rolledBack ? 'MUTATION_ROLLED_BACK' : 'MUTATION_BLOCKED',
      reason: 'A file mutation was rejected by the mutation safety policy.',
      nextAction: 'Inspect the mutation tab for detailed diff and policy rules.',
      changedFiles,
      changedFilesEvidence: evidence,
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 6. VERIFICATION FAILURE Check
  const isVerificationFailed =
    (snapshot.verification !== undefined && !snapshot.verification.passed) ||
    (snapshot.todoVerification !== undefined && snapshot.todoVerification.todosFailed > 0);

  if (isVerificationFailed) {
    const primaryFailedCheck =
      snapshot.verification?.checks.find((c) => !c.passed)?.name ||
      snapshot.todoVerification?.verdicts.find((v) => v.verdict === 'FAIL')?.todoId ||
      snapshot.failure?.primary?.name ||
      'deterministic-checks';

    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'FAILED',
      outcome: 'Task failed.',
      summary: `Verification detected that the requested outcome was not satisfied (${primaryFailedCheck}).`,
      reasonCode: 'VERIFICATION_FAILED',
      reason: 'Verification detected that the requested outcome was not satisfied.',
      failurePrimaryCheck: primaryFailedCheck,
      nextAction: 'Inspect verification tab for failed assertions.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 7. REPAIR FAILURE / REPAIR LIMIT Check
  if (snapshot.repair) {
    const attemptsCount = snapshot.repair.attempts.length;
    const maxAttempts = snapshot.repair.limits?.maxRepairAttempts ?? 2;
    if (
      snapshot.repair.outcome === 'REPAIR_LIMIT_REACHED' ||
      (attemptsCount >= maxAttempts && snapshot.status === 'FAILED')
    ) {
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'Repair stopped after reaching the configured retry limit without a verified solution.',
        reasonCode: 'REPAIR_LIMIT_REACHED',
        reason: 'Repair reached the configured attempt limit without a verified solution.',
        nextAction: 'Review failed verification checks and adjust task constraints.',
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }
    if (snapshot.status === 'FAILED' && attemptsCount > 0) {
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'The initial attempt failed and bounded repair did not reach a verified solution.',
        reasonCode: 'REPAIR_FAILED',
        reason: 'The initial attempt failed and bounded repair did not reach a verified solution.',
        nextAction: 'Inspect repair tab for attempt history and failure contract.',
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }
  }

  // 8. VALIDATION / PROVIDER / PLANNER FAILURES
  if (snapshot.status === 'FAILED') {
    if (combinedError.includes('VALIDATION_ERROR')) {
      const sanitized = sanitizeReason(rawError || rawAbort || 'Invalid prompt or arguments.');
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'Command validation failed.',
        reasonCode: 'VALIDATION_FAILED',
        reason: sanitized,
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    if (
      combinedError.includes('Model not found') ||
      combinedError.includes('Failed to connect to Ollama') ||
      combinedError.includes('Provider error') ||
      combinedError.includes('ECONNREFUSED') ||
      combinedError.includes('Ollama API error') ||
      combinedError.includes('usage limit') ||
      combinedError.includes('rate limit') ||
      combinedError.includes('429') ||
      combinedError.includes('402')
    ) {
      const sanitized = sanitizeReason(rawError || rawAbort || 'Provider error during model invocation.');
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'LLM provider connection or model resolution error.',
        reasonCode: 'PROVIDER_FAILURE',
        reason: sanitized,
        nextAction: 'Ensure local Ollama instance is running with the required model available.',
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    if (
      combinedError.includes('planner') ||
      combinedError.includes('Planning failed') ||
      combinedError.includes('PLANNER_OUTPUT_REJECTED') ||
      combinedError.includes('PlannerOutputRejectedError') ||
      combinedError.includes('Planner returned null plan') ||
      combinedError.includes('Task planner')
    ) {
      const sanitized = sanitizeReason(
        rawAbort || rawError || 'Task planner could not decompose the task into valid execution steps.',
      );
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'Task planner was unable to generate a valid execution plan.',
        reasonCode: 'PLANNER_FAILED',
        reason: sanitized,
        nextAction: 'Refine the prompt with specific target files or constraints.',
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    if (
      combinedError.includes('validation') ||
      combinedError.includes('Validation')
    ) {
      const sanitized = sanitizeReason(rawError || rawAbort || 'Invalid prompt or arguments.');
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'FAILED',
        outcome: 'Task failed.',
        summary: 'Command validation failed.',
        reasonCode: 'VALIDATION_FAILED',
        reason: sanitized,
        changedFiles: [],
        changedFilesEvidence: 'NO_CHANGES_PROVEN',
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    const sanitized = sanitizeReason(rawError || rawAbort || 'The execution ended with an unclassified failure.');
    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'FAILED',
      outcome: 'Task failed.',
      summary: sanitized || 'The system could not determine the exact failure cause.',
      reasonCode: 'UNKNOWN',
      reason: sanitized,
      nextAction: 'Inspect pipeline logs and run timeline for details.',
      changedFiles: [],
      changedFilesEvidence: 'NO_CHANGES_PROVEN',
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // 9. SUCCESS / SUCCESS AFTER REPAIR Check
  if (snapshot.status === 'COMPLETED') {
    const { changedFiles, evidence } = extractChangedFiles(snapshot);
    const wasRepaired =
      (snapshot.repair?.attempts && snapshot.repair.attempts.length > 1) ||
      (snapshot.attemptCount && snapshot.attemptCount > 1);

    if (wasRepaired) {
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'SUCCESS_AFTER_REPAIR',
        outcome: 'Task completed successfully after repair.',
        summary:
          changedFiles.length > 0
            ? `Task completed successfully after repair. Changed files:\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
            : 'Task completed successfully after repair. No files were changed.',
        reasonCode: 'TASK_COMPLETED_AFTER_REPAIR',
        reason: 'All planned steps and verification checks completed successfully after automated repair.',
        changedFiles,
        changedFilesEvidence: evidence,
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    if (evidence === 'INSUFFICIENT_EVIDENCE') {
      return {
        taskId,
        runId,
        sessionId,
        attemptId,
        status: 'SUCCESS_WITH_INSUFFICIENT_EVIDENCE',
        outcome: 'Task completed, but verification evidence is incomplete.',
        summary: 'Task completed, but workspace evidence could not definitively prove changed files.',
        reasonCode: 'INSUFFICIENT_EVIDENCE',
        reason: 'Some required workspace integrity checks could not be established.',
        changedFiles,
        changedFilesEvidence: evidence,
        logFileName,
        logFilePath,
        executionMode,
      };
    }

    return {
      taskId,
      runId,
      sessionId,
      attemptId,
      status: 'SUCCESS',
      outcome: 'Task completed successfully.',
      summary:
        changedFiles.length > 0
          ? `Task completed successfully. Changed files:\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
          : 'Task completed successfully. No files were changed.',
      reasonCode: 'TASK_COMPLETED',
      reason: 'All planned steps and verification checks completed successfully.',
      changedFiles,
      changedFilesEvidence: evidence,
      logFileName,
      logFilePath,
      executionMode,
    };
  }

  // Fallback
  return {
    taskId,
    runId,
    sessionId,
    attemptId,
    status: 'UNKNOWN',
    outcome: 'Task status unknown.',
    summary: 'Task execution finished with an unclassified outcome state.',
    reasonCode: 'UNKNOWN',
    reason: 'The system could not determine the exact outcome state.',
    changedFiles: [],
    changedFilesEvidence: 'NOT_APPLICABLE',
    logFileName,
    logFilePath,
    executionMode,
  };
}
