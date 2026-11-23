/**
 * G.7: DefaultContractBuilder — Execution Contract Builder
 * 
 * Builds the final ExecutionContract from validated plan.
 * Separates user's raw prompt from coder's task.
 * 
 * Phase 1: Deterministic contract building.
 */

import { ContractBuilder, ContractBuildResult } from '../../contracts/contract-builder';
import { ExecutionContract, ContractStep } from '../../domain/pre-execution/contract';
import { TaskIntent } from '../../domain/pre-execution/intent';
import { ProjectInspection } from '../../contracts/preflight-analyzer';
import { RiskAssessment, RiskLevel } from '../../domain/pre-execution/risk';
import { Evidence } from '../../domain/pre-execution/evidence';
import { CritiqueResult } from '../../contracts/plan-critic';
import { ExecutionPlan } from '../../domain/execution-plan';

const SOURCE_PATH_REGEX = /\b(?:\.{0,2}\/[\w\-./]+|[\w\-./]+)\.(ts|tsx|js|jsx|json|md|css|scss)\b/gi;

/** Reject product names like "Next.js" that the file-path regex otherwise captures. */
export function isPlausibleSourcePath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.length < 3 || normalized.includes('://')) return false;
  if (normalized.includes('node_modules') || normalized.includes('_next/')) return false;
  if (!normalized.includes('/') && !/\.(tsx|ts|jsx)$/i.test(normalized)) return false;
  return true;
}

export function extractPlausibleSourcePaths(text: string): string[] {
  if (!text) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(SOURCE_PATH_REGEX.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    let file = match[0];
    if (file.startsWith('./')) file = file.substring(2);
    if (!isPlausibleSourcePath(file) || seen.has(file)) continue;
    seen.add(file);
    paths.push(file);
  }
  return paths;
}

export function collectContractScopeFiles(
  intent: { readonly initialScope: ReadonlyArray<string> },
  plan?: ExecutionPlan,
): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const push = (file: string) => {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!isPlausibleSourcePath(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    files.push(normalized);
  };

  for (const file of intent.initialScope) push(file);
  if (plan) {
    for (const step of plan.steps) {
      for (const file of step.expectedFiles ?? []) push(file);
      for (const file of extractPlausibleSourcePaths(step.description || '')) push(file);
      for (const file of extractPlausibleSourcePaths(step.expectedOutcome || '')) push(file);
      for (const file of extractPlausibleSourcePaths(step.objective || '')) push(file);
      for (const criterion of step.validationCriteria ?? []) {
        for (const file of extractPlausibleSourcePaths(criterion)) push(file);
      }
    }
    for (const file of extractPlausibleSourcePaths(plan.objective || '')) push(file);
    for (const file of extractPlausibleSourcePaths(plan.reasoning || '')) push(file);
  }
  return files;
}

/** Represent preflight observations as CONFIRMED evidence so validation sees real facts. */
export function createInspectionEvidence(inspection: ProjectInspection): Evidence[] {
  const collectedAt = inspection.inspectedAt || new Date().toISOString();
  const items: Evidence[] = [];

  if (inspection.framework && inspection.framework !== 'unknown') {
    items.push(Object.freeze({
      id: `evidence-inspection-framework`,
      type: 'FRAMEWORK_DETECTED',
      description: `Framework detected: ${inspection.framework}`,
      status: 'CONFIRMED',
      observation: inspection.framework,
      source: 'preflight',
      collectedAt,
    }));
  }
  if (inspection.packageManager && inspection.packageManager !== 'unknown') {
    items.push(Object.freeze({
      id: `evidence-inspection-package-manager`,
      type: 'PACKAGE_MANAGER_DETECTED',
      description: `Package manager detected: ${inspection.packageManager}`,
      status: 'CONFIRMED',
      observation: inspection.packageManager,
      source: 'preflight',
      collectedAt,
    }));
  }
  if (inspection.structure && inspection.structure.length > 0) {
    items.push(Object.freeze({
      id: `evidence-inspection-structure`,
      type: 'DIRECTORY_STRUCTURE',
      description: `Project structure: ${inspection.structure.join(', ')}`,
      status: 'CONFIRMED',
      observation: inspection.structure.join(', '),
      source: 'preflight',
      collectedAt,
    }));
  }

  return items;
}

