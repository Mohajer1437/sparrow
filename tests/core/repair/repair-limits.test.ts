import { evaluateRepairLimits } from '../../../src/core/repair/repair-limits';
import { expandRepairFiles } from '../../../src/core/repair/repair-context';
import { emptyRepairHistory } from '../../../src/domain/repair-intelligence';
import { appendRepairAttempt } from '../../../src/core/repair/repair-attempt-history';

const limits = { maxRepairAttempts: 2, maxContextExpansion: 1, maxRepairFiles: 3 };

function repairAttempt() {
  return {
    kind: 'REPAIR' as const,
    todoIds: ['todo-1'],
    planFingerprint: 'a.ts::modify|x|a.ts',
    filesTouched: ['a.ts'],
    verificationScope: 'WHOLE_RUN' as const,
    evidenceRefs: ['c1'],
    expansionLevel: 0,
    outcome: 'FAILED' as const,
  };
}

describe('repair limits', () => {
  it('reaches max attempts with an explicit limit state', () => {
    let history = emptyRepairHistory();
    history = appendRepairAttempt(history, repairAttempt());
    history = appendRepairAttempt(history, repairAttempt());
    expect(evaluateRepairLimits({
      history,
      limits,
      expansionLevel: 0,
      candidateFileCount: 1,
      startingRepair: true,
    })).toBe('REPAIR_LIMIT_REACHED');
  });

  it('reaches max context expansion with an explicit limit state', () => {
    expect(evaluateRepairLimits({
      history: emptyRepairHistory(),
      limits,
      expansionLevel: 2,
      candidateFileCount: 1,
      startingRepair: false,
    })).toBe('REPAIR_LIMIT_REACHED');
  });

  it('caps max repair files and does not expand without bound', () => {
    const files = expandRepairFiles(['app/api/save/route.ts'], 2, 3);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('does not treat the original failure as a repair attempt', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), {
      ...repairAttempt(),
      kind: 'ORIGINAL',
    });
    expect(evaluateRepairLimits({
      history,
      limits,
      expansionLevel: 0,
      candidateFileCount: 1,
      startingRepair: true,
    })).toBeUndefined();
  });
});
