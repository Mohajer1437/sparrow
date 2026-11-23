import { Workspace } from '../../contracts/workspace';
import { resolveWorkspacePath, WorkspacePathError, toPosixRelative } from './workspace-paths';
import { TodoPlan } from '../../domain/todo-plan';
import { ExecutionPlan } from '../../domain/execution-plan';
import { sanitizeRejectedTargets } from '../../domain/planner-allowed-targets';
import { isMetadataReferencePath } from '../../domain/planner-file-reference';

export type GroundedTargetKind =
  | 'VERIFIED_FILE'
  | 'VERIFIED_DIRECTORY'
  | 'MISSING'
  | 'OUT_OF_SCOPE'
  | 'UNKNOWN';

export interface GroundedTargetPath {
  readonly rawPath: string;
  readonly normalizedPath: string;
  readonly kind: GroundedTargetKind;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly error?: string;
}

export interface TodoPlanGroundingValidationResult {
  readonly valid: boolean;
  readonly groundedTargets: ReadonlyArray<GroundedTargetPath>;
  readonly verifiedFiles: ReadonlyArray<string>;
  readonly verifiedDirectories: ReadonlyArray<string>;
  readonly missingRequestedFiles: ReadonlyArray<string>;
  readonly ungroundedFiles: ReadonlyArray<string>;
  readonly error?: string;
  readonly reasonCode?: 'PLANNER_UNGROUNDED_TARGET' | 'TARGET_NOT_FOUND';
}

/**
 * Deterministically ground a target path against the active workspace.
 *
 * Rules:
 * 1. Normalize the path against workspace root.
 * 2. Reject path traversal (OUT_OF_SCOPE).
 * 3. Verify existence against filesystem.
 * 4. Verify whether it is a file or a directory.
 * 5. Never use similarity or nearest-file heuristics.
 */
export async function groundTargetPath(
  workspace: Workspace,
  rawPath: string,
  workspaceRoot?: string,
): Promise<GroundedTargetPath> {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return Object.freeze({
      rawPath: String(rawPath ?? ''),
      normalizedPath: '',
      kind: 'UNKNOWN' as const,
      exists: false,
      isDirectory: false,
      isFile: false,
      error: 'Path is empty',
    });
  }

  const trimmed = rawPath.trim();

  // Check for traversal
  let normalizedPath = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  if (workspaceRoot) {
    try {
      const resolved = resolveWorkspacePath(workspaceRoot, trimmed);
      normalizedPath = resolved.relative;
    } catch (err: any) {
      if (err instanceof WorkspacePathError && err.code === 'TRAVERSAL') {
        return Object.freeze({
          rawPath: trimmed,
          normalizedPath,
          kind: 'OUT_OF_SCOPE' as const,
          exists: false,
          isDirectory: false,
          isFile: false,
          error: 'Path traversal detected: cannot escape workspace root',
        });
      }
    }
  }

  if (
    normalizedPath.startsWith('../') ||
    normalizedPath.includes('/../') ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('/') && !workspaceRoot
  ) {
    return Object.freeze({
      rawPath: trimmed,
      normalizedPath,
      kind: 'OUT_OF_SCOPE' as const,
      exists: false,
      isDirectory: false,
      isFile: false,
      error: 'Path traversal detected',
    });
  }

  try {
    const exists = await workspace.exists(normalizedPath);
    if (!exists) {
      return Object.freeze({
        rawPath: trimmed,
        normalizedPath,
        kind: 'MISSING' as const,
        exists: false,
        isDirectory: false,
        isFile: false,
      });
    }

    const isDir = await workspace.isDirectory(normalizedPath);
    if (isDir) {
      return Object.freeze({
        rawPath: trimmed,
        normalizedPath,
        kind: 'VERIFIED_DIRECTORY' as const,
        exists: true,
        isDirectory: true,
        isFile: false,
      });
    }

    return Object.freeze({
      rawPath: trimmed,
      normalizedPath,
      kind: 'VERIFIED_FILE' as const,
      exists: true,
      isDirectory: false,
      isFile: true,
    });
  } catch (err: any) {
    return Object.freeze({
      rawPath: trimmed,
      normalizedPath,
      kind: 'UNKNOWN' as const,
      exists: false,
      isDirectory: false,
      isFile: false,
      error: err.message || String(err),
    });
  }
}

