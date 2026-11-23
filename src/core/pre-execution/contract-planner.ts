/**
 * G.5: DefaultContractPlanner — Planning v2
 * 
 * Generates ExecutionContract with precondition/action/observation steps.
 * Mode-specific planning: EASY/MEDIUM/HARD.
 * 
 * Phase 1: Deterministic contract generation. LLM can be added later.
 */

import { ContractPlanner, ContractPlanningResult } from '../../contracts/contract-planner';
import { ExecutionContract, ContractStep } from '../../domain/pre-execution/contract';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { ProjectInspection } from '../../contracts/preflight-analyzer';
import { RiskAssessment, RiskLevel } from '../../domain/pre-execution/risk';
import { Evidence } from '../../domain/pre-execution/evidence';

export class DefaultContractPlanner implements ContractPlanner {
  async plan(
    intent: TaskIntent,
    inspection: ProjectInspection,
    riskAssessment: RiskAssessment,
    evidence: ReadonlyArray<Evidence>,
  ): Promise<ContractPlanningResult> {
    const startTime = Date.now();

    // Generate steps based on mode
    const steps = this.generateSteps(intent, inspection, riskAssessment);

    // Build known facts from evidence
    const knownFacts = this.extractKnownFacts(evidence);

    // Build constraints
    const constraints = this.buildConstraints(intent, inspection);

    // Build allowed/forbidden actions
    const allowedActions = this.buildAllowedActions(intent);
    const forbiddenActions = this.buildForbiddenActions(intent, riskAssessment);

    // Build contract
    const contract: ExecutionContract = Object.freeze({
      id: `contract-${Date.now()}`,
      planId: '',
      objective: intent.objective,
      context: this.buildContext(inspection),
      knownFacts: Object.freeze(knownFacts),
      evidence: Object.freeze(evidence.map(e => e.description)),
      hypotheses: Object.freeze([]),
      constraints: Object.freeze(constraints),
      allowedActions: Object.freeze(allowedActions),
      forbiddenActions: Object.freeze(forbiddenActions),
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      preconditions: Object.freeze(this.buildPreconditions(intent)),
      steps: Object.freeze(steps),
      risk: riskAssessment.level,
      impact: this.buildImpactDescription(intent, riskAssessment),
      rollback: this.buildRollbackStrategy(riskAssessment),
      verification: this.buildVerificationStrategy(intent, inspection),
      outputRequirements: Object.freeze(this.buildOutputRequirements(intent)),
      createdAt: new Date().toISOString(),
      version: '1.0.0',
      validated: false,
      validationErrors: Object.freeze([]),
    });

    const planningDurationMs = Date.now() - startTime;

    return Object.freeze({
      contract,
      stepsGenerated: steps.length,
      mode: intent.mode,
      planningDurationMs,
    });
  }

  private generateSteps(
    intent: TaskIntent,
    inspection: ProjectInspection,
    riskAssessment: RiskAssessment,
  ): ContractStep[] {
    const steps: ContractStep[] = [];
    let stepIndex = 0;

    // Mode-specific step generation
    if (intent.mode === 'EASY') {
      // EASY: Single action step
      steps.push(this.createActionStep(stepIndex++, intent, 'Perform the requested action'));
    } else if (intent.mode === 'MEDIUM') {
      // MEDIUM: Read + Action + Verify
      steps.push(this.createReadStep(stepIndex++, intent, 'Read relevant files'));
      steps.push(this.createActionStep(stepIndex++, intent, 'Perform the requested action'));
      steps.push(this.createVerifyStep(stepIndex++, intent, 'Verify the changes'));
    } else {
      // HARD: Investigate + Plan + Action + Verify + Validate
      steps.push(this.createInvestigateStep(stepIndex++, intent, 'Investigate the current state'));
      steps.push(this.createReadStep(stepIndex++, intent, 'Read relevant files'));
      steps.push(this.createActionStep(stepIndex++, intent, 'Perform the requested action'));
      steps.push(this.createVerifyStep(stepIndex++, intent, 'Verify the changes'));
      steps.push(this.createValidateStep(stepIndex++, intent, 'Run validation checks'));
    }

    return steps;
  }

