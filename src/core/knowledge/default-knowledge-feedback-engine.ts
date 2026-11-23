import { KnowledgeFeedbackEngine } from '../../contracts/knowledge-feedback-engine';
import { KnowledgeCandidate, ConfidenceLevel, CandidateStatus } from '../../domain/knowledge-feedback';
import { WorkflowResult } from '../../contracts/workflow-orchestrator';
import { randomUUID } from 'crypto';

export class DefaultKnowledgeFeedbackEngine implements KnowledgeFeedbackEngine {
  async analyze(result: WorkflowResult): Promise<ReadonlyArray<KnowledgeCandidate>>  {
    // A.4: Quality Gate — only generate candidates for truly successful sessions
    if (result.reflection && result.reflection.executionOutcome !== 'success') {
      return Object.freeze([]);
    }
    if (!result.success) {
      return Object.freeze([]);
    }

    const candidates: KnowledgeCandidate[] = [];

    // Rule 1: Architectural Violations → ANTI_PATTERN
    if (result.reviewReport && result.reviewReport.failedCount > 0) {
      const archErrors = result.reviewReport.checks
        .filter(check => check.ruleId.startsWith('ARCH_'))
        .flatMap(check => check.evidence);
      
      if (archErrors.length > 0) {
        const evidence = archErrors.map(e => `Review: ${e.rule} - ${e.description}`);
        const confidenceReasons: string[] = [];
        
        let score = 0;
        if (archErrors.length >= 3) { score += 2; confidenceReasons.push('Multiple architectural violations (≥3)'); }
        else if (archErrors.length >= 2) { score += 1; confidenceReasons.push('Multiple architectural violations (≥2)'); }
        
        score += 2; confidenceReasons.push('Architectural boundary violation detected');
        score += 1; confidenceReasons.push('Evidence from Review Report');
        
        const confidence: ConfidenceLevel = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
        
        candidates.push({
          id: randomUUID(),
          type: 'ANTI_PATTERN',
          title: 'Architectural Boundary Violation',
          content: `Avoid ${archErrors.map(e => e.description).join('; ')}`,
          reason: 'Reviewer detected architectural violation causing potential instability',
          evidence: Object.freeze(evidence),
          confidence,
          confidenceReasons: Object.freeze(confidenceReasons),
          status: 'pending_review',
          generatedAt: new Date().toISOString(),
          sourceSessionId: result.sessionId
        });
      }
    }

    // Rule 2: Repeated Rollbacks → BEST_PRACTICE
    if (result.patchResult?.rollbackPerformed && result.abortedAt === 'patch-execution') {
      const evidence = ['Decision: ROLLBACK_CHOSEN', 'Patch execution failed'];
      const confidenceReasons: string[] = [];
      
      let score = 0;
      score += 1; confidenceReasons.push('Rollback performed');
      score += 1; confidenceReasons.push('Evidence from Decision Memory');
      score += 1; confidenceReasons.push('Evidence from Patch Result');
      
      const confidence: ConfidenceLevel = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
      
      candidates.push({
        id: randomUUID(),
        type: 'BEST_PRACTICE',
        title: 'Pre-Verification Before Patch',
        content: 'Run type-check and unit tests before applying patch to avoid rollback',
        reason: 'Patch execution failed and rollback was performed',
        evidence: Object.freeze(evidence),
        confidence,
        confidenceReasons: Object.freeze(confidenceReasons),
        status: 'pending_review',
        generatedAt: new Date().toISOString(),
        sourceSessionId: result.sessionId
      });
    }

    // Rule 3: Plan Validation Failures → PATTERN
    if (result.abortedAt === 'planning-validation' && result.abortReason) {
      const evidence = [`Plan Validation: ${result.abortReason}`];
      const confidenceReasons: string[] = [];
      
      let score = 0;
      score += 1; confidenceReasons.push('Plan validation failed');
      score += 1; confidenceReasons.push('Evidence from Plan Validator');
      
      const confidence: ConfidenceLevel = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
      
      candidates.push({
        id: randomUUID(),
        type: 'PATTERN',
        title: 'Plan Structure Issues',
        content: 'Ensure execution plans have valid dependencies and tool requirements',
        reason: 'Plan validation failed during execution',
        evidence: Object.freeze(evidence),
        confidence,
        confidenceReasons: Object.freeze(confidenceReasons),
        status: 'pending_review',
        generatedAt: new Date().toISOString(),
        sourceSessionId: result.sessionId
      });
    }

    // Rule 4: Successful Execution → BEST_PRACTICE
    if (result.success && result.reflection) {
      const reflection = result.reflection as any;
      if (reflection.executionOutcome === 'success' && reflection.toolsUsed.length > 0) {
        candidates.push({
          id: randomUUID(),
          type: 'BEST_PRACTICE',
          title: 'Successful Task Execution',
          content: `Task completed successfully using ${reflection.toolsUsed} tool(s). Files modified: ${reflection.filesModified ?? 0}.`,
          reason: 'Task executed successfully with tool usage',
          evidence: Object.freeze([`Reflection: ${reflection.summary ?? 'success'}`]),
          confidence: 'MEDIUM' as ConfidenceLevel,
          confidenceReasons: Object.freeze(['Successful execution confirmed by Reflection']),
          status: 'pending_review' as CandidateStatus,
          generatedAt: new Date().toISOString(),
          sourceSessionId: result.sessionId
        });
      }
    }

    return Object.freeze(candidates);
  }

  async recordImmediateFailure(sessionId: string, taskId: string, errorLog: string): Promise<void> {
    // This method is implemented in SelfHealingExecutor via RuntimeRepository
    // Placeholder for interface compliance
    console.warn('[KnowledgeFeedbackEngine] recordImmediateFailure called - implementation in SelfHealingExecutor');
  }

  async mergeToKnowledgeBase(sessionId: string): Promise<void> {
    // This method is implemented in SelfHealingExecutor via RuntimeRepository
    // Placeholder for interface compliance
    console.warn('[KnowledgeFeedbackEngine] mergeToKnowledgeBase called - implementation in SelfHealingExecutor');
  }
}
