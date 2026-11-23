/**
 * G.6: DefaultPlanCritic — Plan Critique & Validation
 * 
 * Independently critiques plans before execution.
 * Assumes the plan is wrong and tries to find problems.
 * 
 * Phase 1: Deterministic critique. LLM can be added later.
 */

import { PlanCritic, CritiqueResult, CritiqueIssue } from '../../contracts/plan-critic';
import { ExecutionContract, ContractStep } from '../../domain/pre-execution/contract';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { RiskAssessment } from '../../domain/pre-execution/risk';

export class DefaultPlanCritic implements PlanCritic {
  async critique(
    contract: ExecutionContract,
    intent: TaskIntent,
    riskAssessment: RiskAssessment,
  ): Promise<CritiqueResult> {
    const issues: CritiqueIssue[] = [];
    let issueIndex = 0;

    // 1. Check for unsupported assumptions
    issues.push(...this.checkUnsupportedAssumptions(contract, intent, issueIndex));
    issueIndex += issues.length;

    // 2. Check for missing evidence
    issues.push(...this.checkMissingEvidence(contract, issueIndex));
    issueIndex = issues.length;

    // 3. Check for ambiguity
    issues.push(...this.checkAmbiguity(contract, intent, issueIndex));
    issueIndex = issues.length;

    // 4. Check for scope creep
    issues.push(...this.checkScopeCreep(contract, intent, issueIndex));
    issueIndex = issues.length;

    // 5. Check for premature mutation
    issues.push(...this.checkPrematureMutation(contract, riskAssessment, issueIndex));
    issueIndex = issues.length;

    // 6. Check success criteria completeness
    issues.push(...this.checkSuccessCriteria(contract, issueIndex));
    issueIndex = issues.length;

    // 7. Validate schema
    const schemaErrors = await this.validateSchema(contract);
    for (const error of schemaErrors) {
      issues.push({
        id: `issue-${issueIndex++}`,
        severity: 'ERROR',
        category: 'SCHEMA_VIOLATION',
        message: error,
      });
    }

    // Compute results
    const criticalIssues = issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'ERROR');
    const warnings = issues.filter(i => i.severity === 'WARNING');
    const approved = criticalIssues.length === 0;
    const confidenceScore = this.computeConfidenceScore(issues);
    const recommendation = this.determineRecommendation(criticalIssues.length, warnings.length, confidenceScore);

