/**
 * Reliability Hardening R1 — workspace state evidence (R1.11-R1.17).
 *
 * The comparison answers "what did this run actually change?" from hashes
 * taken before and after execution. Files that were already dirty stay
 * separated from task changes, and when the snapshot budget cannot cover
 * the candidate set the whole comparison degrades to INSUFFICIENT_EVIDENCE
 * rather than quietly claiming a clean workspace.
 */

export const WORKSPACE_FILE_STATES = ['PRESENT', 'ABSENT'] as const;
export type WorkspaceFileState = (typeof WORKSPACE_FILE_STATES)[number];

export const WORKSPACE_EVIDENCE_STATES = ['PROVEN', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE'] as const;
export type WorkspaceEvidenceState = (typeof WORKSPACE_EVIDENCE_STATES)[number];

export const WORKSPACE_CHANGE_KINDS = ['MODIFIED', 'CREATED', 'DELETED'] as const;
export type WorkspaceChangeKind = (typeof WORKSPACE_CHANGE_KINDS)[number];

export interface WorkspaceSnapshotBudget {
  readonly maxSnapshotFiles: number;
  readonly maxSnapshotBytes: number;
  readonly hashAlgorithm: string;
}

export const DEFAULT_WORKSPACE_SNAPSHOT_BUDGET: WorkspaceSnapshotBudget = Object.freeze({
  maxSnapshotFiles: 200,
  maxSnapshotBytes: 8 * 1024 * 1024,
  hashAlgorithm: 'sha256',
});

export interface WorkspaceFileFingerprint {
  readonly path: string;
  readonly state: WorkspaceFileState;
  readonly size: number;
  /** Empty string when the file is absent or could not be hashed. */
  readonly hash: string;
}

export interface WorkspaceSnapshot {
  readonly phase: 'PRE' | 'POST';
  readonly capturedAt: string;
  readonly workspaceRoot: string;
  readonly files: ReadonlyArray<WorkspaceFileFingerprint>;
  readonly budget: WorkspaceSnapshotBudget;
  /** False when the budget cut the candidate set short. */
  readonly complete: boolean;
  readonly skippedPaths: ReadonlyArray<string>;
  readonly reason?: string;
}

export interface WorkspaceFileChange {
  readonly path: string;
  readonly kind: WorkspaceChangeKind;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly intended: boolean;
  readonly preExistingDirty: boolean;
}

export interface WorkspaceComparison {
  readonly state: WorkspaceEvidenceState;
  readonly basis: string;
  readonly intendedFiles: ReadonlyArray<string>;
  readonly intendedChangedFiles: ReadonlyArray<string>;
  readonly actualChangedFiles: ReadonlyArray<string>;
  readonly unintendedChangedFiles: ReadonlyArray<string>;
  readonly missingExpectedChanges: ReadonlyArray<string>;
  readonly preExistingDirtyFiles: ReadonlyArray<string>;
  readonly createdFiles: ReadonlyArray<string>;
  readonly deletedFiles: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<WorkspaceFileChange>;
  /**
   * PROVEN when an attributable change landed outside the intended set,
   * NOT_PROVEN when the comparison covered everything and found none,
   * INSUFFICIENT_EVIDENCE when attribution could not be established.
   */
  readonly wrongFileModification: 'PROVEN' | 'NOT_PROVEN' | 'INSUFFICIENT_EVIDENCE';
  readonly budget: WorkspaceSnapshotBudget;
  readonly beforeCapturedAt?: string;
  readonly afterCapturedAt?: string;
}

export function insufficientWorkspaceComparison(
  basis: string,
  budget: WorkspaceSnapshotBudget = DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
  intendedFiles: ReadonlyArray<string> = [],
): WorkspaceComparison {
  return Object.freeze({
    state: 'INSUFFICIENT_EVIDENCE' as const,
    basis,
    intendedFiles: Object.freeze([...intendedFiles]),
    intendedChangedFiles: Object.freeze([]),
    actualChangedFiles: Object.freeze([]),
    unintendedChangedFiles: Object.freeze([]),
    missingExpectedChanges: Object.freeze([]),
    preExistingDirtyFiles: Object.freeze([]),
    createdFiles: Object.freeze([]),
    deletedFiles: Object.freeze([]),
    changes: Object.freeze([]),
    wrongFileModification: 'INSUFFICIENT_EVIDENCE' as const,
    budget,
  });
}

/**
 * Compares two snapshots (R1.12-R1.14).
 *
 * `preExistingDirtyFiles` are paths git already reported as modified before
 * the run started. They are still compared — a task may legitimately change
 * one — but a change there is never counted as an unintended task change,
 * because the run cannot claim it caused a file that was already dirty.
 */
export function compareWorkspaceSnapshots(input: {
  readonly before: WorkspaceSnapshot;
  readonly after: WorkspaceSnapshot;
  readonly intendedFiles: ReadonlyArray<string>;
  readonly preExistingDirtyFiles?: ReadonlyArray<string>;
}): WorkspaceComparison {
  const budget = input.before.budget;
  const intendedFiles = normalizePaths(input.intendedFiles);
  const preExistingDirty = new Set(normalizePaths(input.preExistingDirtyFiles ?? []));

  if (!input.before.complete || !input.after.complete) {
    return Object.freeze({
      ...insufficientWorkspaceComparison(
        'snapshot budget exceeded; workspace comparison cannot cover the candidate set',
        budget,
        intendedFiles,
      ),
      preExistingDirtyFiles: Object.freeze([...preExistingDirty]),
      beforeCapturedAt: input.before.capturedAt,
      afterCapturedAt: input.after.capturedAt,
    });
  }

  const beforeMap = fingerprintMap(input.before);
  const afterMap = fingerprintMap(input.after);
  const intendedSet = new Set(intendedFiles);

  const changes: WorkspaceFileChange[] = [];
  const paths = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  for (const path of [...paths].sort()) {
    const before = beforeMap.get(path);
    const after = afterMap.get(path);
    if (!before || !after) continue;
    const kind = changeKind(before, after);
    if (!kind) continue;
    changes.push(Object.freeze({
      path,
      kind,
      beforeHash: before.hash,
      afterHash: after.hash,
      intended: intendedSet.has(path),
      preExistingDirty: preExistingDirty.has(path),
    }));
  }

  const actualChangedFiles = changes.map(change => change.path);
  const intendedChangedFiles = changes.filter(change => change.intended).map(change => change.path);
  const unintendedChangedFiles = changes
    .filter(change => !change.intended && !change.preExistingDirty)
    .map(change => change.path);
  const missingExpectedChanges = intendedFiles.filter(path => !intendedChangedFiles.includes(path));

  // Attribution requires both snapshots to have actually covered the file.
  const uncovered = intendedFiles.filter(path => !beforeMap.has(path) || !afterMap.has(path));
  const attributable = uncovered.length === 0;

  return Object.freeze({
    state: attributable ? ('PROVEN' as const) : ('INSUFFICIENT_EVIDENCE' as const),
    basis: attributable
      ? `hash comparison over ${paths.size} candidate paths`
      : `intended files outside snapshot coverage: ${uncovered.join(', ')}`,
    intendedFiles: Object.freeze(intendedFiles),
    intendedChangedFiles: Object.freeze(intendedChangedFiles),
    actualChangedFiles: Object.freeze(actualChangedFiles),
    unintendedChangedFiles: Object.freeze(unintendedChangedFiles),
    missingExpectedChanges: Object.freeze(missingExpectedChanges),
    preExistingDirtyFiles: Object.freeze([...preExistingDirty].sort()),
    createdFiles: Object.freeze(changes.filter(c => c.kind === 'CREATED').map(c => c.path)),
    deletedFiles: Object.freeze(changes.filter(c => c.kind === 'DELETED').map(c => c.path)),
    changes: Object.freeze(changes),
    wrongFileModification: !attributable
      ? ('INSUFFICIENT_EVIDENCE' as const)
      : unintendedChangedFiles.length > 0
        ? ('PROVEN' as const)
        : ('NOT_PROVEN' as const),
    budget,
    beforeCapturedAt: input.before.capturedAt,
    afterCapturedAt: input.after.capturedAt,
  });
}

export function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizePaths(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWorkspacePath(value);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

function fingerprintMap(snapshot: WorkspaceSnapshot): Map<string, WorkspaceFileFingerprint> {
  const map = new Map<string, WorkspaceFileFingerprint>();
  for (const file of snapshot.files) {
    map.set(normalizeWorkspacePath(file.path), file);
  }
  return map;
}

function changeKind(
  before: WorkspaceFileFingerprint,
  after: WorkspaceFileFingerprint,
): WorkspaceChangeKind | null {
  if (before.state === 'ABSENT' && after.state === 'PRESENT') return 'CREATED';
  if (before.state === 'PRESENT' && after.state === 'ABSENT') return 'DELETED';
  if (before.state === 'PRESENT' && after.state === 'PRESENT' && before.hash !== after.hash) {
    return 'MODIFIED';
  }
  return null;
}
