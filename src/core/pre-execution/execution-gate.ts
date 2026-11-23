/**
 * G.8: DefaultExecutionGate — Final Checkpoint Before Mutation
 * 
 * Checks risk, scope, evidence, confirmation, and verifiability.
 * In BLOCKED state, no Coder executes.
 * 
 * Phase 1: Deterministic gate evaluation.
 */

import { ExecutionGate, GateCheckInput } from '../../contracts/execution-gate';
import { ExecutionContract } from '../../domain/pre-execution/contract';
import { RiskAssessment, RiskPolicy, DEFAULT_RISK_POLICY } from '../../domain/pre-execution/risk';
import { GateDecision, GateEvaluation, GateCheckResult, GateReason, DEFAULT_GATE_POLICY } from '../../domain/pre-execution/gate';
import { GatePolicy } from '../../domain/pre-execution/gate';
import { Evidence } from '../../domain/pre-execution/evidence';

export class DefaultExecutionGate implements ExecutionGate {
  async evaluate(
    input: GateCheckInput,
    policy?: GatePolicy,
  ): Promise<GateEvaluation> {
    const gatePolicy = policy || DEFAULT_GATE_POLICY;
    const checks: GateCheckResult[] = [];

    // Check 1: Risk level
    const riskCheck = this.checkRiskLevel(input.riskAssessment, gatePolicy);
    checks.push(riskCheck);

    // Check 2: Evidence sufficiency
    const evidenceCheck = this.checkEvidence(input.evidence, gatePolicy);
    checks.push(evidenceCheck);

    // Check 3: Scope validity
    const scopeCheck = this.checkScope(input.contract);
    checks.push(scopeCheck);

    // Check 4: Critique approval
    const critiqueCheck = this.checkCritique(input);
    checks.push(critiqueCheck);

    // Check 5: User confirmation (if required)
    const confirmationCheck = this.checkConfirmation(input, gatePolicy);
    checks.push(confirmationCheck);

    // Check 6: Verifiability
    const verifiabilityCheck = this.checkVerifiability(input.contract);
    checks.push(verifiabilityCheck);

    // Determine overall decision
    const decision = this.determineDecision(checks, input, gatePolicy);
    const blockedReasons = this.collectBlockedReasons(checks);
    const requiresConfirmation = this.requiresConfirmation(input, gatePolicy);

    return Object.freeze({
      decision,
      checks: Object.freeze(checks),
      riskLevel: input.riskAssessment.level,
      requiresConfirmation,
      blockedReasons: Object.freeze(blockedReasons),
      evaluatedAt: new Date().toISOString(),
    });
  }

  isBlocked(evaluation: GateEvaluation): boolean {
    return evaluation.decision === 'BLOCKED';
  }