    return Object.freeze({
      approved,
      issues: Object.freeze(issues),
      criticalIssues: Object.freeze(criticalIssues),
      warnings: Object.freeze(warnings),
      confidenceScore,
      recommendation,
    });
  }

  async validateSchema(contract: ExecutionContract): Promise<ReadonlyArray<string>> {
    const errors: string[] = [];

    // Check required fields
    if (!contract.objective || contract.objective.trim().length === 0) {
      errors.push('Contract objective is missing or empty');
    }

    if (!contract.steps || contract.steps.length === 0) {
      errors.push('Contract has no steps');
    }

    if (!contract.filesInScope || contract.filesInScope.length === 0) {
      errors.push('Contract has no files in scope');
    }

    // Check each step
    for (const step of contract.steps) {
      if (!step.action || step.action.trim().length === 0) {
        errors.push(`Step ${step.id} has no action`);
      }
      if (!step.successCriteria || step.successCriteria.length === 0) {
        errors.push(`Step ${step.id} has no success criteria`);
      }
      if (!step.failureHandling || step.failureHandling.trim().length === 0) {
        errors.push(`Step ${step.id} has no failure handling`);
      }
    }

    return Object.freeze(errors);
  }

  private checkUnsupportedAssumptions(
    contract: ExecutionContract,
    intent: TaskIntent,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    // Check if contract assumes files exist without evidence
    for (const file of contract.filesInScope) {
      const hasEvidence = contract.evidence.some(e => e.includes(file));
      if (!hasEvidence) {
        issues.push({
          id: `issue-${index++}`,
          severity: 'WARNING',
          category: 'UNSUPPORTED_ASSUMPTION',
          message: `File "${file}" is in scope but no evidence confirms it exists`,
          suggestion: 'Add evidence collection for this file',
        });
      }
    }

    return issues;
  }

  private checkMissingEvidence(
    contract: ExecutionContract,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    if (contract.evidence.length === 0) {
      issues.push({
        id: `issue-${index++}`,
        severity: 'ERROR',
        category: 'MISSING_EVIDENCE',
        message: 'Contract has no evidence. No evidence → No assumption → No mutation.',
        suggestion: 'Collect evidence before proceeding with execution',
      });
    }

    return issues;
  }

  private checkAmbiguity(
    contract: ExecutionContract,
    intent: TaskIntent,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    // Check if objective is vague
    const vagueTerms = ['some', 'maybe', 'perhaps', 'possibly', 'around', 'about'];
    const objectiveLower = contract.objective.toLowerCase();
    for (const term of vagueTerms) {
      if (objectiveLower.includes(term)) {
        issues.push({
          id: `issue-${index++}`,
          severity: 'WARNING',
          category: 'AMBIGUITY',
          message: `Objective contains vague term: "${term}"`,
          suggestion: 'Clarify the objective with specific details',
        });
      }
    }

    return issues;
  }

  private checkScopeCreep(
    contract: ExecutionContract,
    intent: TaskIntent,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    // Check if contract scope exceeds intent scope
    const intentScope = new Set(intent.initialScope);
    for (const file of contract.filesInScope) {
      if (!intentScope.has(file)) {
        issues.push({
          id: `issue-${index++}`,
          severity: 'WARNING',
          category: 'SCOPE_CREEP',
          message: `File "${file}" is in contract scope but not in intent scope`,
          suggestion: 'Verify this file should be modified',
        });
      }
    }

    return issues;
  }

  private checkPrematureMutation(
    contract: ExecutionContract,
    riskAssessment: RiskAssessment,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    // Check if high-risk mutation happens without evidence
    if (riskAssessment.level === 'HIGH' || riskAssessment.level === 'CRITICAL') {
      if (contract.evidence.length === 0) {
        issues.push({
          id: `issue-${index++}`,
          severity: 'CRITICAL',
          category: 'PREMATURE_MUTATION',
          message: 'High-risk mutation planned without any evidence',
          suggestion: 'Collect evidence and run safe experiment before mutation',
        });
      }
    }

    return issues;
  }

  private checkSuccessCriteria(
    contract: ExecutionContract,
    startIndex: number,
  ): CritiqueIssue[] {
    const issues: CritiqueIssue[] = [];
    let index = startIndex;

    for (const step of contract.steps) {
      if (!step.successCriteria || step.successCriteria.length === 0) {
        issues.push({
          id: `issue-${index++}`,
          severity: 'ERROR',
          category: 'INCOMPLETE_SUCCESS_CRITERIA',
          message: `Step ${step.id} has no success criteria`,
          stepId: step.id,
          suggestion: 'Add specific, verifiable success criteria',
        });
      }
    }

    return issues;
  }

  private computeConfidenceScore(issues: CritiqueIssue[]): number {
    let score = 100;

    for (const issue of issues) {
      switch (issue.severity) {
        case 'CRITICAL':
          score -= 30;
          break;
        case 'ERROR':
          score -= 20;
          break;
        case 'WARNING':
          score -= 10;
          break;
        case 'INFO':
          score -= 2;
          break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  private determineRecommendation(
    criticalCount: number,
    warningCount: number,
    confidenceScore: number,
  ): 'APPROVE' | 'REVISE' | 'REJECT' | 'REPLAN' {
    if (criticalCount > 0) {
      return 'REJECT';
    }
    if (confidenceScore < 50) {
      return 'REPLAN';
    }
    if (warningCount > 3) {
      return 'REVISE';
    }
    return 'APPROVE';
  }
}
