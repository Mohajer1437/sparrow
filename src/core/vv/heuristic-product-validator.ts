import { ProductValidator } from '../../contracts/product-validator';
import {
  formatAssumption,
  formatCheckpointQuestion,
  formatRisk,
  ProductAnalysis,
  ProductValidationRequest,
} from '../../domain/product-analysis';
import { buildExtractedIntent, looksLikeApi, looksLikeUi, readRepoSignals } from './product-intent-extract';

export class HeuristicProductValidator implements ProductValidator {
  async analyze(request: ProductValidationRequest): Promise<ProductAnalysis> {
    const task = request.task || '';
    const signals = await readRepoSignals(request.workspacePath, request.qualityProfile);
    const extracted = buildExtractedIntent(request, {
      ...signals,
      evidence: [...signals.evidence, ...(request.projectSignals ?? [])],
    });

    const blockingQuestions = extracted.checkpointQuestions.map(formatCheckpointQuestion);
    const assumptions = extracted.assumptions.map(formatAssumption);
    const risks = extracted.risks.map(formatRisk);
    const isUi = looksLikeUi(task);
    const isApi = looksLikeApi(task);

    return Object.freeze({
      objective: extracted.intent.userGoal || task.trim() || 'Unspecified objective',
      productUnderstanding: this.summarize(extracted.intent.userGoal, isUi, isApi, extracted.intent.actors),
      acceptanceCriteria: Object.freeze(extracted.acceptanceCriteria.slice()),
      risks: Object.freeze(risks),
      verificationRequirements: Object.freeze(extracted.verificationRequirements.slice()),
      assumptions: Object.freeze(assumptions),
      blockingQuestions: Object.freeze(blockingQuestions),
      materialAmbiguities: Object.freeze(extracted.materialAmbiguityIds.slice()),
      qualityProfile: request.qualityProfile,
      intent: Object.freeze({
        userGoal: extracted.intent.userGoal,
        requestedCapabilities: Object.freeze(extracted.intent.requestedCapabilities.slice()),
        actors: Object.freeze(extracted.intent.actors.slice()),
        expectedOutcomes: Object.freeze(extracted.intent.expectedOutcomes.slice()),
        importantConstraints: Object.freeze(extracted.intent.importantConstraints.slice()),
      }),
      structuredAssumptions: Object.freeze(extracted.assumptions.slice()),
      ambiguities: Object.freeze(extracted.ambiguities.slice()),
      structuredRisks: Object.freeze(extracted.risks.slice()),
      checkpointQuestions: Object.freeze(extracted.checkpointQuestions.slice()),
    });
  }

  private summarize(goal: string, isUi: boolean, isApi: boolean, actors: ReadonlyArray<string>): string {
    const surfaces = [isUi ? 'UI' : null, isApi ? 'API' : null].filter(Boolean).join(' and ') || 'product';
    const who = actors.length > 0 ? ' Actors: ' + actors.join(', ') + '.' : '';
    return 'Deliver "' + goal + '" on the ' + surfaces + ' surface while preserving out-of-scope behavior.' + who;
  }
}
