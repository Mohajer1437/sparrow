/**
 * G.3: DefaultClarificationEngine — Question Generation
 * 
 * Generates questions only when they change the plan or execution.
 * Phase 1: Deterministic question generation from ambiguities.
 * Ambiguities may be supplied explicitly by the workflow.
 * Ambiguities may be supplied explicitly by the workflow.
 */

import { ClarificationEngine, ClarificationResult } from '../../contracts/clarification-engine';
import { Question, QuestionOption, QuestionType, QuestionImpact } from '../../domain/pre-execution/question';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { RiskAssessment } from '../../domain/pre-execution/risk';

export class DefaultClarificationEngine implements ClarificationEngine {
  async generateQuestions(
    intent: TaskIntent,
    riskAssessment: RiskAssessment,
    ambiguities?: ReadonlyArray<string>,
  ): Promise<ClarificationResult> {
    const questions: Question[] = [];
    let questionIndex = 0;

    // Generate questions from ambiguities
    const ambiguityItems = ambiguities ?? (intent as any).ambiguities ?? [];
    for (const ambiguity of ambiguityItems) {
      const question = this.generateQuestionFromAmbiguity(
        `q-${questionIndex++}`,
        ambiguity,
        intent,
        riskAssessment,
      );
      if (question) {
        questions.push(question);
      }
    }

    // Generate questions for high-risk operations
    if (riskAssessment.level === 'HIGH' && intent.type !== 'INVESTIGATION') {
      const riskQuestion = this.generateRiskConfirmationQuestion(
        `q-${questionIndex++}`,
        riskAssessment,
      );
      questions.push(riskQuestion);
    }

    // Separate required and optional questions
    const requiredQuestions = questions.filter(q => q.required);
    const optionalQuestions = questions.filter(q => !q.required);
    const hasBlockingQuestions = requiredQuestions.length > 0;

    return Object.freeze({
      questions: Object.freeze(questions),
      requiredQuestions: Object.freeze(requiredQuestions),
      optionalQuestions: Object.freeze(optionalQuestions),
      hasBlockingQuestions,
    });
  }

  async processResponse(
    question: Question,
    response: import('../../domain/pre-execution/question').QuestionResponse,
  ): Promise<TaskIntent> {
    // Phase 1: Just return the original intent
    // In Phase 2, we'll update the intent based on response
    throw new Error('processResponse not yet implemented in Phase 1');
  }

  private generateQuestionFromAmbiguity(
    id: string,
    ambiguity: string,
    intent: TaskIntent,
    riskAssessment: RiskAssessment,
  ): Question | null {
    // Only generate questions for plan-changing ambiguities
    const isPlanChanging = this.isPlanChangingAmbiguity(ambiguity);
    if (!isPlanChanging) {
      return null; // Skip non-plan-changing questions
    }

    // Generate options based on ambiguity type
    const options = this.generateOptionsForAmbiguity(ambiguity, intent);
    if (options.length === 0) {
      return null;
    }

    // Determine recommendation
    const recommendation = options[0].id; // First option is usually safest

    // Determine if required
    const required = intent.type !== 'INVESTIGATION' && (
      riskAssessment.level === 'HIGH' ||
      ambiguity.includes('No specific file')
    );

    return Object.freeze({
      id,
      reason: `Ambiguity detected: ${ambiguity}`,
      question: this.formatQuestion(ambiguity),
      type: 'single_choice' as QuestionType,
      recommendation,
      options: Object.freeze(options),
      required,
      affects: Object.freeze(['PLAN_CHANGING'] as QuestionImpact[]),
      status: 'PENDING',
    });
  }

