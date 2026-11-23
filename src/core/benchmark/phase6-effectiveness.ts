/**
 * Phase 6 Milestone 1 — shared task definitions and one-line validation.
 * Used by the effectiveness harness and unit tests. Not part of Knowledge hot path.
 */

export type KnowledgeConsumptionMode = 'on' | 'off';

/** Milestone 1 Task A — must remain exactly one physical line. */
export const PHASE6_TASK_A =
  'Add a short JSX comment marker K6A near the top of components/TaskCard.tsx without changing behavior, using only TaskCard and its direct imports, then stop.';

export const PHASE6_TASKS: Readonly<Record<string, string>> = Object.freeze({
  A: PHASE6_TASK_A,
});

/**
 * Reject multiline benchmark prompts before execution.
 * Does not strip or normalize — fails closed so the task text cannot change silently.
 */
export function assertOneLineTask(task: string): void {
  if (typeof task !== 'string' || task.length === 0) {
    throw new Error('INVALID_INPUT: benchmark task must be a non-empty string');
  }
  if (task.includes('\n') || task.includes('\r')) {
    throw new Error(
      'INVALID_INPUT: benchmark task must be one physical line (no \\n or \\r). '
      + 'Interactive CLI Enter/newline handling is out of scope for Phase 6; use one-line tasks.',
    );
  }
}