  private checkRiskLevel(
    riskAssessment: RiskAssessment,
    policy: GatePolicy,
  ): GateCheckResult {
    const reasons: GateReason[] = [];

    // Check if risk level is blocked
    if (riskAssessment.level === 'CRITICAL') {
      reasons.push({
        code: 'CRITICAL_RISK',
        message: 'CRITICAL risk operations are blocked',
        severity: 'CRITICAL',
      });
      return { passed: false, reasons: Object.freeze(reasons) };
    }

    // Check if HIGH risk requires confirmation
    if (riskAssessment.level === 'HIGH' && policy.requireConfirmationForHighRisk) {
      reasons.push({
        code: 'HIGH_RISK_REQUIRES_CONFIRMATION',
        message: 'HIGH risk operation requires explicit user confirmation',
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    reasons.push({
      code: 'RISK_OK',
      message: `Risk level ${riskAssessment.level} is acceptable`,
      severity: 'INFO',
    });
    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private checkEvidence(
    evidence: ReadonlyArray<Evidence>,
    policy: GatePolicy,
  ): GateCheckResult {
    const reasons: GateReason[] = [];

    if (policy.requireEvidenceForMutation && evidence.length === 0) {
      reasons.push({
        code: 'NO_EVIDENCE',
        message: 'No evidence collected. No evidence → No assumption → No mutation.',
        severity: 'ERROR',
      });
      return { passed: false, reasons: Object.freeze(reasons) };
    }

    const confirmedEvidence = evidence.filter(e => e.status === 'CONFIRMED');
    if (confirmedEvidence.length === 0 && evidence.length > 0) {
      reasons.push({
        code: 'NO_CONFIRMED_EVIDENCE',
        message: 'Evidence collected but none confirmed',
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    reasons.push({
      code: 'EVIDENCE_OK',
      message: `${confirmedEvidence.length} confirmed evidence items`,
      severity: 'INFO',
    });
    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private checkScope(contract: ExecutionContract): GateCheckResult {
    const reasons: GateReason[] = [];

    if (contract.filesInScope.length === 0) {
      reasons.push({
        code: 'NO_SCOPE',
        message: 'Contract has no files in scope',
        severity: 'ERROR',
      });
      return { passed: false, reasons: Object.freeze(reasons) };
    }

    reasons.push({
      code: 'SCOPE_OK',
      message: `${contract.filesInScope.length} file(s) in scope`,
      severity: 'INFO',
    });
    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private checkCritique(input: GateCheckInput): GateCheckResult {
    const reasons: GateReason[] = [];

    if (!input.critiqueResult) {
      reasons.push({
        code: 'NO_CRITIQUE',
        message: 'No critique result available',
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    if (!input.critiqueResult.approved) {
      reasons.push({
        code: 'CRITIQUE_REJECTED',
        message: `Critique rejected plan with ${input.critiqueResult.criticalIssues.length} critical issue(s)`,
        severity: 'ERROR',
      });
      return { passed: false, reasons: Object.freeze(reasons) };
    }

    if (input.critiqueResult.confidenceScore < 50) {
      reasons.push({
        code: 'LOW_CONFIDENCE',
        message: `Critique confidence score is low: ${input.critiqueResult.confidenceScore}`,
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    reasons.push({
      code: 'CRITIQUE_OK',
      message: `Critique approved with confidence ${input.critiqueResult.confidenceScore}`,
      severity: 'INFO',
    });
    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private checkConfirmation(
    input: GateCheckInput,
    policy: GatePolicy,
  ): GateCheckResult {
    const reasons: GateReason[] = [];

    const needsConfirmation = this.requiresConfirmation(input, policy);
    if (needsConfirmation && !input.userConfirmed) {
      reasons.push({
        code: 'CONFIRMATION_REQUIRED',
        message: 'User confirmation required but not provided',
        severity: 'ERROR',
      });
      return { passed: false, reasons: Object.freeze(reasons) };
    }

    if (needsConfirmation && input.userConfirmed) {
      reasons.push({
        code: 'CONFIRMED',
        message: 'User confirmation provided',
        severity: 'INFO',
      });
    }

    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private checkVerifiability(contract: ExecutionContract): GateCheckResult {
    const reasons: GateReason[] = [];

    // Check if contract has verification strategy
    if (!contract.verification || contract.verification.trim().length === 0) {
      reasons.push({
        code: 'NO_VERIFICATION',
        message: 'Contract has no verification strategy',
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    // Check if steps have success criteria
    const stepsWithCriteria = contract.steps.filter(
      s => s.successCriteria && s.successCriteria.length > 0,
    );
    if (stepsWithCriteria.length < contract.steps.length) {
      reasons.push({
        code: 'INCOMPLETE_CRITERIA',
        message: `${contract.steps.length - stepsWithCriteria.length} step(s) missing success criteria`,
        severity: 'WARNING',
      });
      return { passed: true, reasons: Object.freeze(reasons) };
    }

    reasons.push({
      code: 'VERIFIABILITY_OK',
      message: 'All steps have success criteria',
      severity: 'INFO',
    });
    return { passed: true, reasons: Object.freeze(reasons) };
  }

  private determineDecision(
    checks: GateCheckResult[],
    input: GateCheckInput,
    policy: GatePolicy,
  ): GateDecision {
    // If any check failed, block
    const hasFailure = checks.some(c => !c.passed);
    if (hasFailure) {
      return 'BLOCKED';
    }

    // If high risk and requires safe experiment
    if (input.riskAssessment.safeExperimentRecommended && policy.requireSafeExperimentForHighRisk) {
      return 'REQUIRES_SAFE_EXPERIMENT';
    }

    // If requires confirmation
    if (this.requiresConfirmation(input, policy) && !input.userConfirmed) {
      return 'PROCEED_WITH_CONFIRMATION';
    }

    return 'PROCEED';
  }

  private collectBlockedReasons(checks: GateCheckResult[]): string[] {
    const reasons: string[] = [];
    for (const check of checks) {
      if (!check.passed) {
        for (const reason of check.reasons) {
          reasons.push(`${reason.code}: ${reason.message}`);
        }
      }
    }
    return reasons;
  }

  private requiresConfirmation(
    input: GateCheckInput,
    policy: GatePolicy,
  ): boolean {
    if (input.riskAssessment.level === 'HIGH' && policy.requireConfirmationForHighRisk) {
      return true;
    }
    const isInvestigation =
      (input.intent as any)?.type === 'INVESTIGATION' ||
      (input.intent as any)?.requiresMutation === false ||
      (input.contract?.allowedActions && input.contract.allowedActions.length > 0 &&
        !input.contract.allowedActions.some(a => ['apply_patch', 'create_file', 'write_file', 'delete_file', 'modify'].some(m => a.includes(m))));
    if (isInvestigation) {
      return false;
    }
    if (input.contract.filesInScope.length > policy.maxFilesWithoutConfirmation) {
      return true;
    }
    return false;
  }
}
