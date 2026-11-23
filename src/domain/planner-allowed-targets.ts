import { Evidence } from './pre-execution/evidence';
import { PlannerContext } from './planner-context';
import { toPosixRelative } from '../core/workspace/workspace-paths';

export interface PlannerAllowedTargets {
  readonly confirmedFiles: ReadonlyArray<string>;
  readonly verifiedDirectories: ReadonlyArray<string>;
  readonly allowedPaths: ReadonlyArray<string>;
  /**
   * Files the planner may read for reasoning. Visibility is not authority:
   * these are never execution targets unless they are also confirmed.
   */
  readonly contextReferences: ReadonlyArray<string>;
  /** True when at least one execution target was authorized by evidence. */
  readonly hasAuthority: boolean;
  isAllowed(targetPath: string): boolean;
  isVisibleContext(targetPath: string): boolean;
}

export function createPlannerAllowedTargets(params: {
  evidence?: ReadonlyArray<Evidence>;
  plannerContext?: PlannerContext;
  verifiedFiles?: ReadonlyArray<string>;
  verifiedDirectories?: ReadonlyArray<string>;
}): PlannerAllowedTargets {
  const allowedSet = new Set<string>();
  const confirmedFiles: string[] = [];
  const verifiedDirs: string[] = ['.', './'];
  allowedSet.add('.');

  // 1. Extract from Evidence (status === 'CONFIRMED' for file/dir evidence)
  if (params.evidence) {
    for (const ev of params.evidence) {
      if (ev.status === 'CONFIRMED') {
        if (ev.type === 'FILE_EXISTS' || ev.type === 'FILE_CONTENT') {
          const path = ev.source;
          if (path && typeof path === 'string') {
            const norm = toPosixRelative(path.replace(/\\/g, '/').replace(/^\.\//, ''));
            if (norm && !norm.includes('*')) {
              allowedSet.add(norm);
              if (!confirmedFiles.includes(norm)) {
                confirmedFiles.push(norm);
              }
            }
          }
        } else if (ev.type === 'DIRECTORY_STRUCTURE') {
          const dir = ev.source;
          if (dir && typeof dir === 'string') {
            const norm = toPosixRelative(dir.replace(/\\/g, '/').replace(/^\.\//, ''));
            if (norm) {
              allowedSet.add(norm);
              if (!verifiedDirs.includes(norm)) {
                verifiedDirs.push(norm);
              }
            }
          }
        }
      }
    }
  }

  // 2. PlannerContext gathered records are reasoning visibility only. A file
  //    being visible to the planner does not authorize it as an execution
  //    target, so these are tracked separately and never added to allowedSet.
  const contextReferences: string[] = [];
  if (params.plannerContext?.gathered?.records) {
    for (const record of params.plannerContext.gathered.records) {
      if (record.status === 'COLLECTED' || record.status === 'AVAILABLE') {
        if (record.reference && typeof record.reference === 'string') {
          const norm = toPosixRelative(record.reference.replace(/\\/g, '/').replace(/^\.\//, ''));
          if (norm && !norm.includes('*') && !contextReferences.includes(norm)) {
            contextReferences.push(norm);
          }
        }
      }
    }
  }

  // 3. Additional verified files
  if (params.verifiedFiles) {
    for (const f of params.verifiedFiles) {
      const norm = toPosixRelative(f.replace(/\\/g, '/').replace(/^\.\//, ''));
      if (norm && !norm.includes('*')) {
        allowedSet.add(norm);
        if (!confirmedFiles.includes(norm)) {
          confirmedFiles.push(norm);
        }
      }
    }
  }

  // 4. Additional verified directories
  if (params.verifiedDirectories) {
    for (const d of params.verifiedDirectories) {
      const norm = toPosixRelative(d.replace(/\\/g, '/').replace(/^\.\//, ''));
      if (norm) {
        allowedSet.add(norm);
        if (!verifiedDirs.includes(norm)) {
          verifiedDirs.push(norm);
        }
      }
    }
  }

  const sortedConfirmed = Array.from(new Set(confirmedFiles)).sort();
  const sortedDirs = Array.from(new Set(verifiedDirs)).sort();
  const sortedAllowed = Array.from(allowedSet).sort();
  const sortedContext = Array.from(new Set(contextReferences)).sort();
  const contextSet = new Set(sortedContext);

  return Object.freeze({
    confirmedFiles: Object.freeze(sortedConfirmed),
    verifiedDirectories: Object.freeze(sortedDirs),
    allowedPaths: Object.freeze(sortedAllowed),
    contextReferences: Object.freeze(sortedContext),
    hasAuthority: sortedConfirmed.length > 0,
    isAllowed(targetPath: string): boolean {
      if (!targetPath || typeof targetPath !== 'string') return false;
      const trimmed = targetPath.trim();
      if (!trimmed || trimmed === '.' || trimmed === './') return true;
      if (trimmed.includes('*')) return false;
      const norm = toPosixRelative(trimmed.replace(/\\/g, '/').replace(/^\.\//, ''));
      return allowedSet.has(norm);
    },
    isVisibleContext(targetPath: string): boolean {
      if (!targetPath || typeof targetPath !== 'string') return false;
      const norm = toPosixRelative(targetPath.trim().replace(/\\/g, '/').replace(/^\.\//, ''));
      return contextSet.has(norm);
    },
  });
}

/**
 * Normalizes and sanitizes rejected target paths to preserve exact file paths
 * without collapsing them into parent directories, and eliminates redundant
 * directory-only paths when concrete file targets are present.
 */
export function sanitizeRejectedTargets(paths: ReadonlyArray<string>): string[] {
  if (!paths || paths.length === 0) return [];

  // 1. Normalize all paths to posix relative and deduplicate
  const normalizedList: string[] = [];
  const seen = new Set<string>();

  for (const raw of paths) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '.' || trimmed === './') continue;
    let norm = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
    if (norm.endsWith('/') && norm.length > 1) {
      norm = norm.slice(0, -1);
    }
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      normalizedList.push(norm);
    }
  }

  if (normalizedList.length === 0) return [];

  // 2. Identify parent directory paths that have more specific child file paths in the list
  const isParentOfAnother = (dir: string): boolean => {
    const prefix = `${dir}/`;
    return normalizedList.some(other => other !== dir && other.startsWith(prefix));
  };

  // 3. Filter out parent directories when child targets are present
  const result = normalizedList.filter(p => !isParentOfAnother(p));

  return result.length > 0 ? result : normalizedList;
}
