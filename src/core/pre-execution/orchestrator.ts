/**
 * G.10: DefaultPreExecutionOrchestrator — library composition of G.1–G.9.
 *
 * CANONICAL /execute PRE-EXECUTION is NOT this class. It is
 * DefaultWorkflowOrchestrator stages 1–6 plus the LLM TaskPlanner:
 *
 *   TaskIntake → Preflight+Evidence → Clarification → DecisionAdvisor
 *   → LLM TaskPlanner → PlanValidator → ContractBuilder(from LLM plan)
 *   → ExecutionGate → execute → V&V
 *
 * This orchestrator is a standalone/testable wiring of the same G.1–G.4
 * components plus ContractPlanner + PlanCritic. It has no /execute caller.
 *
 * Do not dual-run it beside Stage 1–6.
 * - ContractPlanner: deterministic template steps; duplicates LLM TaskPlanner.
 * - PlanCritic: contract critique; overlap with PlanValidator + ExecutionGate.
 *   Unique critic checks may later fold into Stage 5/6 — not a second pipeline.
 */

import { PreExecutionOrchestrator, PreExecutionResult, PreExecutionConfig, DEFAULT_PRE_EXECUTION_CONFIG } from '../../contracts/pre-execution-orchestrator';
import { TaskIntake } from '../../contracts/task-intake';
import { PreflightAnalyzer } from '../../contracts/preflight-analyzer';
import { EvidenceBuilder } from '../../contracts/evidence-builder';
import { ClarificationEngine } from '../../contracts/clarification-engine';
import { DecisionAdvisor } from '../../contracts/decision-advisor';
import { ContractPlanner } from '../../contracts/contract-planner';
import { PlanCritic } from '../../contracts/plan-critic';
import { ContractBuilder } from '../../contracts/contract-builder';
import { ExecutionGate, GateCheckInput } from '../../contracts/execution-gate';
import { TaskIntent, IntentNormalizationRequest } from '../../domain/pre-execution/intent';
import { PreExecutionState, isValidTransition } from '../../domain/pre-execution/state-machine';
import { ExecutionContract } from '../../domain/pre-execution/contract';
import { Question, QuestionResponse } from '../../domain/pre-execution/question';
import { RiskAssessment } from '../../domain/pre-execution/risk';
import { Evidence, EvidenceType } from '../../domain/pre-execution/evidence';
import { GateEvaluation, GatePolicy, DEFAULT_GATE_POLICY } from '../../domain/pre-execution/gate';
import { isReady, computeReadinessScore, ReadinessCriteria } from '../../domain/pre-execution/invariants';
import { PreflightResult } from '../../contracts/preflight-analyzer';
import { ClarificationResult } from '../../contracts/clarification-engine';
import { CritiqueResult } from '../../contracts/plan-critic';
import { ExecutionLogger } from '../observability/execution-logger';

export class DefaultPreExecutionOrchestrator implements PreExecutionOrchestrator {
  private currentState: PreExecutionState = 'INTAKE';
  private currentIntent: TaskIntent | null = null;
  private currentPreflight: PreflightResult | null = null;
  private currentEvidence: Evidence[] = [];
  private currentQuestions: Question[] = [];
  private currentRiskAssessment: RiskAssessment | null = null;
  private currentContract: ExecutionContract | null = null;
  private currentCritique: CritiqueResult | null = null;
  private currentGateEvaluation: GateEvaluation | null = null;

  constructor(
    private readonly taskIntake: TaskIntake,
    private readonly preflightAnalyzer: PreflightAnalyzer,
    private readonly evidenceBuilder: EvidenceBuilder,
    private readonly clarificationEngine: ClarificationEngine,
    private readonly decisionAdvisor: DecisionAdvisor,
    private readonly contractPlanner: ContractPlanner,
    private readonly planCritic: PlanCritic,
    private readonly contractBuilder: ContractBuilder,
    private readonly executionGate: ExecutionGate,
    private readonly gatePolicy?: GatePolicy,
  ) {}

  async run(
    rawPrompt: string,
    config?: PreExecutionConfig,
  ): Promise<PreExecutionResult> {
    const startTime = Date.now();
    const pipelineConfig = config || DEFAULT_PRE_EXECUTION_CONFIG;

    ExecutionLogger.log('PRE_EXECUTION', '-', '-', 'Starting pre-execution pipeline');

    // INTAKE → ANALYZING
    this.transitionTo('ANALYZING');

    // Step 1: Intent Normalization
    const intentResult = await this.taskIntake.normalize({
      rawPrompt,
    });
    this.currentIntent = intentResult.intent;
    this.transitionTo('INSPECTING_PROJECT');

    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      `Intent normalized: type=${intentResult.intent.type}, mode=${intentResult.intent.mode}`,
      { readinessScore: intentResult.readinessScore },
    );

