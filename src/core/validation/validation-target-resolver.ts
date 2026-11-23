import { PlannerAllowedTargets, createPlannerAllowedTargets } from '../../domain/planner-allowed-targets';
import { InternalValidationRequest } from '../../domain/internal-validation';

export interface ResolvedValidationTargets {
  /** Execution targets the validated input declares, in declaration order. */
  readonly declaredTargets: ReadonlyArray<string>;
  /** Reasoning-only references the validated input declares. */
  readonly declaredReferences: ReadonlyArray<string>;
  readonly authority: PlannerAllowedTargets;
}

function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function toPathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = normalize(entry);
    if (normalized.length > 0 && !paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

/**
 * Extracts the execution targets, reasoning references and authority from an
 * internal validation request without normalizing or repairing the input. What
 * the caller declared as an execution target stays an execution target.
 */
export function resolveValidationTargets(request: InternalValidationRequest): ResolvedValidationTargets {
  const input = (request.input ?? {}) as Record<string, unknown>;

  const declaredTargets: string[] = [];
  for (const path of [...toPathList(input.files), ...toPathList(input.affectedFiles)]) {
    if (!declaredTargets.includes(path)) declaredTargets.push(path);
  }

  const declaredReferences: string[] = [];
  for (const path of [
    ...toPathList(input.contextReferences),
    ...toPathList(input.contextFiles),
    ...toPathList(input.references),
    ...toPathList(input.metadataReferences),
    ...toPathList(input.documentationFiles),
  ]) {
    if (!declaredReferences.includes(path)) declaredReferences.push(path);
  }

  // Authority may be declared alongside the input payload or inside it. A
  // top-level declaration wins so a payload cannot widen its own authority.
  const authority = createPlannerAllowedTargets({
    verifiedFiles: request.authority !== undefined
      ? toPathList(request.authority)
      : toPathList(input.authority),
  });

  return Object.freeze({
    declaredTargets: Object.freeze(declaredTargets),
    declaredReferences: Object.freeze(declaredReferences),
    authority,
  });
}

/** Context paths supplied to a validation run, for visibility assertions only. */
export function resolveVisibleContext(request: InternalValidationRequest): ReadonlyArray<string> {
  return Object.freeze(toPathList(request.context));
}