  private generateRiskConfirmationQuestion(
    id: string,
    riskAssessment: RiskAssessment,
  ): Question {
    const options: QuestionOption[] = [
      Object.freeze({
        id: 'proceed',
        label: 'Proceed with caution',
        description: 'Continue with the high-risk operation',
        risk: 'HIGH',
        consequences: Object.freeze(['Changes may be difficult to reverse']),
        affects: Object.freeze(['EXECUTION_CHANGING']),
      }),
      Object.freeze({
        id: 'safe_experiment',
        label: 'Run safe experiment first',
        description: 'Test the change in an isolated environment before applying',
        risk: 'LOW',
        consequences: Object.freeze(['Slower but safer approach']),
        affects: Object.freeze(['EXECUTION_CHANGING']),
      }),
      Object.freeze({
        id: 'abort',
        label: 'Abort',
        description: 'Do not proceed with this operation',
        risk: 'LOW',
        consequences: Object.freeze(['No changes will be made']),
        affects: Object.freeze(['EXECUTION_CHANGING']),
      }),
    ];

    return Object.freeze({
      id,
      reason: `High-risk operation detected: ${riskAssessment.explanation}`,
      question: 'This is a high-risk operation. How would you like to proceed?',
      type: 'single_choice' as QuestionType,
      recommendation: 'safe_experiment',
      options: Object.freeze(options),
      required: true,
      affects: Object.freeze(['EXECUTION_CHANGING', 'RISK_CHANGING'] as QuestionImpact[]),
      status: 'PENDING',
    });
  }

  private isPlanChangingAmbiguity(ambiguity: string): boolean {
    const planChangingKeywords = [
      'No specific file',
      'No clear success criteria',
      'Multiple objectives',
      'Scope may be too broad',
    ];
    return planChangingKeywords.some(kw => ambiguity.includes(kw));
  }

  private generateOptionsForAmbiguity(
    ambiguity: string,
    intent: TaskIntent,
  ): QuestionOption[] {
    const options: QuestionOption[] = [];

    if (ambiguity.includes('No specific file')) {
      options.push(
        Object.freeze({
          id: 'specify_files',
          label: 'I will specify the files',
          description: 'Please provide the specific file paths to modify',
          risk: 'LOW',
          consequences: Object.freeze(['Execution will target only specified files']),
          affects: Object.freeze(['SCOPE_CHANGING']),
        }),
        Object.freeze({
          id: 'auto_detect',
          label: 'Auto-detect files',
          description: 'Let the agent detect relevant files automatically',
          risk: 'MEDIUM',
          consequences: Object.freeze(['Agent may modify more files than expected']),
          affects: Object.freeze(['SCOPE_CHANGING']),
        }),
      );
    }

    if (ambiguity.includes('No clear success criteria')) {
      options.push(
        Object.freeze({
          id: 'provide_criteria',
          label: 'I will provide success criteria',
          description: 'Please specify what "done" means for this task',
          risk: 'LOW',
          consequences: Object.freeze(['Execution will verify against your criteria']),
          affects: Object.freeze(['PLAN_CHANGING']),
        }),
        Object.freeze({
          id: 'default_criteria',
          label: 'Use default criteria',
          description: 'Use standard success criteria (build passes, no errors)',
          risk: 'MEDIUM',
          consequences: Object.freeze(['May not fully meet your expectations']),
          affects: Object.freeze(['PLAN_CHANGING']),
        }),
      );
    }

    if (ambiguity.includes('Multiple objectives')) {
      options.push(
        Object.freeze({
          id: 'split_tasks',
          label: 'Split into separate tasks',
          description: 'Break this into multiple smaller tasks',
          risk: 'LOW',
          consequences: Object.freeze(['Each task will be planned separately']),
          affects: Object.freeze(['PLAN_CHANGING']),
        }),
        Object.freeze({
          id: 'keep_combined',
          label: 'Keep as one task',
          description: 'Handle all objectives in a single task',
          risk: 'MEDIUM',
          consequences: Object.freeze(['More complex execution, higher risk']),
          affects: Object.freeze(['PLAN_CHANGING']),
        }),
      );
    }

    return options;
  }

  private formatQuestion(ambiguity: string): string {
    if (ambiguity.includes('No specific file')) {
      return 'Which files should be modified for this task?';
    }
    if (ambiguity.includes('No clear success criteria')) {
      return 'What does "done" mean for this task?';
    }
    if (ambiguity.includes('Multiple objectives')) {
      return 'This task has multiple objectives. How should they be handled?';
    }
    return ambiguity;
  }
}