    // Step 2: Preflight Inspection
    const preflight = await this.preflightAnalyzer.analyze(intentResult.intent);
    this.currentPreflight = preflight;
    this.transitionTo('IDENTIFYING_UNCERTAINTIES');

    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      `Preflight complete: framework=${preflight.inspection.framework}, feasible=${preflight.feasibility.feasible}`,
    );

    // Step 3: Evidence Collection
    if (pipelineConfig.requireEvidence) {
      const evidenceResult = await this.evidenceBuilder.collect({
        evidenceTypes: Object.freeze(['FILE_EXISTS', 'FILE_CONTENT'] as EvidenceType[]),
        targets: Object.freeze(intentResult.intent.initialScope),
      });
      this.currentEvidence = [...evidenceResult.evidence];

      ExecutionLogger.log('PRE_EXECUTION', '-', '-',
        `Evidence collected: ${this.currentEvidence.length} item(s)`,
      );
    }

    // Step 4: Risk Assessment
    const riskAssessment = await this.decisionAdvisor.assessRisk(
      intentResult.intent,
      preflight.inspection,
    );
    this.currentRiskAssessment = riskAssessment;

    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      `Risk assessed: level=${riskAssessment.level}`,
    );

    // Step 5: Clarification (if not skipped)
    if (!pipelineConfig.skipClarification) {
      const clarification = await this.clarificationEngine.generateQuestions(
        intentResult.intent,
        riskAssessment,
      );
      this.currentQuestions = [...clarification.questions];

      if (clarification.hasBlockingQuestions) {
        this.transitionTo('WAITING_FOR_USER');
        ExecutionLogger.log('PRE_EXECUTION', '-', '-',
          `Waiting for user: ${clarification.requiredQuestions.length} blocking question(s)`,
        );

        // Return early — waiting for user input
        return this.buildResult(startTime);
      }
    }

    // Step 6: Planning
    this.transitionTo('READY_FOR_PLANNING');
    this.transitionTo('PLANNING');

    const planningResult = await this.contractPlanner.plan(
      intentResult.intent,
      preflight.inspection,
      riskAssessment,
      this.currentEvidence,
    );

    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      `Planning complete: ${planningResult.stepsGenerated} step(s) generated`,
      { mode: planningResult.mode },
    );

    // Step 7: Critique (if not skipped)
    if (!pipelineConfig.skipCritique) {
      this.transitionTo('PLAN_CRITIQUE');
      const critique = await this.planCritic.critique(
        planningResult.contract,
        intentResult.intent,
        riskAssessment,
      );
      this.currentCritique = critique;

      ExecutionLogger.log('PRE_EXECUTION', '-', '-',
        `Critique complete: ${critique.recommendation}, confidence=${critique.confidenceScore}`,
      );

      if (!critique.approved) {
        this.transitionTo('BLOCKED');
        ExecutionLogger.log('PRE_EXECUTION', '-', '-',
          'Plan rejected by critic — BLOCKED',
        );
        return this.buildResult(startTime);
      }
    }

    // Step 8: Contract Building
    this.transitionTo('PLAN_VALIDATION');
    const buildResult = await this.contractBuilder.build(
      intentResult.intent,
      preflight.inspection,
      riskAssessment,
      this.currentEvidence,
      this.currentCritique || undefined,
    );
    this.currentContract = buildResult.contract;
    this.transitionTo('CONTRACT_READY');

    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      `Contract built: validated=${buildResult.validated}`,
    );

    // Step 9: Execution Gate (if not skipped)
    if (!pipelineConfig.skipGate) {
      this.transitionTo('EXECUTION_GATE');
      const gateInput: GateCheckInput = Object.freeze({
        contract: buildResult.contract,
        intent: intentResult.intent,
        riskAssessment,
        evidence: Object.freeze(this.currentEvidence),
        critiqueResult: this.currentCritique || undefined,
        userConfirmed: false,
      });

      const gateEvaluation = await this.executionGate.evaluate(
        gateInput,
        this.gatePolicy,
      );
      this.currentGateEvaluation = gateEvaluation;

      ExecutionLogger.log('PRE_EXECUTION', '-', '-',
        `Gate evaluation: decision=${gateEvaluation.decision}`,
      );

      if (this.executionGate.isBlocked(gateEvaluation)) {
        this.transitionTo('BLOCKED');
        ExecutionLogger.log('PRE_EXECUTION', '-', '-',
          'Execution BLOCKED by gate',
          { reasons: gateEvaluation.blockedReasons },
        );
        return this.buildResult(startTime);
      }
    }

    // All checks passed — ready for execution
    ExecutionLogger.log('PRE_EXECUTION', '-', '-',
      'Pre-execution pipeline complete — ready for execution',
    );

    return this.buildResult(startTime);
  }

  async answerQuestion(
    questionId: string,
    response: QuestionResponse,
  ): Promise<PreExecutionResult> {
    const startTime = Date.now();

    // Find the question
    const question = this.currentQuestions.find(q => q.id === questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    // Process response (Phase 1: just mark as answered)
    // In Phase 2, this will update the intent

    // Continue pipeline from WAITING_FOR_USER
    this.transitionTo('REANALYZING');

    // For Phase 1, just proceed to planning
    if (this.currentIntent && this.currentPreflight && this.currentRiskAssessment) {
      this.transitionTo('READY_FOR_PLANNING');
      this.transitionTo('PLANNING');

      const planningResult = await this.contractPlanner.plan(
        this.currentIntent,
        this.currentPreflight.inspection,
        this.currentRiskAssessment,
        this.currentEvidence,
      );

      // Continue with critique, contract, gate...
      // (simplified for Phase 1)
    }

    return this.buildResult(startTime);
  }

  getState(): PreExecutionState {
    return this.currentState;
  }

  isReady(): boolean {
    if (!this.currentIntent || !this.currentContract) {
      return false;
    }

    const criteria: ReadinessCriteria = Object.freeze({
      criticalInformationMissing: false,
      unresolvedRequiredQuestions: this.currentQuestions.filter(
        q => q.required && q.status === 'PENDING',
      ).length,
      feasibility: this.currentPreflight?.feasibility.feasible ? 'FEASIBLE' : 'UNKNOWN',
      planContractValid: this.currentContract.validated,
      riskPolicySatisfied: this.currentGateEvaluation
        ? this.currentGateEvaluation.decision !== 'BLOCKED'
        : true,
    });

    return isReady(criteria);
  }

  private transitionTo(newState: PreExecutionState): void {
    if (!isValidTransition(this.currentState, newState)) {
      const error = new Error(
        `Invalid state transition: ${this.currentState} → ${newState}. ` +
        `State machine enforcement prevents illegal transitions.`
      );
      ExecutionLogger.log('PRE_EXECUTION', '-', '-',
        `Invalid state transition REJECTED: ${this.currentState} → ${newState}`,
      );
      throw error;
    }
    this.currentState = newState;
  }

  private buildResult(startTime: number): PreExecutionResult {
    const durationMs = Date.now() - startTime;
    const readinessScore = this.computeCurrentReadinessScore();
    const blockedReasons = this.currentGateEvaluation
      ? this.currentGateEvaluation.blockedReasons
      : [];

    return Object.freeze({
      state: this.currentState,
      intent: this.currentIntent,
      preflight: this.currentPreflight,
      evidence: Object.freeze(this.currentEvidence),
      questions: Object.freeze(this.currentQuestions),
      riskAssessment: this.currentRiskAssessment,
      contract: this.currentContract,
      critique: this.currentCritique,
      gateEvaluation: this.currentGateEvaluation,
      readinessScore,
      blockedReasons: Object.freeze(blockedReasons),
      durationMs,
    });
  }

  private computeCurrentReadinessScore(): number {
    const criteria: ReadinessCriteria = Object.freeze({
      criticalInformationMissing: false,
      unresolvedRequiredQuestions: this.currentQuestions.filter(
        q => q.required && q.status === 'PENDING',
      ).length,
      feasibility: this.currentPreflight?.feasibility.feasible ? 'FEASIBLE' : 'UNKNOWN',
      planContractValid: this.currentContract?.validated || false,
      riskPolicySatisfied: this.currentGateEvaluation
        ? this.currentGateEvaluation.decision !== 'BLOCKED'
        : true,
    });

    return computeReadinessScore(criteria);
  }
}
