/**
 * Milestone F: Risk-Based Regression Plan Domain Model.
 * Connects Impact Analysis, Risk levels, and Skills to deterministic verification checks.
 */

import { TodoRiskLevel } from './todo-plan';

export interface SkippedRegressionCheck {
  readonly check: string;
  readonly reason: string;
}

export interface RegressionPlan {
  readonly id: string;
  readonly risk: TodoRiskLevel;
  readonly directChecks: ReadonlyArray<string>;
  readonly expandedChecks: ReadonlyArray<string>;
  readonly selectedChecks: ReadonlyArray<string>;
  readonly skippedChecks: ReadonlyArray<SkippedRegressionCheck>;
  readonly affectedArtifacts: ReadonlyArray<string>;
  readonly verifiedArtifacts: ReadonlyArray<string>;
  readonly unverifiedArtifacts: ReadonlyArray<string>;
  readonly reasons: ReadonlyArray<string>;
  readonly policy: string;
  readonly impactSummary?: string;
  readonly generatedAt: string;
}

export function freezeSkippedRegressionCheck(skipped: SkippedRegressionCheck): SkippedRegressionCheck {
  return Object.freeze({
    check: skipped.check,
    reason: skipped.reason,
  });
}

export function freezeRegressionPlan(plan: RegressionPlan): RegressionPlan {
  return Object.freeze({
    id: plan.id,
    risk: plan.risk,
    directChecks: Object.freeze([...plan.directChecks]),
    expandedChecks: Object.freeze([...plan.expandedChecks]),
    selectedChecks: Object.freeze([...plan.selectedChecks]),
    skippedChecks: Object.freeze(plan.skippedChecks.map(freezeSkippedRegressionCheck)),
    affectedArtifacts: Object.freeze([...plan.affectedArtifacts]),
    verifiedArtifacts: Object.freeze([...plan.verifiedArtifacts]),
    unverifiedArtifacts: Object.freeze([...plan.unverifiedArtifacts]),
    reasons: Object.freeze([...plan.reasons]),
    policy: plan.policy,
    impactSummary: plan.impactSummary,
    generatedAt: plan.generatedAt,
  });
}

export function formatRegressionPlanSummary(plan: RegressionPlan): string {
  return [
    `risk=${plan.risk}`,
    `selectedChecks=[${plan.selectedChecks.join(', ')}]`,
    `direct=${plan.directChecks.length}`,
    `expanded=${plan.expandedChecks.length}`,
    `skipped=${plan.skippedChecks.length}`,
    `affected=${plan.affectedArtifacts.length}`,
    `verified=${plan.verifiedArtifacts.length}`,
    `unverified=${plan.unverifiedArtifacts.length}`,
    `policy=${plan.policy}`,
  ].join('; ');
}
