import { emptyRepairHistory } from '../../../src/domain/repair-intelligence';
import { appendRepairAttempt } from '../../../src/core/repair/repair-attempt-history';
import { isDuplicateRepairPlan } from '../../../src/core/repair/duplicate-repair-plan';

const fingerprint = 'middleware.ts::modify|Change middleware|middleware.ts';

describe('duplicate repair detection', () => {
  it('detects an equivalent retry', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'REPAIR',
      todoIds: ['todo-1'],
      planFingerprint: fingerprint,
      filesTouched: ['middleware.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: ['check-1'],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    expect(isDuplicateRepairPlan({
      history,
      nextFingerprint: fingerprint,
      expansionLevel: 0,
      evidenceRefs: ['check-1'],
    })).toBe(true);
  });

  it('allows a new attempt when additional evidence exists', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'REPAIR',
      todoIds: ['todo-1'],
      planFingerprint: fingerprint,
      filesTouched: ['middleware.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: ['check-1'],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    expect(isDuplicateRepairPlan({
      history,
      nextFingerprint: fingerprint,
      expansionLevel: 0,
      evidenceRefs: ['check-1', 'check-2'],
    })).toBe(false);
  });

  it('allows a new attempt after deterministic context expansion', () => {
    const history = appendRepairAttempt(emptyRepairHistory(), {
      kind: 'REPAIR',
      todoIds: ['todo-1'],
      planFingerprint: fingerprint,
      filesTouched: ['middleware.ts'],
      verificationScope: 'WHOLE_RUN',
      evidenceRefs: ['check-1'],
      expansionLevel: 0,
      outcome: 'FAILED',
    });
    expect(isDuplicateRepairPlan({
      history,
      nextFingerprint: fingerprint,
      expansionLevel: 1,
      evidenceRefs: ['check-1'],
    })).toBe(false);
  });
});
