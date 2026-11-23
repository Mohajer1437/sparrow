import { QualityProfile } from './quality-profile';

/** How an uncertainty should be handled before planning. */
export type AmbiguityClassification = 'SAFE_ASSUMPTION' | 'NON_BLOCKING' | 'BLOCKING';

export type AssumptionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type AssumptionImpact = 'Low' | 'Medium' | 'High';

/** Product-risk categories (not a security engine). */
export type ProductRiskCategory =
  | 'Functional'
  | 'Data Integrity'
  | 'Authorization'
  | 'Authentication'
  | 'User State'
  | 'Concurrency'
  | 'Failure Handling'
  | 'Destructive Behavior'
  | 'External Dependency'
  | 'UX Criticality';

export type ProductRiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Structured meaning extracted from the user request.
 * This is not a dump of the raw prompt.
 */
export interface ProductIntent {
  /** What the user is trying to accomplish. */
  readonly userGoal: string;
  /** Capabilities the user asked for, without invented extras. */
  readonly requestedCapabilities: ReadonlyArray<string>;
  /** Actors that are explicit or strongly implied. Empty if none. */
  readonly actors: ReadonlyArray<string>;
  /** What the user should observe after the feature is complete. */
  readonly expectedOutcomes: ReadonlyArray<string>;
  /** Explicit constraints that must not be lost during planning. */
  readonly importantConstraints: ReadonlyArray<string>;
}

export interface ProductAssumption {
  readonly statement: string;
  readonly reason: string;
  readonly confidence: AssumptionConfidence;
  readonly impact: AssumptionImpact;
}

export interface ProductAmbiguity {
  readonly id: string;
  readonly text: string;
  readonly classification: AmbiguityClassification;
  readonly reason: string;
}

export interface ProductRisk {
  readonly category: ProductRiskCategory;
  readonly description: string;
  readonly severity: ProductRiskSeverity;
}

/** Precise question for the single human checkpoint. */
export interface CheckpointQuestion {
  readonly id: string;
  readonly question: string;
  readonly context: string;
  readonly options?: ReadonlyArray<string>;
}

export interface ResolvedProductAnswer {
  readonly question: string;
  readonly answer: string;
}

export interface ProductAnalysis {
  readonly objective: string;
  readonly productUnderstanding: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
  readonly verificationRequirements: ReadonlyArray<string>;
  readonly assumptions: ReadonlyArray<string>;
  readonly blockingQuestions: ReadonlyArray<string>;
  readonly materialAmbiguities: ReadonlyArray<string>;
  readonly qualityProfile: QualityProfile;
  readonly intent: ProductIntent;
  readonly structuredAssumptions: ReadonlyArray<ProductAssumption>;
  readonly ambiguities: ReadonlyArray<ProductAmbiguity>;
  readonly structuredRisks: ReadonlyArray<ProductRisk>;
  readonly checkpointQuestions: ReadonlyArray<CheckpointQuestion>;
}

export interface ProductValidationRequest {
  readonly task: string;
  readonly qualityProfile: QualityProfile;
  readonly workspacePath?: string;
  readonly intakeAmbiguities?: ReadonlyArray<string>;
  readonly clarificationQuestions?: ReadonlyArray<string>;
  readonly riskLevel?: string;
  readonly projectSignals?: ReadonlyArray<string>;
  readonly resolvedAnswers?: ReadonlyArray<ResolvedProductAnswer>;
}

export function formatAssumption(item: ProductAssumption): string {
  return item.statement
    + ' (reason: ' + item.reason
    + '; confidence: ' + item.confidence
    + '; impact: ' + item.impact + ')';
}

export function formatRisk(item: ProductRisk): string {
  return '[' + item.category + '][' + item.severity + '] ' + item.description;
}

export function formatCheckpointQuestion(item: CheckpointQuestion): string {
  const options = item.options && item.options.length > 0
    ? ' Options: ' + item.options.join(' | ')
    : '';
  return item.question + options;
}

/**
 * Structured Planner handoff. Not a raw prompt dump.
 */
export function formatProductAnalysis(analysis: ProductAnalysis): string {
  const intent = analysis.intent;
  const lines: string[] = [
    'USER GOAL: ' + (intent?.userGoal || analysis.objective),
    'REQUESTED CAPABILITIES: ' + ((intent?.requestedCapabilities || []).join('; ') || '(none stated)'),
    'ACTORS: ' + ((intent?.actors || []).join(', ') || '(none stated)'),
    'EXPECTED OUTCOMES:',
    ...((intent?.expectedOutcomes || []).length
      ? (intent.expectedOutcomes).map(item => '- ' + item)
      : ['- (none stated)']),
    'EXPLICIT CONSTRAINTS:',
    ...((intent?.importantConstraints || []).length
      ? intent.importantConstraints.map(item => '- ' + item)
      : ['- (none stated)']),
    'ACCEPTANCE CRITERIA:',
    ...(analysis.acceptanceCriteria.length
      ? analysis.acceptanceCriteria.map(item => '- ' + item)
      : ['- (none)']),
    'RESOLVED ASSUMPTIONS:',
    ...(analysis.structuredAssumptions.length
      ? analysis.structuredAssumptions.map(item => '- ' + formatAssumption(item))
      : (analysis.assumptions.length ? analysis.assumptions.map(item => '- ' + item) : ['- (none)'])),
    'PRODUCT RISKS:',
    ...(analysis.structuredRisks.length
      ? analysis.structuredRisks.map(item => '- ' + formatRisk(item))
      : (analysis.risks.length ? analysis.risks.map(item => '- ' + item) : ['- (none)'])),
    'VERIFICATION REQUIREMENTS: ' + (analysis.verificationRequirements.join(', ') || '(none)'),
    'AMBIGUITIES:',
    ...(analysis.ambiguities.length
      ? analysis.ambiguities.map(item => '- [' + item.classification + '] ' + item.text + ' — ' + item.reason)
      : ['- (none)']),
  ];
  if (analysis.checkpointQuestions.length > 0) {
    lines.push('BLOCKING QUESTIONS (single human checkpoint):');
    for (const question of analysis.checkpointQuestions) {
      lines.push('- ' + formatCheckpointQuestion(question));
      lines.push('  Context: ' + question.context);
    }
  }
  return lines.join('\n');
}

/** Repair must not re-open the pre-planning human checkpoint. */
export function shouldAbortForProductCheckpoint(
  analysis: ProductAnalysis,
  hasFailureContract?: boolean,
): boolean {
  return analysis.blockingQuestions.length > 0 && !hasFailureContract;
}
