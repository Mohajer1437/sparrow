/**
 * Milestone F: Regression Selector Contract.
 * Selects deterministic, risk-based regression checks based on ImpactAnalysis, TodoPlan, Risk, and Skills.
 */

import { ImpactAnalysis, ImpactReport } from '../domain/impact-analysis';
import { RegressionPlan } from '../domain/regression-plan';
import { TodoPlan, TodoRiskLevel } from '../domain/todo-plan';
import { Skill } from '../domain/skill';
import { VersionIntelligenceContext } from '../domain/version-intelligence';

export interface RegressionSelectionInput {
  readonly todoPlan?: TodoPlan | null;
  readonly impactAnalysis?: ImpactAnalysis | null;
  readonly impactReport?: ImpactReport | null;
  readonly changedFiles: ReadonlyArray<string>;
  readonly risk?: TodoRiskLevel;
  readonly skills?: ReadonlyArray<Skill>;
  readonly versionIntelligence?: VersionIntelligenceContext;
  readonly securitySensitive?: boolean;
}

export interface RegressionSelector {
  selectRegression(input: RegressionSelectionInput): Promise<RegressionPlan>;
}