  private createReadStep(index: number, intent: TaskIntent, action: string): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'Project files are accessible',
      action,
      expectedObservation: 'Files are read successfully and content is understood',
      successCriteria: Object.freeze(['All target files are read', 'No errors during reading']),
      failureHandling: 'Retry reading; if still fails, report error and stop',
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  private createActionStep(index: number, intent: TaskIntent, action: string): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'Target files are understood and evidence is collected',
      action: `${action}: ${intent.objective}`,
      expectedObservation: 'Changes are applied to target files',
      successCriteria: Object.freeze(['Changes compile without errors', 'No unintended side effects']),
      failureHandling: 'Rollback changes and report error',
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      riskLevel: 'MEDIUM' as RiskLevel,
    });
  }

  private createVerifyStep(index: number, intent: TaskIntent, action: string): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'Changes have been applied',
      action,
      expectedObservation: 'Changes are verified to be correct',
      successCriteria: Object.freeze(['Build passes', 'No runtime errors', 'Changes match requirements']),
      failureHandling: 'Report verification failure and suggest fixes',
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  private createInvestigateStep(index: number, intent: TaskIntent, action: string): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'None',
      action,
      expectedObservation: 'Current state is understood',
      successCriteria: Object.freeze(['All relevant files identified', 'Dependencies mapped']),
      failureHandling: 'Report investigation failure',
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  private createValidateStep(index: number, intent: TaskIntent, action: string): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'Changes are verified',
      action,
      expectedObservation: 'All validation checks pass',
      successCriteria: Object.freeze(['Build passes', 'Tests pass (if available)', 'Lint passes (if available)']),
      failureHandling: 'Report validation failure with details',
      filesInScope: Object.freeze(intent.initialScope),
      filesOutOfScope: Object.freeze([]),
      riskLevel: 'LOW' as RiskLevel,
    });
  }

  private extractKnownFacts(evidence: ReadonlyArray<Evidence>): string[] {
    return evidence
      .filter(e => e.status === 'CONFIRMED')
      .map(e => e.description);
  }

  private buildConstraints(intent: TaskIntent, inspection: ProjectInspection): string[] {
    const constraints: string[] = [];
    
    // Add user constraints
    constraints.push(...intent.constraints);
    
    // Add framework-specific constraints
    if (inspection.framework === 'nextjs') {
      constraints.push('Follow Next.js conventions (app router or pages router)');
    }
    
    if (inspection.hasTypeScript) {
      constraints.push('Maintain TypeScript type safety');
    }
    
    return constraints;
  }

  private buildAllowedActions(intent: TaskIntent): string[] {
    const actions: string[] = [];
    
    switch (intent.type) {
      case 'BUG_FIX':
        actions.push('read_file', 'search_files', 'apply_patch', 'run_tests');
        break;
      case 'FEATURE':
        actions.push('read_file', 'search_files', 'apply_patch', 'create_file');
        break;
      case 'REFACTOR':
        actions.push('read_file', 'search_files', 'apply_patch');
        break;
      case 'INVESTIGATION':
        actions.push('read_file', 'search_files', 'grep');
        break;
      case 'CONFIGURATION':
        actions.push('read_file', 'apply_patch');
        break;
      case 'TEST':
        actions.push('read_file', 'create_file', 'run_tests');
        break;
      default:
        actions.push('read_file', 'search_files', 'apply_patch');
    }
    
    return actions;
  }

  private buildForbiddenActions(intent: TaskIntent, riskAssessment: RiskAssessment): string[] {
    const forbidden: string[] = [];
    
    // Always forbid destructive operations
    forbidden.push('delete_file');
    
    // Forbid out-of-scope modifications
    forbidden.push('modify files outside of filesInScope');
    
    // For high risk, forbid more
    if (riskAssessment.level === 'HIGH') {
      forbidden.push('modify package.json without explicit approval');
      forbidden.push('modify tsconfig.json without explicit approval');
      forbidden.push('install new dependencies without explicit approval');
    }
    
    return forbidden;
  }

  private buildPreconditions(intent: TaskIntent): string[] {
    const preconditions: string[] = [];
    
    // Files must exist
    for (const file of intent.initialScope) {
      preconditions.push(`File exists: ${file}`);
    }
    
    // Project must be accessible
    preconditions.push('Project root is accessible');
    
    return preconditions;
  }

  private buildContext(inspection: ProjectInspection): string {
    const parts: string[] = [];
    
    parts.push(`Framework: ${inspection.framework}`);
    parts.push(`Runtime: ${inspection.runtime}`);
    parts.push(`Package manager: ${inspection.packageManager}`);
    parts.push(`TypeScript: ${inspection.hasTypeScript ? 'yes' : 'no'}`);
    parts.push(`Tests: ${inspection.hasTests ? 'yes' : 'no'}`);
    
    if (inspection.structure.length > 0) {
      parts.push(`Structure: ${inspection.structure.join(', ')}`);
    }
    
    return parts.join('\n');
  }

  private buildImpactDescription(intent: TaskIntent, riskAssessment: RiskAssessment): string {
    return `Risk level: ${riskAssessment.level}. Estimated files affected: ${riskAssessment.estimatedFilesAffected}. ${riskAssessment.explanation}`;
  }

  private buildRollbackStrategy(riskAssessment: RiskAssessment): string {
    if (riskAssessment.reversible) {
      return 'Changes can be reverted using git or file backups';
    } else {
      return 'Changes are not easily reversible. Safe experiment recommended.';
    }
  }

  private buildVerificationStrategy(intent: TaskIntent, inspection: ProjectInspection): string {
    const parts: string[] = [];
    
    parts.push('Verify changes compile without errors');
    
    if (inspection.hasTests) {
      parts.push('Run existing tests to ensure no regressions');
    }
    
    if (inspection.hasESLint) {
      parts.push('Run linting to ensure code quality');
    }
    
    return parts.join('\n');
  }

  private buildOutputRequirements(intent: TaskIntent): string[] {
    const requirements: string[] = [];
    
    requirements.push('Changes must be committed with a descriptive message');
    requirements.push('No unintended side effects');
    
    if (intent.successCriteria.length > 0) {
      requirements.push(...intent.successCriteria);
    }
    
    return requirements;
  }
}
