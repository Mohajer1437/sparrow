/**
 * Planner file reference categories.
 *
 * The planner may name a file for three different reasons, and only one of
 * them is an execution boundary:
 *
 * - EXECUTION_TARGET: the agent may read/modify it. Must be grounded in
 *   PlannerAllowedTargets.
 * - CONTEXT_REFERENCE: visible through PlannerContext for reasoning only.
 *   Never executed, never mutated, never grounded against allowed targets.
 * - METADATA_REFERENCE: project documentation and descriptors (`.ai/*`),
 *   which describe the project rather than participate in execution.
 */

export const PLANNER_FILE_CATEGORIES = [
  'EXECUTION_TARGET',
  'CONTEXT_REFERENCE',
  'METADATA_REFERENCE',
] as const;

export type PlannerFileCategory = (typeof PLANNER_FILE_CATEGORIES)[number];

export interface PlannerFileReference {
  readonly path: string;
  readonly category: PlannerFileCategory;
}

export function isPlannerFileCategory(value: unknown): value is PlannerFileCategory {
  return typeof value === 'string' && (PLANNER_FILE_CATEGORIES as ReadonlyArray<string>).includes(value);
}

function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * `.ai/` holds Sparrow's own project descriptors. They inform planning and are
 * never execution targets, so they must not be grounded as one.
 */
export function isMetadataReferencePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  const normalized = normalize(path);
  return normalized === '.ai' || normalized.startsWith('.ai/');
}

export function classifyPlannerFileReference(
  path: string,
  declared?: PlannerFileCategory,
): PlannerFileReference {
  const normalized = normalize(path);
  if (declared === 'CONTEXT_REFERENCE') {
    return Object.freeze({ path: normalized, category: 'CONTEXT_REFERENCE' as const });
  }
  if (declared === 'METADATA_REFERENCE' || isMetadataReferencePath(normalized)) {
    return Object.freeze({ path: normalized, category: 'METADATA_REFERENCE' as const });
  }
  return Object.freeze({ path: normalized, category: 'EXECUTION_TARGET' as const });
}

export interface PartitionedPlannerFiles {
  readonly executionTargets: ReadonlyArray<string>;
  readonly metadataReferences: ReadonlyArray<string>;
}

/**
 * Splits a declared file list into execution targets and metadata references.
 * Only the execution targets are subject to grounding enforcement.
 */
export function partitionDeclaredFiles(paths: ReadonlyArray<string>): PartitionedPlannerFiles {
  const executionTargets: string[] = [];
  const metadataReferences: string[] = [];
  for (const raw of paths) {
    if (!raw || typeof raw !== 'string') continue;
    const reference = classifyPlannerFileReference(raw);
    if (reference.category === 'METADATA_REFERENCE') {
      if (!metadataReferences.includes(reference.path)) metadataReferences.push(reference.path);
    } else if (!executionTargets.includes(reference.path)) {
      executionTargets.push(reference.path);
    }
  }
  return Object.freeze({
    executionTargets: Object.freeze(executionTargets),
    metadataReferences: Object.freeze(metadataReferences),
  });
}
