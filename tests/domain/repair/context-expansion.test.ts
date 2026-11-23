import {
  CANDIDATE_SOURCE_RANK,
  ExpansionCandidate,
  MissingEvidence,
  computeContextDelta,
  computeContextFingerprint,
  decideExpansion,
  rankCandidates,
  relationsFor,
  selectCandidates,
} from '../../../src/domain/repair/context-expansion';
import { ImpactAnalysis } from '../../../src/domain/impact-analysis';

function candidate(over: Partial<ExpansionCandidate> = {}): ExpansionCandidate {
  const source = over.source ?? 'FAILURE_REFERENCE';
  return {
    path: 'src/a.ts',
    source,
    rank: CANDIDATE_SOURCE_RANK[source],
    confidence: 'CONFIRMED',
    reason: 'test',
    evidenceRef: 'test',
    exists: true,
    alreadyInContext: false,
    ...over,
  } as ExpansionCandidate;
}

function missing(over: Partial<MissingEvidence> = {}): MissingEvidence {
  return {
    kind: 'MISSING_DEPENDENCY',
    reference: 'src/dep.ts',
    evidenceRef: 'impactAnalysis.relations.imports',
    resolved: true,
    ...over,
  };
}

const basePolicy = {
  completedRepairAttempts: 0,
  maxRepairAttempts: 2,
  expansionLevel: 0,
  maxContextExpansion: 2,
  missingEvidence: [] as MissingEvidence[],
  newCandidateCount: 0,
  duplicatePlan: false,
};

