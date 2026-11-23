/**
 * G.4: DefaultDecisionAdvisor — Risk & Impact Analysis
 * FIXED: Uses proper RiskLevel typing
 */

import { DecisionAdvisor, DecisionOption, DecisionAnalysis, ImpactAnalysis } from '../../contracts/decision-advisor';
import { RiskLevel, RiskAssessment } from '../../domain/pre-execution/risk';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { ProjectInspection } from '../../contracts/preflight-analyzer';

const HIGH_RISK_KEYWORDS = [
  'delete', 'remove', 'drop', 'destroy', 'migrate', 'schema', 'database',
  'auth', 'authentication', 'password', 'token', 'production', 'deploy',
  'breaking', 'major', 'breaking change',
];

const MEDIUM_RISK_KEYWORDS = [
  'update', 'upgrade', 'change', 'modify', 'refactor', 'restructure',
  'api', 'endpoint', 'config', 'configuration',
];

export class DefaultDecisionAdvisor implements DecisionAdvisor {
  async analyzeOptions(
    intent: TaskIntent,
    inspection: ProjectInspection,
  ): Promise<DecisionAnalysis> {
    const options = this.generateOptions(intent, inspection);
    const riskAssessment = await this.assessRisk(intent, inspection);
    const recommendation = this.determineRecommendation(options, riskAssessment);
    const reasoning = this.generateReasoning(options, recommendation, riskAssessment);

    return Object.freeze({
      options: Object.freeze(options),
      recommendation,
      reasoning,
      riskAssessment,
    });
  }

  async assessRisk(
    intent: TaskIntent,
    inspection: ProjectInspection,
  ): Promise<RiskAssessment> {
    const prompt = this.stripNegatedSpans(`${intent.rawPrompt} ${intent.objective}`.toLowerCase());

    const hasHighRisk = this.containsKeyword(prompt, HIGH_RISK_KEYWORDS);
    const hasMediumRisk = this.containsKeyword(prompt, MEDIUM_RISK_KEYWORDS);
    const fileCount = intent.initialScope.length;
    
    let level: RiskLevel;
    const factors: string[] = [];
    
    if (intent.type === 'INVESTIGATION' || (intent as any).requiresMutation === false) {
      level = 'LOW';
      factors.push('Read-only investigation or analysis task');
    } else if (hasHighRisk) {
      level = 'HIGH';
      factors.push('High-risk operation detected (delete, migrate, auth, production)');
    } else if (fileCount > 5) {
      level = 'HIGH';
      factors.push(`Large scope: ${fileCount} files affected`);
    } else if (hasMediumRisk || fileCount > 2) {
      level = 'MEDIUM';
      factors.push('Medium-risk operation or moderate scope');
    } else {
      level = 'LOW';
      factors.push('Low-risk operation with limited scope');
    }
    
    const reversible = !hasHighRisk || intent.type === 'FEATURE';
    const requiresConfirmation = level === 'HIGH';
    const safeExperimentRecommended = level === 'HIGH';

    return Object.freeze({
      level,
      explanation: `Risk level: ${level}. ${factors.join('. ')}`,
      factors: Object.freeze(factors),
      reversible,
      estimatedFilesAffected: fileCount,
      requiresConfirmation,
      safeExperimentRecommended,
    });
  }

  async analyzeImpact(
    intent: TaskIntent,
    inspection: ProjectInspection,
  ): Promise<ImpactAnalysis> {
    const fileCount = intent.initialScope.length;
    
    let complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    if (fileCount > 5 || intent.mode === 'HARD') {
      complexity = 'HIGH';
    } else if (fileCount > 2 || intent.mode === 'MEDIUM') {
      complexity = 'MEDIUM';
    } else {
      complexity = 'LOW';
    }
    
    const boundaries: string[] = [];
    const scopeStr = intent.initialScope.join(' ').toLowerCase();
    
    if (scopeStr.includes('api') || scopeStr.includes('route')) boundaries.push('API boundary');
    if (scopeStr.includes('test') || scopeStr.includes('spec')) boundaries.push('Test boundary');
    if (scopeStr.includes('config') || scopeStr.includes('.env')) boundaries.push('Configuration boundary');
    if (scopeStr.includes('database') || scopeStr.includes('schema')) boundaries.push('Database boundary');
    
    const requiresSafeExperiment = complexity === 'HIGH' && boundaries.length > 0;

    return Object.freeze({
      estimatedFilesAffected: fileCount,
      estimatedComplexity: complexity,
      boundariesCrossed: Object.freeze(boundaries),
      requiresSafeExperiment,
    });
  }

  private generateOptions(intent: TaskIntent, inspection: ProjectInspection): DecisionOption[] {
    const options: DecisionOption[] = [];

    options.push(Object.freeze({
      id: 'conservative',
      label: 'Conservative',
      description: 'Minimal changes, preserve existing code as much as possible',
      risk: 'LOW' as RiskLevel,
      impact: 'Limited changes, low risk of breaking existing functionality',
      reversibility: 'REVERSIBLE',
    }));

    options.push(Object.freeze({
      id: 'balanced',
      label: 'Balanced',
      description: 'Standard approach with reasonable changes',
      risk: 'MEDIUM' as RiskLevel,
      impact: 'Moderate changes, some risk of side effects',
      reversibility: 'PARTIALLY_REVERSIBLE',
    }));

    if (intent.type === 'REFACTOR' || intent.type === 'FEATURE') {
      options.push(Object.freeze({
        id: 'aggressive',
        label: 'Aggressive',
        description: 'Comprehensive changes, optimize for best outcome',
        risk: 'HIGH' as RiskLevel,
        impact: 'Significant changes, higher risk but potentially better results',
        reversibility: 'PARTIALLY_REVERSIBLE',
      }));
    }

    return options;
  }

  private determineRecommendation(options: DecisionOption[], riskAssessment: RiskAssessment): string {
    if (riskAssessment.level === 'HIGH') return 'conservative';
    if (riskAssessment.level === 'MEDIUM') return 'balanced';
    return 'balanced';
  }

  private generateReasoning(options: DecisionOption[], recommendation: string, riskAssessment: RiskAssessment): string {
    const recommended = options.find(o => o.id === recommendation);
    if (!recommended) return 'No reasoning available';
    return `Recommended "${recommended.label}" approach due to risk level: ${riskAssessment.level}. ${riskAssessment.explanation}`;
  }

  private stripNegatedSpans(text: string): string {
    return text.replace(/\b(do not|don't|dont|without)\b[\s\S]{0,100}/gi, ' ');
  }

  private containsKeyword(text: string, keywords: readonly string[]): boolean {
    return keywords.some((kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    });
  }
}
