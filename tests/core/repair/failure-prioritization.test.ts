import { prioritizeFailures } from '../../../src/core/repair/failure-prioritizer';
import { VerificationCheck } from '../../../src/domain/verification-check';

function check(partial: Partial<VerificationCheck> & Pick<VerificationCheck, 'id'>): VerificationCheck {
  return {
    category: 'deterministic',
    name: partial.id,
    passed: false,
    severity: 'HIGH',
    evidence: partial.id,
    ...partial,
  };
}

describe('failure prioritization', () => {
  const authzCriterion = 'Unauthenticated POST /api/save must return 401 or 403.';
  const checks: VerificationCheck[] = [
    check({
      id: 'browser-dom-text-home',
      category: 'browser',
      evidence: 'missing visible text: Foo',
    }),
    check({
      id: 'api-runtime',
      category: 'api',
      evidence: 'HTTP API server is not reachable',
      acceptanceCriterion: 'HTTP API server is reachable for discovered routes',
    }),
    check({
      id: 'intent-authz-post--api-save',
      category: 'api',
      evidence: 'Expected: 401|403; Actual: 500',
      acceptanceCriterion: authzCriterion,
    }),
  ];

  it('keeps primary primary, secondary secondary, and incidental as noise', () => {
    const ranked = prioritizeFailures(checks, [authzCriterion]);
    expect(ranked.map(item => [item.classification, item.check.id])).toEqual([
      ['PRIMARY', 'intent-authz-post--api-save'],
      ['SECONDARY', 'api-runtime'],
      ['INCIDENTAL', 'browser-dom-text-home'],
    ]);
  });

  it('is deterministic across input order', () => {
    const reversed = prioritizeFailures([...checks].reverse(), [authzCriterion]);
    const original = prioritizeFailures(checks, [authzCriterion]);
    expect(reversed.map(item => item.check.id)).toEqual(original.map(item => item.check.id));
    expect(reversed.map(item => item.classification)).toEqual(original.map(item => item.classification));
  });

  it('repeats the same prioritization', () => {
    const first = prioritizeFailures(checks, [authzCriterion]);
    const second = prioritizeFailures(checks, [authzCriterion]);
    expect(second).toEqual(first);
  });
});
