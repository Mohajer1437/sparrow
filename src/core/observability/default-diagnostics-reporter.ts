import { DiagnosticsReporter } from '../../contracts/diagnostics-reporter';
import {
  ExecutionDiagnostics,
  ExecutionTelemetry,
  DiagnosticOutcome,
} from '../../domain/execution-telemetry';

export class DefaultDiagnosticsReporter implements DiagnosticsReporter {
  generate(telemetry: ExecutionTelemetry): ExecutionDiagnostics {
    const outcome = this.determineOutcome(telemetry);
    const warnings = this.collectWarnings(telemetry);
    const failures = this.collectFailures(telemetry);
    const reason = this.determineReason(telemetry, outcome);

    return Object.freeze({
      executionId: telemetry.executionId,
      outcome,
      reason,
      timeline: telemetry.timeline,
      metrics: telemetry.metrics,
      warnings: Object.freeze(warnings),
      failures: Object.freeze(failures),
      generatedAt: new Date().toISOString(),
    });
  }

  format(report: ExecutionDiagnostics): string {
    const lines: string[] = [];
    lines.push('═'.repeat(60));
    lines.push('EXECUTION DIAGNOSTICS');
    lines.push('═'.repeat(60));
    lines.push('');
    lines.push(`Execution: ${report.executionId}`);
    lines.push(`Outcome:   ${report.outcome.toUpperCase()}`);
    if (report.reason) {
      lines.push(`Reason:    ${report.reason}`);
    }
    lines.push('');
    lines.push('Performance:');
    lines.push(`  Total Duration:     ${report.metrics.totalDurationMs}ms`);
    lines.push(`  Steps:              ${report.metrics.stepCount}`);
    lines.push(`  Successful:         ${report.metrics.successfulSteps}`);
    lines.push(`  Failed:             ${report.metrics.failedSteps}`);
    lines.push(`  Avg Step Duration:  ${report.metrics.averageStepDurationMs}ms`);
    lines.push(`  Governor Pauses:    ${report.metrics.governorPauseCount}`);
    lines.push(`  Retries:            ${report.metrics.retryCount}`);
    lines.push('');

    if (report.timeline.length > 0) {
      lines.push('Timeline:');
      for (const event of report.timeline) {
        const duration = event.durationMs !== undefined ? ` (${event.durationMs}ms)` : '';
        lines.push(`  [${event.timestamp}] ${event.type}${duration}`);
      }
      lines.push('');
    }

    if (report.warnings.length > 0) {
      lines.push('Warnings:');
      for (const w of report.warnings) {
        lines.push(`  ⚠ ${w}`);
      }
      lines.push('');
    }

    if (report.failures.length > 0) {
      lines.push('Failures:');
      for (const f of report.failures) {
        lines.push(`  ✗ ${f}`);
      }
      lines.push('');
    }

    lines.push('═'.repeat(60));
    return lines.join('\n');
  }

  private determineOutcome(telemetry: ExecutionTelemetry): DiagnosticOutcome {
    const hasFailures = telemetry.metrics.failedSteps > 0;
    const hasSuccess = telemetry.metrics.successfulSteps > 0;
    const wasPaused = telemetry.timeline.some(e => e.type === 'GOVERNOR_PAUSED');
    const wasAborted = telemetry.timeline.some(e => e.type === 'WORKFLOW_FAILED');

    if (wasAborted && !hasSuccess) return 'aborted';
    if (wasAborted && hasSuccess) return 'partially_completed';
    if (wasPaused && !telemetry.timeline.some(e => e.type === 'GOVERNOR_RESUMED')) return 'paused';
    if (hasFailures && hasSuccess) return 'partially_completed';
    if (hasFailures && !hasSuccess) return 'failed';
    return 'succeeded';
  }

  private determineReason(telemetry: ExecutionTelemetry, outcome: DiagnosticOutcome): string | undefined {
    if (outcome === 'succeeded') return undefined;
    const failedStep = telemetry.steps.find(s => !s.success);
    if (failedStep?.error) return failedStep.error;
    const failEvent = telemetry.timeline.find(e => e.type === 'WORKFLOW_FAILED');
    if (failEvent?.metadata?.reason) return failEvent.metadata.reason;
    return `Execution ${outcome}`;
  }

  private collectWarnings(telemetry: ExecutionTelemetry): string[] {
    const warnings: string[] = [];
    if (telemetry.metrics.governorPauseCount > 0) {
      warnings.push(`Execution paused ${telemetry.metrics.governorPauseCount} time(s) by governor`);
    }
    if (telemetry.metrics.retryCount > 0) {
      warnings.push(`${telemetry.metrics.retryCount} retry(ies) occurred`);
    }
    if (telemetry.metrics.averageStepDurationMs > 10000) {
      warnings.push(`Average step duration is high: ${telemetry.metrics.averageStepDurationMs}ms`);
    }
    return warnings;
  }

  private collectFailures(telemetry: ExecutionTelemetry): string[] {
    return telemetry.steps
      .filter(s => !s.success && s.error)
      .map(s => `Step ${s.stepId}: ${s.error}`);
  }
}