describe('R3.9 context fingerprints', () => {
  it('is stable regardless of the order files were gathered in', () => {
    const a = computeContextFingerprint([
      { path: 'a.ts', fingerprint: '1' },
      { path: 'b.ts', fingerprint: '2' },
    ]);
    const b = computeContextFingerprint([
      { path: 'b.ts', fingerprint: '2' },
      { path: 'a.ts', fingerprint: '1' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a file is added', () => {
    const before = computeContextFingerprint([{ path: 'a.ts', fingerprint: '1' }]);
    const after = computeContextFingerprint([
      { path: 'a.ts', fingerprint: '1' },
      { path: 'b.ts', fingerprint: '2' },
    ]);
    expect(after).not.toBe(before);
  });

  it('changes when a held file changes content', () => {
    const before = computeContextFingerprint([{ path: 'a.ts', fingerprint: '1' }]);
    const after = computeContextFingerprint([{ path: 'a.ts', fingerprint: '2' }]);
    expect(after).not.toBe(before);
  });

  it('does not change when the same files are simply re-read', () => {
    const refs = [{ path: 'a.ts', fingerprint: '1' }, { path: 'b.ts', fingerprint: '2' }];
    expect(computeContextFingerprint(refs)).toBe(computeContextFingerprint([...refs]));
  });

  it('normalizes separators so the same file is one entry', () => {
    expect(computeContextFingerprint([{ path: 'src\\a.ts', fingerprint: '1' }]))
      .toBe(computeContextFingerprint([{ path: 'src/a.ts', fingerprint: '1' }]));
  });
});

describe('R3.10 context delta', () => {
  it('reports a new file as new evidence', () => {
    const delta = computeContextDelta(
      [{ path: 'a.ts', fingerprint: '1' }],
      [{ path: 'a.ts', fingerprint: '1' }, { path: 'b.ts', fingerprint: '2' }],
    );
    expect(delta.newFiles).toEqual(['b.ts']);
    expect(delta.unchangedFiles).toEqual(['a.ts']);
    expect(delta.hasNewEvidence).toBe(true);
  });

  it('reports a changed file as new evidence', () => {
    const delta = computeContextDelta(
      [{ path: 'a.ts', fingerprint: '1' }],
      [{ path: 'a.ts', fingerprint: '9' }],
    );
    expect(delta.changedFiles).toEqual(['a.ts']);
    expect(delta.hasNewEvidence).toBe(true);
  });

  it('reports an identical context as no new evidence', () => {
    const refs = [{ path: 'a.ts', fingerprint: '1' }];
    const delta = computeContextDelta(refs, refs);
    expect(delta.hasNewEvidence).toBe(false);
    expect(delta.previousFingerprint).toBe(delta.nextFingerprint);
  });

  it('does not count a duplicated entry as growth', () => {
    const delta = computeContextDelta(
      [{ path: 'a.ts', fingerprint: '1' }],
      [{ path: 'a.ts', fingerprint: '1' }, { path: 'a.ts', fingerprint: '1' }],
    );
    expect(delta.hasNewEvidence).toBe(false);
  });

  it('records a removed file without calling it new evidence', () => {
    const delta = computeContextDelta(
      [{ path: 'a.ts', fingerprint: '1' }, { path: 'b.ts', fingerprint: '2' }],
      [{ path: 'a.ts', fingerprint: '1' }],
    );
    expect(delta.removedFiles).toEqual(['b.ts']);
    expect(delta.hasNewEvidence).toBe(false);
  });
});

describe('R3.6 candidate ranking', () => {
  it('orders by evidence strength before anything else', () => {
    const ranked = rankCandidates([
      candidate({ path: 'z.ts', source: 'IMPACT_INDIRECT' }),
      candidate({ path: 'a.ts', source: 'FAILURE_REFERENCE' }),
      candidate({ path: 'm.ts', source: 'IMPACT_DEPENDENCY' }),
    ]);
    expect(ranked.map(item => item.path)).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('breaks a rank tie by confidence, then by path', () => {
    const ranked = rankCandidates([
      candidate({ path: 'b.ts', source: 'IMPACT_DEPENDENCY', confidence: 'CONFIRMED' }),
      candidate({ path: 'a.ts', source: 'IMPACT_DEPENDENCY', confidence: 'INFERRED' }),
      candidate({ path: 'a0.ts', source: 'IMPACT_DEPENDENCY', confidence: 'CONFIRMED' }),
    ]);
    expect(ranked.map(item => item.path)).toEqual(['a0.ts', 'b.ts', 'a.ts']);
  });

  it('is stable: the same input always yields the same order', () => {
    const input = [
      candidate({ path: 'b.ts', source: 'FAILING_TEST' }),
      candidate({ path: 'a.ts', source: 'FAILING_TEST' }),
    ];
    expect(rankCandidates(input)).toEqual(rankCandidates([...input].reverse()));
  });
});

describe('R3.7 candidate budget and rejection reasons', () => {
  it('keeps the highest-ranked candidates and says why the rest were dropped', () => {
    const selection = selectCandidates({
      budget: 1,
      candidates: [
        candidate({ path: 'weak.ts', source: 'IMPACT_INDIRECT' }),
        candidate({ path: 'strong.ts', source: 'FAILURE_REFERENCE' }),
      ],
    });
    expect(selection.selected.map(item => item.path)).toEqual(['strong.ts']);
    expect(selection.budgetExceeded).toBe(true);
    expect(selection.rejected[0]).toMatchObject({ path: 'weak.ts', rejection: 'BUDGET_EXCEEDED' });
  });

  it('rejects a candidate that does not exist rather than passing it on', () => {
    const selection = selectCandidates({
      budget: 8,
      candidates: [candidate({ path: 'src/auth/guard.ts', exists: false })],
    });
    expect(selection.selected).toEqual([]);
    expect(selection.rejected[0].rejection).toBe('NOT_FOUND');
  });

  it('rejects a file the previous context already held unchanged', () => {
    const selection = selectCandidates({
      budget: 8,
      candidates: [candidate({ alreadyInContext: true })],
    });
    expect(selection.rejected[0].rejection).toBe('ALREADY_IN_CONTEXT');
  });

  it('rejects a path that escapes the workspace', () => {
    const selection = selectCandidates({
      budget: 8,
      candidates: [candidate({ path: '../../etc/passwd' })],
    });
    expect(selection.rejected[0].rejection).toBe('OUT_OF_WORKSPACE');
  });

  it('rejects a relation impact analysis could not confirm or infer', () => {
    const selection = selectCandidates({
      budget: 8,
      candidates: [candidate({ confidence: 'UNKNOWN' })],
    });
    expect(selection.rejected[0].rejection).toBe('UNCONFIRMED_RELATION');
  });

  it('selects nothing when the budget is zero', () => {
    const selection = selectCandidates({ budget: 0, candidates: [candidate()] });
    expect(selection.selected).toEqual([]);
  });
});

describe('R3.2/R3.3 expansion trigger', () => {
  it('does not expand merely because an attempt failed', () => {
    const verdict = decideExpansion({ ...basePolicy, newCandidateCount: 5 });
    expect(verdict.decision).toBe('REPAIR_WITH_EXISTING_CONTEXT');
    expect(verdict.nextExpansionLevel).toBe(0);
  });

  it('expands when the failure names a missing artifact and a candidate exists', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      missingEvidence: [missing()],
      newCandidateCount: 1,
    });
    expect(verdict.decision).toBe('EXPAND_CONTEXT');
    expect(verdict.nextExpansionLevel).toBe(1);
  });

  it('answers NEEDS_CONTEXT when the named artifact does not exist anywhere', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      missingEvidence: [missing({ resolved: false, reference: 'src/auth/guard.ts' })],
      newCandidateCount: 0,
    });
    expect(verdict.decision).toBe('NEEDS_CONTEXT');
    expect(verdict.stopCode).toBe('NEEDS_CONTEXT');
  });

  it('keeps repairing on existing context when the named artifact is already held', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      missingEvidence: [missing({ resolved: true })],
      newCandidateCount: 0,
    });
    expect(verdict.decision).toBe('REPAIR_WITH_EXISTING_CONTEXT');
  });
});

