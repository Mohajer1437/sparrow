/**
 * R1.11-R1.17 — the workspace comparison must describe what actually changed
 * on disk, and must say INSUFFICIENT_EVIDENCE rather than guess.
 */

import {
  DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
  WorkspaceFileFingerprint,
  WorkspaceSnapshot,
  compareWorkspaceSnapshots,
  insufficientWorkspaceComparison,
} from '../../../src/domain/execution/workspace-evidence';

function present(path: string, hash: string): WorkspaceFileFingerprint {
  return { path, state: 'PRESENT', size: hash.length, hash };
}

function absent(path: string): WorkspaceFileFingerprint {
  return { path, state: 'ABSENT', size: 0, hash: '' };
}

function snapshot(
  phase: 'PRE' | 'POST',
  files: ReadonlyArray<WorkspaceFileFingerprint>,
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    phase,
    capturedAt: phase === 'PRE' ? '2026-01-01T00:00:00.000Z' : '2026-01-01T00:05:00.000Z',
    workspaceRoot: 'E:/new-test-2',
    files,
    budget: DEFAULT_WORKSPACE_SNAPSHOT_BUDGET,
    complete: true,
    skippedPaths: [],
    ...overrides,
  };
}

describe('Workspace comparison (R1.12-R1.14)', () => {
  it('reports no changes for an untouched workspace', () => {
    const files = [present('app/page.tsx', 'h1')];
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', files),
      after: snapshot('POST', files),
      intendedFiles: [],
    });

    expect(comparison.state).toBe('PROVEN');
    expect(comparison.actualChangedFiles).toEqual([]);
    expect(comparison.wrongFileModification).toBe('NOT_PROVEN');
  });

  it('records the intended file when only that file changed', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'h1')]),
      after: snapshot('POST', [present('app/page.tsx', 'h2')]),
      intendedFiles: ['app/page.tsx'],
    });

    expect(comparison.intendedChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.actualChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.unintendedChangedFiles).toEqual([]);
    expect(comparison.missingExpectedChanges).toEqual([]);
    expect(comparison.wrongFileModification).toBe('NOT_PROVEN');
  });

  it('records every intended file when several changed', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'h1'), present('app/layout.tsx', 'l1')]),
      after: snapshot('POST', [present('app/page.tsx', 'h2'), present('app/layout.tsx', 'l2')]),
      intendedFiles: ['app/page.tsx', 'app/layout.tsx'],
    });

    expect([...comparison.intendedChangedFiles].sort()).toEqual(['app/layout.tsx', 'app/page.tsx']);
    expect(comparison.unintendedChangedFiles).toEqual([]);
  });

  it('proves a wrong-file modification when an unintended file changed (R1.14)', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'h1'), present('app/layout.tsx', 'l1')]),
      after: snapshot('POST', [present('app/page.tsx', 'h1'), present('app/layout.tsx', 'l2')]),
      intendedFiles: ['app/page.tsx'],
    });

    expect(comparison.unintendedChangedFiles).toEqual(['app/layout.tsx']);
    expect(comparison.missingExpectedChanges).toEqual(['app/page.tsx']);
    expect(comparison.wrongFileModification).toBe('PROVEN');
  });

  it('keeps a pre-existing dirty file out of unintended changes (R1.13)', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'h1'), present('data/saved_cards.json', 'd1')]),
      after: snapshot('POST', [present('app/page.tsx', 'h2'), present('data/saved_cards.json', 'd2')]),
      intendedFiles: ['app/page.tsx'],
      preExistingDirtyFiles: ['data/saved_cards.json'],
    });

    expect(comparison.intendedChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.unintendedChangedFiles).toEqual([]);
    expect(comparison.preExistingDirtyFiles).toEqual(['data/saved_cards.json']);
    expect(comparison.wrongFileModification).toBe('NOT_PROVEN');
  });

  it('detects a missing expected change when execution touched nothing', () => {
    const files = [present('app/page.tsx', 'h1')];
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', files),
      after: snapshot('POST', files),
      intendedFiles: ['app/page.tsx'],
    });

    expect(comparison.missingExpectedChanges).toEqual(['app/page.tsx']);
    expect(comparison.actualChangedFiles).toEqual([]);
  });

  it('classifies creation and deletion separately from modification', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [absent('app/new.tsx'), present('app/old.tsx', 'o1')]),
      after: snapshot('POST', [present('app/new.tsx', 'n1'), absent('app/old.tsx')]),
      intendedFiles: ['app/new.tsx', 'app/old.tsx'],
    });

    expect(comparison.createdFiles).toEqual(['app/new.tsx']);
    expect(comparison.deletedFiles).toEqual(['app/old.tsx']);
    expect(comparison.missingExpectedChanges).toEqual([]);
  });

  it('treats identical content with identical hashes as unchanged', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'same')]),
      after: snapshot('POST', [present('app/page.tsx', 'same')]),
      intendedFiles: ['app/page.tsx'],
    });
    expect(comparison.actualChangedFiles).toEqual([]);
  });

  it('degrades to INSUFFICIENT_EVIDENCE when the snapshot budget was exceeded (R1.16)', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/page.tsx', 'h1')], { complete: false, reason: 'maxSnapshotFiles' }),
      after: snapshot('POST', [present('app/page.tsx', 'h2')]),
      intendedFiles: ['app/page.tsx'],
    });

    expect(comparison.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(comparison.wrongFileModification).toBe('INSUFFICIENT_EVIDENCE');
    // It must not claim a clean workspace on the way out.
    expect(comparison.unintendedChangedFiles).toEqual([]);
    expect(comparison.basis).toContain('budget');
  });

  it('refuses attribution when an intended file was never covered by the snapshots', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app/layout.tsx', 'l1')]),
      after: snapshot('POST', [present('app/layout.tsx', 'l2')]),
      intendedFiles: ['app/page.tsx'],
    });

    expect(comparison.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(comparison.wrongFileModification).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('normalizes windows separators so the same file is not counted twice', () => {
    const comparison = compareWorkspaceSnapshots({
      before: snapshot('PRE', [present('app\\page.tsx', 'h1')]),
      after: snapshot('POST', [present('app/page.tsx', 'h2')]),
      intendedFiles: ['app\\page.tsx'],
    });

    expect(comparison.actualChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.intendedChangedFiles).toEqual(['app/page.tsx']);
  });
});

describe('insufficientWorkspaceComparison', () => {
  it('never reports a clean workspace', () => {
    const comparison = insufficientWorkspaceComparison('no snapshot was taken');
    expect(comparison.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(comparison.wrongFileModification).toBe('INSUFFICIENT_EVIDENCE');
  });
});
