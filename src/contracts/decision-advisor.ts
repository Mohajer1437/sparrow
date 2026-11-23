/**
 * G.4: DecisionAdvisor Contract
 */

import { RiskLevel, RiskAssessment } from '../domain/pre-execution/risk';
import { TaskIntent } from '../domain/pre-execution/intent';
import { ProjectInspection } from './preflight-analyzer';

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly risk: RiskLevel;
  readonly impact: string;
  readonly reversibility: 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';
}

export interface DecisionAnalysis {
  readonly options: ReadonlyArray<DecisionOption>;
  readonly recommendation: string;
  readonly reasoning: string;
  readonly riskAssessment: RiskAssessment;
}

export interface ImpactAnalysis {
  readonly estimatedFilesAffected: number;
  readonly estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly boundariesCrossed: ReadonlyArray<string>;
  readonly requiresSafeExperiment: boolean;
}

export interface DecisionAdvisor {
  analyzeOptions(intent: TaskIntent, inspection: ProjectInspection): Promise<DecisionAnalysis>;
  assessRisk(intent: TaskIntent, inspection: ProjectInspection): Promise<RiskAssessment>;
  analyzeImpact(intent: TaskIntent, inspection: ProjectInspection): Promise<ImpactAnalysis>;
}
