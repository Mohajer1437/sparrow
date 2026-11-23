import { ExecutionDiagnostics, ExecutionTelemetry } from '../domain/execution-telemetry';

/**
 * DiagnosticsReporter generates structured diagnostics from telemetry.
 *
 * Output is deterministic and suitable for CLI output and future UI.
 */
export interface DiagnosticsReporter {
  generate(telemetry: ExecutionTelemetry): ExecutionDiagnostics;
  format(report: ExecutionDiagnostics): string;
}
