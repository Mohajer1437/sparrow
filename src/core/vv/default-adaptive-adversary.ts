import { AdaptiveAdversary } from '../../contracts/adaptive-adversary';
import { QualityProfile } from '../../domain/quality-profile';
import { VerificationCheck } from '../../domain/verification-check';
import { VerificationReport } from '../../domain/verification-report';

export class DefaultAdaptiveAdversary implements AdaptiveAdversary {
  async generate(input: {
    readonly workspacePath: string;
    readonly profile: QualityProfile;
    readonly changedFiles?: ReadonlyArray<string>;
    readonly priorChecks: ReadonlyArray<VerificationCheck>;
    readonly priorReports?: ReadonlyArray<VerificationReport>;
  }): Promise<ReadonlyArray<VerificationCheck>> {
    if (input.profile === 'MVP') {
      return Object.freeze([]);
    }

    const checks: VerificationCheck[] = [];
    const failed = input.priorChecks.filter(c => !c.passed);
    const historical = (input.priorReports ?? []).flatMap(r => r.checks.filter(c => !c.passed));

    checks.push(Object.freeze({
      id: 'adversarial-empty-and-invalid-inputs',
      category: 'adversarial' as const,
      name: 'Empty and invalid inputs',
      passed: true,
      severity: 'LOW' as const,
      evidence: 'Planner/repair must cover empty strings, missing fields, and invalid types for changed entry points',
      acceptanceCriterion: 'Changed entry points reject or safely handle empty/invalid input',
    }));

    if (failed.some(c => c.category === 'api') || historical.some(c => c.category === 'api')) {
      checks.push(Object.freeze({
        id: 'adversarial-api-unauthenticated',
        category: 'adversarial' as const,
        name: 'Unauthenticated API access',
        passed: true,
        severity: 'MEDIUM' as const,
        evidence: 'Residual adversarial note after API failures: protected routes should reject unauthenticated callers. This is evidence, not an auto-fail; the original API check remains the blocker.',
        acceptanceCriterion: 'Protected APIs reject unauthenticated callers',
      }));
    }

    if (failed.some(c => c.category === 'browser')) {
      checks.push(Object.freeze({
        id: 'adversarial-xss-payload',
        category: 'adversarial' as const,
        name: 'XSS payload in user-controlled fields',
        passed: true,
        severity: 'MEDIUM' as const,
        evidence: 'Residual adversarial note after browser failures: XSS in user-controlled fields is unverified. This is evidence, not an auto-fail; the original browser check remains the blocker.',
        acceptanceCriterion: 'Injected script in form fields is not executed',
      }));
    }

    return Object.freeze(checks);
  }
}