describe('R3.18/R3.19 stop conditions', () => {
  it('stops at the expansion ceiling', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      expansionLevel: 2,
      maxContextExpansion: 2,
      missingEvidence: [missing()],
      newCandidateCount: 3,
    });
    expect(verdict.decision).toBe('STOP');
    expect(verdict.stopCode).toBe('EXPANSION_LIMIT_REACHED');
  });

  it('stops at the repair attempt ceiling before considering expansion', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      completedRepairAttempts: 2,
      missingEvidence: [missing()],
      newCandidateCount: 3,
    });
    expect(verdict.stopCode).toBe('REPAIR_LIMIT_REACHED');
  });

  it('stops when a repeated plan has nothing left to read', () => {
    const verdict = decideExpansion({ ...basePolicy, duplicatePlan: true, newCandidateCount: 0 });
    expect(verdict.decision).toBe('STOP');
    expect(verdict.stopCode).toBe('NO_NEW_CANDIDATES');
  });

  // The core no-blind-retry invariant.
  it('stops when the plan repeated and the last expansion changed nothing', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      duplicatePlan: true,
      previousExpansionYieldedEvidence: false,
      newCandidateCount: 5,
      missingEvidence: [missing()],
    });
    expect(verdict.decision).toBe('STOP');
    expect(verdict.stopCode).toBe('NO_NEW_EVIDENCE');
  });

  it('allows one bounded expansion when a repeated plan still has new evidence to read', () => {
    const verdict = decideExpansion({
      ...basePolicy,
      duplicatePlan: true,
      previousExpansionYieldedEvidence: true,
      newCandidateCount: 2,
    });
    expect(verdict.decision).toBe('EXPAND_CONTEXT');
    expect(verdict.nextExpansionLevel).toBe(1);
  });

  it('stops when repair safety already blocked the repair', () => {
    const verdict = decideExpansion({ ...basePolicy, safety: 'BLOCKED', newCandidateCount: 4 });
    expect(verdict.stopCode).toBe('BLOCKED');
  });
});

describe('R3.32 determinism', () => {
  it('produces the same verdict for the same input', () => {
    const input = { ...basePolicy, missingEvidence: [missing()], newCandidateCount: 2 };
    expect(decideExpansion(input)).toEqual(decideExpansion(input));
  });
});

describe('R3.23 impact reuse', () => {
  const analysis = {
    relations: [
      { source: 'middleware.ts', target: 'src/auth/session.ts', relationType: 'imports', confidence: 'CONFIRMED', reason: 'import statement' },
      { source: 'app/page.tsx', target: 'middleware.ts', relationType: 'imported_by', confidence: 'INFERRED', reason: 'reverse edge' },
      { source: 'unrelated.ts', target: 'other.ts', relationType: 'imports', confidence: 'CONFIRMED', reason: 'unrelated' },
    ],
  } as unknown as ImpactAnalysis;

  it('finds both directions of a relation for the anchor file', () => {
    const related = relationsFor(analysis, 'middleware.ts');
    expect(related.map(item => item.path).sort())
      .toEqual(['app/page.tsx', 'src/auth/session.ts']);
  });

  it('ignores relations that do not touch the anchor', () => {
    expect(relationsFor(analysis, 'middleware.ts').some(item => item.path === 'other.ts')).toBe(false);
  });

  it('returns nothing when there is no impact analysis at all', () => {
    expect(relationsFor(undefined, 'middleware.ts')).toEqual([]);
  });
});