export class DefaultContractBuilder implements ContractBuilder {
  async build(
    intent: TaskIntent,
    inspection: ProjectInspection,
    riskAssessment: RiskAssessment,
    evidence: ReadonlyArray<Evidence>,
    critiqueResult?: CritiqueResult,
    executionPlan?: ExecutionPlan,
  ): Promise<ContractBuildResult> {
    const filesInScope = collectContractScopeFiles(intent, executionPlan);
    const mergedEvidence = this.mergeEvidence(createInspectionEvidence(inspection), evidence);
    const steps = this.buildSteps(intent, filesInScope);
    const knownFacts = this.buildKnownFacts(mergedEvidence);
    const constraints = this.buildConstraints(intent, inspection);
    const allowedActions = this.buildAllowedActions(intent);
    const forbiddenActions = this.buildForbiddenActions(intent, riskAssessment);

    const draft: ExecutionContract = Object.freeze({
      id: `contract-${Date.now()}`,
      planId: executionPlan?.id ?? '',
      objective: intent.objective,
      context: this.buildContext(inspection),
      knownFacts: Object.freeze(knownFacts),
      evidence: Object.freeze(mergedEvidence.map(e => e.description)),
      hypotheses: Object.freeze([]),
      constraints: Object.freeze(constraints),
      allowedActions: Object.freeze(allowedActions),
      forbiddenActions: Object.freeze(forbiddenActions),
      filesInScope: Object.freeze(filesInScope),
      filesOutOfScope: Object.freeze([]),
      preconditions: Object.freeze(this.buildPreconditions(filesInScope)),
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

    const structuralErrors = await this.validate(draft);
    const criticRejected = critiqueResult ? !critiqueResult.approved : false;
    const criticErrors = criticRejected
      ? (critiqueResult?.criticalIssues.map(i => i.message) ?? ['PlanCritic rejected the plan'])
      : [];
    const validationErrors = [...structuralErrors, ...criticErrors];
    const validated = validationErrors.length === 0;

    const contract: ExecutionContract = Object.freeze({
      ...draft,
      validated,
      validationErrors: Object.freeze(validationErrors),
    });

    return Object.freeze({
      contract,
      validated,
      validationErrors: Object.freeze(validationErrors),
      critiqueApproved: critiqueResult ? critiqueResult.approved : false,
      builtAt: new Date().toISOString(),
    });
  }

  async validate(contract: ExecutionContract): Promise<ReadonlyArray<string>> {
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

    if (!contract.knownFacts || contract.knownFacts.length === 0) {
      errors.push('Contract has no known facts');
    }

    if (!contract.evidence || contract.evidence.length === 0) {
      errors.push('Contract has no evidence');
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

  private mergeEvidence(
    inspectionEvidence: ReadonlyArray<Evidence>,
    collected: ReadonlyArray<Evidence>,
  ): Evidence[] {
    const merged: Evidence[] = [...inspectionEvidence];
    const seen = new Set(inspectionEvidence.map(e => e.id));
    for (const item of collected) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  }

  private buildSteps(
    intent: TaskIntent,
    filesInScope: ReadonlyArray<string>,
  ): ContractStep[] {
    const steps: ContractStep[] = [];
    let stepIndex = 0;

    // Mode-specific step generation
    if (intent.mode === 'EASY') {
      steps.push(this.createStep(stepIndex++, filesInScope, 'Perform the requested action', 'MEDIUM'));
    } else if (intent.mode === 'MEDIUM') {
      steps.push(this.createStep(stepIndex++, filesInScope, 'Read relevant files', 'LOW'));
      steps.push(this.createStep(stepIndex++, filesInScope, `Perform the requested action: ${intent.objective}`, 'MEDIUM'));
      steps.push(this.createStep(stepIndex++, filesInScope, 'Verify the changes', 'LOW'));
    } else {
      steps.push(this.createStep(stepIndex++, filesInScope, 'Investigate the current state', 'LOW'));
      steps.push(this.createStep(stepIndex++, filesInScope, 'Read relevant files', 'LOW'));
      steps.push(this.createStep(stepIndex++, filesInScope, `Perform the requested action: ${intent.objective}`, 'MEDIUM'));
      steps.push(this.createStep(stepIndex++, filesInScope, 'Verify the changes', 'LOW'));
      steps.push(this.createStep(stepIndex++, filesInScope, 'Run validation checks', 'LOW'));
    }

    return steps;
  }

  private createStep(
    index: number,
    filesInScope: ReadonlyArray<string>,
    action: string,
    riskLevel: RiskLevel,
  ): ContractStep {
    return Object.freeze({
      id: `step-${index}`,
      precondition: 'Project files are accessible',
      action,
      expectedObservation: 'Step completed successfully',
      successCriteria: Object.freeze(['No errors', 'Changes match requirements']),
      failureHandling: 'Rollback changes and report error',
      filesInScope: Object.freeze([...filesInScope]),
      filesOutOfScope: Object.freeze([]),
      riskLevel,
    });
  }

  private buildKnownFacts(evidence: ReadonlyArray<Evidence>): string[] {
    return evidence
      .filter(e => e.status === 'CONFIRMED')
      .map(e => e.description);
  }

  private buildConstraints(intent: TaskIntent, inspection: ProjectInspection): string[] {
    const constraints: string[] = [];
    constraints.push(...intent.constraints);

    if (inspection.framework === 'nextjs') {
      constraints.push('Follow Next.js conventions');
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

    forbidden.push('delete_file');
    forbidden.push('modify files outside of filesInScope');

    if (riskAssessment.level === 'HIGH') {
      forbidden.push('modify package.json without explicit approval');
      forbidden.push('modify tsconfig.json without explicit approval');
      forbidden.push('install new dependencies without explicit approval');
    }

    return forbidden;
  }

  private buildPreconditions(filesInScope: ReadonlyArray<string>): string[] {
    const preconditions: string[] = [];

    for (const file of filesInScope) {
      preconditions.push(`File exists: ${file}`);
    }

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
