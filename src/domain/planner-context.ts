import { AiContextDiscovery } from './ai-context';
import { ContextSourceDescriptor } from './context-source';
import { ContextStrategy } from './context-strategy';
import { GatheredContext, freezeGatheredContext } from './gathered-context';
import { ProjectProfile } from './project-profile';
import {
  freezeVersionIntelligenceContext,
  VersionIntelligenceContext,
} from './version-intelligence';
import { ExecutionDirective, SkillResolution } from '../contracts/skill-resolver';

/**
 * Slim Product QA view for planner context.
 * Not a dump of ProductAnalysis.
 */
export interface ProductQaContext {
  readonly objective: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly verificationRequirements: ReadonlyArray<string>;
}

/**
 * Slim Failure Contract view for planner context.
 * Primary vs incidental is preserved; incidental items are not extra requirements.
 */
export interface FailureContractContext {
  readonly id: string;
  readonly summary: string;
  readonly primaryFailureId?: string;
  readonly incidentalCount: number;
  readonly failedTodoId?: string;
  readonly attemptId?: string;
  readonly classification?: string;
}

/**
 * PlannerContext contract.
 * Holds immediately available values, source decisions, strategy metadata,
 * targeted gathered context (Milestone B2), and version intelligence (Milestone E).
 * Does not contain repository-wide file dumps.
 */
export interface PlannerContext {
  readonly userTask: string;
  readonly productQa?: ProductQaContext;
  readonly failureContract?: FailureContractContext;
  readonly executionDirective: ExecutionDirective;
  readonly projectProfile: ProjectProfile;
  readonly resolvedSkills: SkillResolution;
  readonly aiContext: AiContextDiscovery;
  readonly versionIntelligence?: VersionIntelligenceContext;
  readonly sources: ReadonlyArray<ContextSourceDescriptor>;
  readonly strategy: ContextStrategy;
  readonly repairMode: boolean;
  readonly gathered: GatheredContext;
}

export function freezeProductQaContext(value: ProductQaContext): ProductQaContext {
  return Object.freeze({
    objective: value.objective,
    acceptanceCriteria: Object.freeze([...value.acceptanceCriteria]),
    verificationRequirements: Object.freeze([...value.verificationRequirements]),
  });
}

export function freezeFailureContractContext(value: FailureContractContext): FailureContractContext {
  return Object.freeze({ ...value });
}

export function freezePlannerContext(context: PlannerContext): PlannerContext {
  return Object.freeze({
    userTask: context.userTask,
    productQa: context.productQa ? freezeProductQaContext(context.productQa) : undefined,
    failureContract: context.failureContract ? freezeFailureContractContext(context.failureContract) : undefined,
    executionDirective: Object.freeze({
      explicitSkillIds: context.executionDirective.explicitSkillIds
        ? Object.freeze([...context.executionDirective.explicitSkillIds])
        : undefined,
      requestedDomains: context.executionDirective.requestedDomains
        ? Object.freeze([...context.executionDirective.requestedDomains])
        : undefined,
    }),
    projectProfile: context.projectProfile,
    resolvedSkills: Object.freeze({
      skills: Object.freeze([...context.resolvedSkills.skills]),
      reasons: Object.freeze(context.resolvedSkills.reasons.map(reason => Object.freeze({ ...reason }))),
      mode: context.resolvedSkills.mode,
    }),
    aiContext: context.aiContext,
    versionIntelligence: context.versionIntelligence
      ? freezeVersionIntelligenceContext(context.versionIntelligence)
      : undefined,
    sources: Object.freeze(context.sources.map(source => Object.freeze({ ...source }))),
    strategy: context.strategy,
    repairMode: context.repairMode,
    gathered: freezeGatheredContext(context.gathered),
  });
}

export function formatPlannerContextSummary(context: PlannerContext): string {
  const skillIds = context.resolvedSkills.skills.map(skill => skill.id).join(', ') || '(none)';
  const frameworks = context.projectProfile.detectedFrameworks.join(', ') || '(none)';
  const versionSummary = context.versionIntelligence?.summary
    ? `versionIntelligence=[${context.versionIntelligence.summary}]`
    : '';

  return [
    `repairMode=${context.repairMode}`,
    `project=${context.projectProfile.projectType} frameworks=${frameworks}`,
    versionSummary,
    `skills=${skillIds} mode=${context.resolvedSkills.mode}`,
    `selected=${context.strategy.selectedSources.join(',') || '(none)'}`,
    `excluded=${context.strategy.excludedSources.join(',') || '(none)'}`,
    `deferred=${context.strategy.deferredSources.join(',') || '(none)'}`,
    `missingRequired=${context.strategy.missingRequired.join(',') || '(none)'}`,
    `gathered=${context.gathered.fileCount} files/${context.gathered.records.length} records/${context.gathered.totalBytes} bytes`,
    `gatheredLimit=${context.gathered.limitReached}`,
  ].filter(Boolean).join('; ');
}
