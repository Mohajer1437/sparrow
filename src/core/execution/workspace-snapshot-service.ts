import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
  WorkspaceFileFingerprint,
  WorkspaceSnapshot,
  WorkspaceSnapshotBudget,
  normalizeWorkspacePath,
} from '../../domain/execution/workspace-evidence';

export interface WorkspaceSnapshotRequest {
  readonly phase: 'PRE' | 'POST';
  readonly workspaceRoot: string;
  readonly candidatePaths: ReadonlyArray<string>;
  readonly budget?: WorkspaceSnapshotBudget;
}

/**
 * Captures bounded hash fingerprints for a candidate path set (R1.11, R1.16, R1.17).
 *
 * The candidate set is supplied by the caller — planned files plus whatever
 * git already reports — so a snapshot never walks an entire repository.
 */
export class WorkspaceSnapshotService {
  async capture(request: WorkspaceSnapshotRequest): Promise<WorkspaceSnapshot> {
    const budget = request.budget ?? DEFAULT_WORKSPACE_SNAPSHOT_BUDGET;
    const candidates = dedupe(request.candidatePaths, request.workspaceRoot);
    const files: WorkspaceFileFingerprint[] = [];
    const skipped: string[] = [];
    let complete = true;
    let reason: string | undefined;
    let totalBytes = 0;

    for (const relative of candidates) {
      if (files.length >= budget.maxSnapshotFiles) {
        complete = false;
        reason = `candidate set exceeds maxSnapshotFiles=${budget.maxSnapshotFiles}`;
        skipped.push(relative);
        continue;
      }

      const absolute = path.resolve(request.workspaceRoot, relative);
      let stat: import('fs').Stats | null = null;
      try {
        stat = await fs.stat(absolute);
      } catch {
        files.push(Object.freeze({ path: relative, state: 'ABSENT' as const, size: 0, hash: '' }));
        continue;
      }

      if (!stat.isFile()) {
        skipped.push(relative);
        continue;
      }

      if (totalBytes + stat.size > budget.maxSnapshotBytes) {
        complete = false;
        reason = `candidate set exceeds maxSnapshotBytes=${budget.maxSnapshotBytes}`;
        skipped.push(relative);
        continue;
      }

      try {
        const content = await fs.readFile(absolute);
        totalBytes += content.byteLength;
        files.push(Object.freeze({
          path: relative,
          state: 'PRESENT' as const,
          size: content.byteLength,
          hash: crypto.createHash(budget.hashAlgorithm).update(content).digest('hex'),
        }));
      } catch (error: any) {
        complete = false;
        reason = `unreadable file: ${relative}`;
        skipped.push(relative);
      }
    }

    return Object.freeze({
      phase: request.phase,
      capturedAt: new Date().toISOString(),
      workspaceRoot: request.workspaceRoot,
      files: Object.freeze(files),
      budget,
      complete,
      skippedPaths: Object.freeze(skipped),
      reason,
    });
  }
}

/** Candidate paths arrive from planners, git and tools, so absolute paths inside the workspace are relativized to keep snapshots comparable. */
function dedupe(values: ReadonlyArray<string>, workspaceRoot: string): string[] {
  const seen = new Set<string>();
  const root = normalizeWorkspacePath(path.resolve(workspaceRoot));
  for (const value of values) {
    let normalized = normalizeWorkspacePath(value ?? '');
    if (!normalized) continue;
    if (path.isAbsolute(value)) {
      const resolved = normalizeWorkspacePath(path.resolve(value));
      if (!resolved.toLowerCase().startsWith(root.toLowerCase() + '/')) continue;
      normalized = resolved.slice(root.length + 1);
    }
    if (normalized && !normalized.startsWith('..')) seen.add(normalized);
  }
  return [...seen].sort();
}
