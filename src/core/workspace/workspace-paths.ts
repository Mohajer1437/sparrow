import path from 'path';

export type WorkspacePathErrorCode = 'TRAVERSAL' | 'INVALID';

export class WorkspacePathError extends Error {
  readonly code: WorkspacePathErrorCode;

  constructor(message: string, code: WorkspacePathErrorCode) {
    super(message);
    this.name = 'WorkspacePathError';
    this.code = code;
  }
}

export interface ResolvedWorkspacePath {
  readonly input: string;
  readonly relative: string;
  readonly absolute: string;
}

export function canonicalizeWorkspaceRoot(root: string): string {
  if (!root || root.trim().length === 0) {
    throw new WorkspacePathError('Workspace root is empty', 'INVALID');
  }
  return path.resolve(root.trim());
}

export function toPosixRelative(relativePath: string): string {
  return relativePath.split(/[\\/]/).filter((part, index) => !(index === 0 && part === '')).join('/');
}

export function isPathInsideRoot(root: string, absolutePath: string): boolean {
  const rootResolved = canonicalizeWorkspaceRoot(root);
  const target = path.resolve(absolutePath);
  const relative = path.relative(rootResolved, target);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolve a task path against one authoritative workspace root.
 * Accepts project-relative, ./relative, Windows separators, and absolute
 * paths that remain inside the workspace.
 */
export function resolveWorkspacePath(root: string, filePath: string): ResolvedWorkspacePath {
  const canonicalRoot = canonicalizeWorkspaceRoot(root);
  if (!filePath || filePath.trim().length === 0) {
    throw new WorkspacePathError('Path is empty', 'INVALID');
  }

  const trimmed = filePath.trim().replace(/\\/g, '/');
  const candidate = path.isAbsolute(filePath.trim())
    ? path.resolve(filePath.trim())
    : path.resolve(canonicalRoot, trimmed);

  if (!isPathInsideRoot(canonicalRoot, candidate)) {
    throw new WorkspacePathError('Path traversal detected: cannot escape workspace', 'TRAVERSAL');
  }

  const relativeNative = path.relative(canonicalRoot, candidate);
  const relative = toPosixRelative(relativeNative) || '.';
  return Object.freeze({
    input: filePath,
    relative,
    absolute: candidate,
  });
}

export function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function selectTaskChangedFiles(
  currentDirty: ReadonlyArray<string>,
  preexistingDirty: ReadonlyArray<string>,
): string[] {
  const baseline = new Set(preexistingDirty.map(normalizeGitPath));
  return currentDirty.filter(file => !baseline.has(normalizeGitPath(file)));
}