export async function groundTargetPaths(
  workspace: Workspace,
  rawPaths: ReadonlyArray<string>,
  workspaceRoot?: string,
): Promise<ReadonlyArray<GroundedTargetPath>> {
  const grounded: GroundedTargetPath[] = [];
  for (const p of rawPaths) {
    grounded.push(await groundTargetPath(workspace, p, workspaceRoot));
  }
  return Object.freeze(grounded);
}

/**
 * Verifies if candidate path is an unauthorized substitution for requested target.
 */
export function isUnauthorizedSubstitution(
  requestedTarget: string,
  candidatePath: string,
): boolean {
  const normRequested = toPosixRelative(requestedTarget.replace(/\\/g, '/').replace(/^\.\//, ''));
  const normCandidate = toPosixRelative(candidatePath.replace(/\\/g, '/').replace(/^\.\//, ''));
  return normRequested !== normCandidate;
}

/**
 * Checks if a specific file path was explicitly requested by the user in the prompt or initial scope.
 */
export function isPathExplicitlyRequested(
  prompt: string,
  targetPath: string,
  initialScope?: ReadonlyArray<string>,
): boolean {
  if (!prompt && (!initialScope || initialScope.length === 0)) return false;

  const normTarget = toPosixRelative(targetPath.replace(/\\/g, '/').replace(/^\.\//, ''));
  if (!normTarget || normTarget === '.') return true;

  if (initialScope && initialScope.length > 0) {
    for (const s of initialScope) {
      const normScope = toPosixRelative(s.replace(/\\/g, '/').replace(/^\.\//, ''));
      if (normScope === normTarget) return true;
    }
  }

  // Check prompt text for exact path or posix path with word/boundary guards
  const normalizedPrompt = prompt.replace(/\\/g, '/');
  if (normalizedPrompt.includes(normTarget)) {
    const escaped = normTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('(?:^|[\\s"\'`(\\[])' + escaped + '(?:$|[\\s"\'`)\],;])', 'i');
    if (regex.test(normalizedPrompt)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates that every file and target proposed by a TodoPlan or ExecutionPlan is grounded in filesystem evidence.
 *
 * Rules:
 * 1. VERIFIED_FILE: File exists in active workspace.
 * 2. VERIFIED_DIRECTORY: Directory exists in active workspace.
 * 3. MISSING: File does not exist, but was explicitly requested by user prompt.
 * 4. UNKNOWN: File does not exist and was invented by planner without evidence -> PLANNER_UNGROUNDED_TARGET.
 * 5. Wildcard paths (*.module.ts) cannot become concrete execution targets -> PLANNER_UNGROUNDED_TARGET.
 */
export async function validateTodoPlanGrounding(
  workspace: Workspace,
  plan: TodoPlan | ExecutionPlan,
  prompt: string,
  workspaceRoot?: string,
  initialScope?: ReadonlyArray<string>,
): Promise<TodoPlanGroundingValidationResult> {
  const filesToValidate = new Set<string>();

  if ('todos' in plan && Array.isArray((plan as any).todos)) {
    const todoPlan = plan as TodoPlan;
    for (const todo of todoPlan.todos || []) {
      for (const f of todo.files || []) {
        if (f && typeof f === 'string' && f.trim().length > 0) {
          filesToValidate.add(f.trim());
        }
      }
    }
    for (const f of todoPlan.affectedFiles || []) {
      if (f && typeof f === 'string' && f.trim().length > 0) {
        filesToValidate.add(f.trim());
      }
    }
  } else if ('steps' in plan && Array.isArray((plan as any).steps)) {
    const execPlan = plan as ExecutionPlan;
    for (const step of execPlan.steps || []) {
      for (const f of step.expectedFiles || []) {
        if (f && typeof f === 'string' && f.trim().length > 0) {
          filesToValidate.add(f.trim());
        }
      }
    }
    if (execPlan.todoPlan) {
      for (const todo of execPlan.todoPlan.todos || []) {
        for (const f of todo.files || []) {
          if (f && typeof f === 'string' && f.trim().length > 0) {
            filesToValidate.add(f.trim());
          }
        }
      }
      for (const f of execPlan.todoPlan.affectedFiles || []) {
        if (f && typeof f === 'string' && f.trim().length > 0) {
          filesToValidate.add(f.trim());
        }
      }
    }
  }

  // Context and metadata references are reasoning inputs, not execution
  // targets, so they never take part in grounding enforcement.
  for (const candidate of Array.from(filesToValidate)) {
    if (isMetadataReferencePath(candidate)) filesToValidate.delete(candidate);
  }
  for (const reference of [
    ...(('contextReferences' in plan ? (plan as TodoPlan).contextReferences : undefined) ?? []),
    ...(('metadataReferences' in plan ? (plan as TodoPlan).metadataReferences : undefined) ?? []),
  ]) {
    filesToValidate.delete(reference.trim());
  }

  const groundedTargets: GroundedTargetPath[] = [];
  const verifiedFiles: string[] = [];
  const verifiedDirectories: string[] = [];
  const missingRequestedFiles: string[] = [];
  const ungroundedFiles: string[] = [];

  for (const rawPath of filesToValidate) {
    if (rawPath === '.' || rawPath === './') {
      const isDir = await workspace.isDirectory('.');
      groundedTargets.push(Object.freeze({
        rawPath,
        normalizedPath: '.',
        kind: isDir ? 'VERIFIED_DIRECTORY' : 'VERIFIED_FILE',
        exists: true,
        isDirectory: isDir,
        isFile: !isDir,
      }));
      if (isDir) {
        verifiedDirectories.push('.');
      } else {
        verifiedFiles.push('.');
      }
      continue;
    }

    if (rawPath.includes('*')) {
      ungroundedFiles.push(rawPath);
      groundedTargets.push(Object.freeze({
        rawPath,
        normalizedPath: rawPath,
        kind: 'UNKNOWN',
        exists: false,
        isDirectory: false,
        isFile: false,
        error: 'Wildcard path cannot be a concrete execution target',
      }));
      continue;
    }

    const grounded = await groundTargetPath(workspace, rawPath, workspaceRoot);
    groundedTargets.push(grounded);

    if (grounded.kind === 'VERIFIED_FILE') {
      verifiedFiles.push(grounded.normalizedPath);
    } else if (grounded.kind === 'VERIFIED_DIRECTORY') {
      verifiedDirectories.push(grounded.normalizedPath);
    } else {
      ungroundedFiles.push(grounded.rawPath);
    }
  }

  if (ungroundedFiles.length > 0) {
    const sanitizedUngrounded = sanitizeRejectedTargets(ungroundedFiles);
    return Object.freeze({
      valid: false,
      groundedTargets: Object.freeze(groundedTargets),
      verifiedFiles: Object.freeze(verifiedFiles),
      verifiedDirectories: Object.freeze(verifiedDirectories),
      missingRequestedFiles: Object.freeze([]),
      ungroundedFiles: Object.freeze(sanitizedUngrounded),
      reasonCode: 'PLANNER_UNGROUNDED_TARGET' as const,
      error: `PLANNER_UNGROUNDED_TARGET: Planner referenced files not grounded in workspace evidence: ${sanitizedUngrounded.join(', ')}`,
    });
  }

  return Object.freeze({
    valid: true,
    groundedTargets: Object.freeze(groundedTargets),
    verifiedFiles: Object.freeze(verifiedFiles),
    verifiedDirectories: Object.freeze(verifiedDirectories),
    missingRequestedFiles: Object.freeze([]),
    ungroundedFiles: Object.freeze([]),
  });
}
