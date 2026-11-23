import { emptyRepairHistory } from '../../../src/domain/repair-intelligence';
import { appendRepairAttempt } from '../../../src/core/repair/repair-attempt-history';

function attempt(partial: { attemptId?: string; filesTouched?: string[] } = {}) {
  return {
    kind: 'REPAIR' as const,
    todoIds: ['todo-1'],
    planFingerprint: 'app/page.tsx::modify|Edit|app/page.tsx',
    filesTouched: partial.filesTouched ?? ['app/page.tsx'],
    verificationScope: 'WHOLE_RUN' as const,
    evidenceRefs: ['check-1'],
    expansionLevel: 0,
    outcome: 'FAILED' as const,
    attemptId: partial.attemptId,
  };
}

describe('repair attempt history', () => {
  it('records the first attempt', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), attempt());
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0].attemptId).toBe('attempt-1');
  });

  it('appends a second attempt without overwriting the first', () => {
    const first = appendRepairAttempt(emptyRepairHistory(), attempt());
    const second = appendRepairAttempt(first, attempt({ filesTouched: ['middleware.ts'] }));
    expect(second.attempts).toHaveLength(2);
    expect(second.attempts[0].attemptId).toBe('attempt-1');
    expect(second.attempts[0].filesTouched).toEqual(['app/page.tsx']);
    expect(second.attempts[1].attemptId).toBe('attempt-2');
    expect(second.attempts[1].filesTouched).toEqual(['middleware.ts']);
  });

  it('keeps attempt IDs stable', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), attempt({ attemptId: 'attempt-1' }));
    expect(history.attempts[0].attemptId).toBe('attempt-1');
    expect(() => appendRepairAttempt(history, attempt({ attemptId: 'attempt-1' }))).toThrow(/append-only/);
  });
});
