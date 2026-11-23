export interface RunChangeSet {
  readonly runId: string;
  readonly files: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<'mutation-ledger' | 'commit-range' | 'explicit'>;
  readonly baselineCommit?: string;
  readonly headCommit?: string;
}

export function emptyRunChangeSet(runId: string, baselineCommit?: string): RunChangeSet {
  return Object.freeze({
    runId,
    files: Object.freeze([]),
    sources: Object.freeze([]),
    baselineCommit,
  });
}

export function mergeRunChangeSet(
  current: RunChangeSet,
  addition: {
    readonly files?: ReadonlyArray<string>;
    readonly source?: RunChangeSet['sources'][number];
    readonly headCommit?: string;
  },
): RunChangeSet {
  const set = new Set(current.files.map(normalize));
  for (const file of addition.files ?? []) {
    if (file && file.trim()) set.add(normalize(file));
  }
  const sources = new Set(current.sources);
  if (addition.source) sources.add(addition.source);
  return Object.freeze({
    runId: current.runId,
    files: Object.freeze([...set].sort()),
    sources: Object.freeze([...sources]),
    baselineCommit: current.baselineCommit,
    headCommit: addition.headCommit ?? current.headCommit,
  });
}

export function runChangeSetFromMutationLedger(
  runId: string,
  mutations: ReadonlyArray<{ readonly path: string; readonly status: string; readonly changed?: boolean; readonly rolledBack?: boolean }>,
  baselineCommit?: string,
): RunChangeSet {
  const files = mutations
    .filter((m) => m.status === 'APPLIED' && m.changed !== false && !m.rolledBack)
    .map((m) => normalize(m.path));
  return mergeRunChangeSet(emptyRunChangeSet(runId, baselineCommit), {
    files,
    source: 'mutation-ledger',
  });
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}