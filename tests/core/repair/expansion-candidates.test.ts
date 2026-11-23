import { generateExpansionCandidates } from '../../../src/core/repair/expansion-candidates';
import { FailureContract } from '../../../src/domain/failure-contract';
import { ImpactAnalysis } from '../../../src/domain/impact-analysis';
import { MutationLedger } from '../../../src/domain/execution/mutation-safety';

function contract(over: Partial<FailureContract> = {}): FailureContract {
  return {
    id: 'fc-1',
    createdAt: new Date().toISOString(),
    qualityProfile: 'STANDARD',
    summary: 'build failed',
    failedChecks: [],
    acceptanceCriteria: [],
    repairInstructions: 'fix it',
    attempt: 1,
    ...over,
  } as FailureContract;
}

function analysis(relations: ReadonlyArray<any>, over: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return { relations, affectedTests: [], ...over } as unknown as ImpactAnalysis;
}

/** Every path in this set is treated as present on disk. */
function existsIn(...paths: string[]) {
  const set = new Set(paths);
  return (file: string) => set.has(file);
}

describe('R3.5 candidate generation is evidence-backed', () => {
  it('takes the file the failure itself reported', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      fileExists: existsIn('middleware.ts'),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      path: 'middleware.ts',
      source: 'FAILURE_REFERENCE',
      exists: true,
    });
  });

  it('takes implicated files and the failed todo files', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ implicatedFiles: ['a.ts'] }),
      failedTodoFiles: ['b.ts'],
      fileExists: existsIn('a.ts', 'b.ts'),
    });
    expect(result.candidates.map(c => c.source).sort())
      .toEqual(['FAILED_TODO_FILE', 'FAILURE_REFERENCE']);
  });

  it('follows a dependency edge from a file the failure named', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      impactAnalysis: analysis([{
        source: 'middleware.ts',
        target: 'src/auth/session.ts',
        relationType: 'imports',
        confidence: 'CONFIRMED',
        reason: 'import statement',
      }]),
      fileExists: existsIn('middleware.ts', 'src/auth/session.ts'),
    });
    const session = result.candidates.find(c => c.path === 'src/auth/session.ts');
    expect(session).toMatchObject({ source: 'IMPACT_DEPENDENCY', confidence: 'CONFIRMED' });
    expect(session?.reason).toContain('imports of middleware.ts');
  });

  it('follows a reverse dependency edge', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'lib/util.ts' } }),
      impactAnalysis: analysis([{
        source: 'app/page.tsx',
        target: 'lib/util.ts',
        relationType: 'imported_by',
        confidence: 'CONFIRMED',
        reason: 'reverse edge',
      }]),
      fileExists: existsIn('lib/util.ts', 'app/page.tsx'),
    });
    expect(result.candidates.find(c => c.path === 'app/page.tsx')?.source)
      .toBe('IMPACT_REVERSE_DEPENDENCY');
  });

  it('does not follow a relation that touches nothing the failure named', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      impactAnalysis: analysis([{
        source: 'unrelated-a.ts',
        target: 'unrelated-b.ts',
        relationType: 'imports',
        confidence: 'CONFIRMED',
        reason: 'unrelated',
      }]),
      fileExists: existsIn('middleware.ts', 'unrelated-a.ts', 'unrelated-b.ts'),
    });
    expect(result.candidates.map(c => c.path)).toEqual(['middleware.ts']);
  });

  it('picks up an affected test and a config reference from impact evidence', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      impactAnalysis: analysis(
        [{
          source: 'middleware.ts',
          target: 'next.config.js',
          relationType: 'config_reference',
          confidence: 'CONFIRMED',
          reason: 'config',
        }],
        { affectedTests: ['tests/mw.test.ts'] } as any,
      ),
      fileExists: existsIn('middleware.ts', 'next.config.js', 'tests/mw.test.ts'),
    });
    const sources = result.candidates.map(c => c.source);
    expect(sources).toContain('CONFIG_REFERENCE');
    expect(sources).toContain('FAILING_TEST');
  });

  it('produces nothing at all when there is no evidence to work from', () => {
    const result = generateExpansionCandidates({ fileExists: () => true });
    expect(result.candidates).toEqual([]);
    expect(result.missingEvidence).toEqual([]);
  });
});

describe('R3.22 mutation evidence contributes only when it is relevant', () => {
  function ledger(code: string): MutationLedger {
    return {
      results: [{
        path: 'app/page.tsx',
        status: 'ROLLED_BACK',
        findings: [{ code, level: 'LEVEL_4_EXPECTED_CHANGE', detail: 'x' }],
      }],
    } as unknown as MutationLedger;
  }

  it('treats a target whose expected change never landed as missing evidence', () => {
    const result = generateExpansionCandidates({
      mutationLedger: ledger('EXPECTED_CHANGE_MISSING'),
      fileExists: existsIn('app/page.tsx'),
    });
    expect(result.candidates[0].source).toBe('MUTATION_TARGET');
    expect(result.missingEvidence[0].kind).toBe('MISSING_MUTATION_TARGET');
  });

  it('ignores a mutation failure that says nothing about where the change belonged', () => {
    const result = generateExpansionCandidates({
      mutationLedger: ledger('WRITE_FAILED'),
      fileExists: existsIn('app/page.tsx'),
    });
    expect(result.candidates).toEqual([]);
  });

  it('does not widen scope beyond the mutation target itself', () => {
    const result = generateExpansionCandidates({
      mutationLedger: ledger('EXPECTED_CHANGE_MISSING'),
      fileExists: existsIn('app/page.tsx', 'package.json'),
    });
    expect(result.candidates.map(c => c.path)).toEqual(['app/page.tsx']);
  });
});

describe('R3.8 files already in context are not counted as new evidence', () => {
  it('marks an unchanged held file as already in context', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      previousContext: [{ path: 'middleware.ts', fingerprint: 'v1' }],
      fileExists: existsIn('middleware.ts'),
      fingerprintOf: () => 'v1',
    });
    expect(result.candidates[0].alreadyInContext).toBe(true);
  });

  it('treats a held file whose content moved on as new evidence again', () => {
    const result = generateExpansionCandidates({
      failureContract: contract({ location: { file: 'middleware.ts' } }),
      previousContext: [{ path: 'middleware.ts', fingerprint: 'v1' }],
      fileExists: existsIn('middleware.ts'),
      fingerprintOf: () => 'v2',
    });
    expect(result.candidates[0].alreadyInContext).toBe(false);
  });
});
