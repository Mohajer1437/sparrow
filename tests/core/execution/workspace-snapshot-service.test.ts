/**
 * R1.11, R1.16, R1.17 — snapshots are bounded, hashed, and honest about what
 * they could not cover.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceSnapshotService } from '../../../src/core/execution/workspace-snapshot-service';
import { compareWorkspaceSnapshots } from '../../../src/domain/execution/workspace-evidence';

let root: string;
const service = new WorkspaceSnapshotService();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-snapshot-'));
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'app', 'page.tsx'), 'export default function Page() { return null; }', 'utf8');
  await fs.writeFile(path.join(root, 'app', 'layout.tsx'), 'export default function Layout() { return null; }', 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('WorkspaceSnapshotService (R1.11, R1.17)', () => {
  it('fingerprints candidate files with path, size, hash and state', async () => {
    const snapshot = await service.capture({
      phase: 'PRE',
      workspaceRoot: root,
      candidatePaths: ['app/page.tsx'],
    });

    expect(snapshot.complete).toBe(true);
    expect(snapshot.files).toHaveLength(1);
    const file = snapshot.files[0];
    expect(file.path).toBe('app/page.tsx');
    expect(file.state).toBe('PRESENT');
    expect(file.size).toBeGreaterThan(0);
    expect(file.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash twice for unchanged content and a different one after a write', async () => {
    const first = await service.capture({ phase: 'PRE', workspaceRoot: root, candidatePaths: ['app/page.tsx'] });
    const second = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: ['app/page.tsx'] });
    expect(second.files[0].hash).toBe(first.files[0].hash);

    await fs.writeFile(path.join(root, 'app', 'page.tsx'), '// changed', 'utf8');
    const third = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: ['app/page.tsx'] });
    expect(third.files[0].hash).not.toBe(first.files[0].hash);
  });

  it('records a missing file as ABSENT rather than dropping it', async () => {
    const snapshot = await service.capture({
      phase: 'PRE',
      workspaceRoot: root,
      candidatePaths: ['app/not-created-yet.tsx'],
    });
    expect(snapshot.files[0]).toMatchObject({ state: 'ABSENT', hash: '', size: 0 });
    expect(snapshot.complete).toBe(true);
  });

  it('relativizes absolute candidate paths inside the workspace', async () => {
    const snapshot = await service.capture({
      phase: 'PRE',
      workspaceRoot: root,
      candidatePaths: [path.join(root, 'app', 'page.tsx')],
    });
    expect(snapshot.files.map(file => file.path)).toEqual(['app/page.tsx']);
  });

  it('ignores candidate paths outside the workspace', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'r1-outside-'));
    try {
      const snapshot = await service.capture({
        phase: 'PRE',
        workspaceRoot: root,
        candidatePaths: [path.join(outside, 'secret.txt')],
      });
      expect(snapshot.files).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('marks the snapshot incomplete when maxSnapshotFiles is exceeded (R1.16)', async () => {
    const snapshot = await service.capture({
      phase: 'PRE',
      workspaceRoot: root,
      candidatePaths: ['app/page.tsx', 'app/layout.tsx'],
      budget: { maxSnapshotFiles: 1, maxSnapshotBytes: 1024 * 1024, hashAlgorithm: 'sha256' },
    });

    expect(snapshot.complete).toBe(false);
    expect(snapshot.reason).toContain('maxSnapshotFiles');
    expect(snapshot.skippedPaths.length).toBe(1);
  });

  it('marks the snapshot incomplete when maxSnapshotBytes is exceeded (R1.16)', async () => {
    const snapshot = await service.capture({
      phase: 'PRE',
      workspaceRoot: root,
      candidatePaths: ['app/page.tsx', 'app/layout.tsx'],
      budget: { maxSnapshotFiles: 100, maxSnapshotBytes: 10, hashAlgorithm: 'sha256' },
    });

    expect(snapshot.complete).toBe(false);
    expect(snapshot.reason).toContain('maxSnapshotBytes');
  });

  it('feeds a real end-to-end comparison that detects the changed file', async () => {
    const candidates = ['app/page.tsx', 'app/layout.tsx'];
    const before = await service.capture({ phase: 'PRE', workspaceRoot: root, candidatePaths: candidates });
    await fs.writeFile(path.join(root, 'app', 'page.tsx'), '// r1-workspace-test', 'utf8');
    const after = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: candidates });

    const comparison = compareWorkspaceSnapshots({ before, after, intendedFiles: ['app/page.tsx'] });

    expect(comparison.state).toBe('PROVEN');
    expect(comparison.actualChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.unintendedChangedFiles).toEqual([]);
    expect(comparison.wrongFileModification).toBe('NOT_PROVEN');
  });

  it('detects the anti-hallucination case where the planner named one file and another changed', async () => {
    const candidates = ['app/page.tsx', 'app/layout.tsx'];
    const before = await service.capture({ phase: 'PRE', workspaceRoot: root, candidatePaths: candidates });
    await fs.writeFile(path.join(root, 'app', 'layout.tsx'), '// wrong file', 'utf8');
    const after = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: candidates });

    const comparison = compareWorkspaceSnapshots({ before, after, intendedFiles: ['app/page.tsx'] });

    expect(comparison.wrongFileModification).toBe('PROVEN');
    expect(comparison.unintendedChangedFiles).toEqual(['app/layout.tsx']);
    expect(comparison.missingExpectedChanges).toEqual(['app/page.tsx']);
  });

  it('detects the anti-hallucination case where execution changed nothing at all', async () => {
    const candidates = ['app/page.tsx'];
    const before = await service.capture({ phase: 'PRE', workspaceRoot: root, candidatePaths: candidates });
    const after = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: candidates });

    const comparison = compareWorkspaceSnapshots({ before, after, intendedFiles: ['app/page.tsx'] });

    expect(comparison.missingExpectedChanges).toEqual(['app/page.tsx']);
    expect(comparison.intendedChangedFiles).toEqual([]);
  });

  it('separates a pre-existing dirty data file from the task change', async () => {
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'saved_cards.json'), '[]', 'utf8');
    const candidates = ['app/page.tsx', 'data/saved_cards.json'];

    const before = await service.capture({ phase: 'PRE', workspaceRoot: root, candidatePaths: candidates });
    await fs.writeFile(path.join(root, 'app', 'page.tsx'), '// task change', 'utf8');
    await fs.writeFile(path.join(root, 'data', 'saved_cards.json'), '[{"id":1}]', 'utf8');
    const after = await service.capture({ phase: 'POST', workspaceRoot: root, candidatePaths: candidates });

    const comparison = compareWorkspaceSnapshots({
      before,
      after,
      intendedFiles: ['app/page.tsx'],
      preExistingDirtyFiles: ['data/saved_cards.json'],
    });

    expect(comparison.intendedChangedFiles).toEqual(['app/page.tsx']);
    expect(comparison.unintendedChangedFiles).toEqual([]);
    expect(comparison.wrongFileModification).toBe('NOT_PROVEN');
  });
});
