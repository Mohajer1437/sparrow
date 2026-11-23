import { ReflectionEngine } from '../../contracts/reflection-engine';
import { WorkspaceSession } from '../../domain/workspace-session';
import { Reflection } from '../../domain/reflection';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultReflectionEngine implements ReflectionEngine {
  generate(session: WorkspaceSession): Reflection {
    const toolsUsed = new Set<string>();
    let verificationExecuted = false;
    let verificationPassed = false;
    let rollbackPerformed = false;

    let toolFailureCount = 0;
    let toolSuccessCount = 0;
    for (const event of session.events) {
      if (event.type === 'TOOL_EXECUTED') {
        if (event.metadata?.toolName) {
          toolsUsed.add(event.metadata.toolName as string);
        }
        const success = event.metadata?.success;
        if (success === true) {
          toolSuccessCount++;
        } else if (success === false) {
          toolFailureCount++;
        }
      }
      if (
        event.type === 'VALIDATION_STARTED' ||
        event.type === 'TESTS_STARTED' ||
        event.type === 'VERIFICATION_STARTED' ||
        event.type === 'VERIFICATION_COMPLETED' ||
        event.type === 'VERIFICATION_FAILED'
      ) {
        verificationExecuted = true;
      }
      if (
        event.type === 'VALIDATION_PASSED' ||
        event.type === 'TESTS_PASSED' ||
        event.type === 'VERIFICATION_COMPLETED'
      ) {
        verificationPassed = true;
      }
      if (event.type === 'ROLLBACK_COMPLETED') {
        rollbackPerformed = true;
      }
    }

    const retriesRequired = session.retryHistory ? session.retryHistory.length : 0;
    const modifiedFiles = session.modifiedFiles ?? [];

    // A.3: Strict reflection — count all step events
    const stepStarted = session.events.filter(e => e.type === 'STEP_STARTED').length;
    const stepCompleted = session.events.filter(e => e.type === 'STEP_COMPLETED').length;
    const stepFailed = session.events.filter(e => e.type === 'STEP_FAILED').length;
    const totalSteps = session.totalSteps || stepStarted || 1;

    // A.3: Unfold directory entries to actual files
    const modifiedFilesUnfolded = this.unfoldModifiedFiles(session.modifiedFiles ?? []);

    const totalToolCalls = toolSuccessCount + toolFailureCount;
    const toolFailureRate = totalToolCalls > 0 ? toolFailureCount / totalToolCalls : 0;
    const hasSignificantToolFailures = toolFailureCount >= 2 && toolFailureRate >= 0.1;
    
    let executionOutcome: Reflection['executionOutcome'];
    if (session.status === 'rolled_back') {
      executionOutcome = 'rolled_back';
    } else if (session.status === 'paused') {
      executionOutcome = 'paused';
    } else if (session.status === 'failed') {
      executionOutcome = 'failed';
    } else if (stepFailed > 0 && stepCompleted < totalSteps) {
      executionOutcome = 'partial_failure';
    } else if (session.status === 'completed' && stepFailed === 0 && stepCompleted >= totalSteps) {
      executionOutcome = hasSignificantToolFailures ? 'partial_failure' : 'success';
    } else if (session.status === 'completed') {
      executionOutcome = (stepFailed > 0 || hasSignificantToolFailures) ? 'partial_failure' : 'success';
    } else {
      executionOutcome = 'failed';
    }

    const summary = this.buildSummary(session, executionOutcome, toolsUsed.size, verificationExecuted, rollbackPerformed, retriesRequired, modifiedFilesUnfolded, stepFailed, stepStarted, totalSteps, toolFailureCount, toolSuccessCount);
    ExecutionLogger.log('REFLECTION', '-', '-', `Reflection generated: ${executionOutcome}`, {
      toolsUsed: toolsUsed.size,
      filesModified: modifiedFiles.length,
      verificationExecuted,
      rollbackPerformed,
      retriesRequired,
      toolFailureCount,
      toolSuccessCount,
    });

    return {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      taskAttempted: session.task,
      executionOutcome,
      stepsCompleted: session.currentStep,
      totalSteps: session.totalSteps,
      stepsStarted: stepStarted,
      stepFailureCount: stepFailed,
      toolsUsed: Array.from(toolsUsed),
      filesModified: modifiedFilesUnfolded,
      verificationExecuted,
      verificationPassed,
      retriesRequired,
      rollbackPerformed,
      toolFailureCount,
      toolSuccessCount,
      summary,
    };
  }

  private buildSummary(
    session: WorkspaceSession,
    outcome: string,
    toolCount: number,
    verified: boolean,
    rolledBack: boolean,
    retries: number,
    modifiedFiles: ReadonlyArray<string>,
    stepFailures: number,
    stepsStarted: number,
    totalSteps: number,
    toolFailureCount: number = 0,
    toolSuccessCount: number = 0
  ): string {
    const parts: string[] = [];
    parts.push(`Task: "${session.task}"`);
    parts.push(`Outcome: ${outcome}.`);
    parts.push(`Steps: ${session.currentStep}/${totalSteps} (started: ${stepsStarted}, failed: ${stepFailures}).`);
    if (toolCount > 0) parts.push(`Tools used: ${toolCount}.`);
    if (toolFailureCount > 0) parts.push(`Tool failures: ${toolFailureCount}/${toolFailureCount + toolSuccessCount}.`);
    if (modifiedFiles.length > 0) parts.push(`Files modified: ${modifiedFiles.length}.`);
    if (verified) parts.push(`Verification: executed.`);
    if (rolledBack) parts.push(`Rollback: performed.`);
    if (retries > 0) parts.push(`Retries: ${retries}.`);
    return parts.join(' ');
  }
/**
   * A.3: Unfold directory entries into actual files inside them.
   * Falls back to original list if fs access fails.
   */
  private unfoldModifiedFiles(files: ReadonlyArray<string>): ReadonlyArray<string> {
    const result: string[] = [];
    for (const entry of files) {
      if (typeof entry !== 'string') { result.push(String(entry)); continue; }
      if (entry.endsWith('/') || entry.endsWith('\\')) {
        try {
          const fs = require('fs');
          const pathMod = require('path');
          const absPath = pathMod.isAbsolute(entry) ? entry : pathMod.resolve(entry);
          if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
            const entries = fs.readdirSync(absPath, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile()) result.push(pathMod.join(entry, e.name));
            }
            continue;
          }
        } catch { /* fall through */ }
      }
      result.push(entry);
    }
    return Object.freeze(result);
  }
}
