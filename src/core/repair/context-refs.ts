/**
 * R3.8/R3.9: read what a planner context actually held, as (path, fingerprint)
 * pairs, so two attempts can be compared by content rather than by file count.
 */

import { PlannerContext } from '../../domain/planner-context';
import { ContextRef, normalizeContextPath } from '../../domain/repair/context-expansion';

/** Statuses that mean the planner really received the file's content. */
const PRESENT_STATUSES = Object.freeze(['COLLECTED', 'AVAILABLE']);

export function contextRefsFromPlannerContext(
  context: PlannerContext | undefined,
): ReadonlyArray<ContextRef> {
  if (!context?.gathered?.records) return Object.freeze([]);
  const refs = new Map<string, string>();
  for (const record of context.gathered.records) {
    if (!PRESENT_STATUSES.includes(record.status)) continue;
    const fingerprint = record.metadata?.fingerprint;
    if (!fingerprint) continue;
    const path = normalizeContextPath(record.reference);
    if (!path || path === '(none)') continue;
    refs.set(path, fingerprint);
  }
  return Object.freeze(
    [...refs.entries()]
      .map(([path, fingerprint]) => Object.freeze({ path, fingerprint }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}
