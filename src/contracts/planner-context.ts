import { FailureContract } from '../domain/failure-contract';
import { GatheredContext } from '../domain/gathered-context';
import { FailureContractContext, PlannerContext, ProductQaContext } from '../domain/planner-context';
import { ProductAnalysis } from '../domain/product-analysis';
import { VersionIntelligenceContext } from '../domain/version-intelligence';
import { ExecutionDirective, SkillResolution } from './skill-resolver';

export interface PlannerContextPreparationInput {
  readonly userTask: string;
  readonly workspaceRoot: string;
  readonly executionDirective?: ExecutionDirective;
  readonly productQa?: ProductAnalysis | ProductQaContext;
  readonly failureContract?: FailureContract;
  readonly refresh?: boolean;
  readonly repairCandidateFiles?: ReadonlyArray<string>;
  readonly repairExpansionLevel?: number;
}

export interface PlannerContextAssemblerInput {
  readonly userTask: string;
  readonly executionDirective: ExecutionDirective;
  readonly projectProfile: import('../domain/project-profile').ProjectProfile;
  readonly resolvedSkills: SkillResolution;
  readonly aiContext: import('../domain/ai-context').AiContextDiscovery;
  readonly versionIntelligence?: VersionIntelligenceContext;
  readonly strategy: import('../domain/context-strategy').ContextStrategy;
  readonly gathered: GatheredContext;
  readonly productQa?: ProductQaContext;
  readonly failureContract?: FailureContractContext;
}

/**
 * Assembles a PlannerContext from a strategy, gathered context, version intelligence, and immediately available values.
 */
export interface PlannerContextAssembler {
  assemble(input: PlannerContextAssemblerInput): PlannerContext;
}

/**
 * Loads Milestone A/E project intelligence, resolves skills, builds a strategy,
 * gathers targeted context, and assembles PlannerContext.
 */
export interface PlannerContextPreparationService {
  prepare(input: PlannerContextPreparationInput): Promise<PlannerContext>;
}
