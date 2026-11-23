import { AiContextDiscovery } from '../domain/ai-context';
import { ContextStrategy } from '../domain/context-strategy';
import { ContextGatheringLimits } from '../domain/context-gathering-limits';
import { FailureContract } from '../domain/failure-contract';
import { GatheredContext } from '../domain/gathered-context';
import { ProductQaContext } from '../domain/planner-context';
import { ProjectProfile } from '../domain/project-profile';
import { ExecutionDirective, SkillResolution } from './skill-resolver';

export interface ContextGatheringInput {
  readonly workspaceRoot: string;
  readonly userTask: string;
  readonly executionDirective: ExecutionDirective;
  readonly projectProfile: ProjectProfile;
  readonly resolvedSkills: SkillResolution;
  readonly strategy: ContextStrategy;
  readonly aiContext: AiContextDiscovery;
  readonly productQa?: ProductQaContext;
  readonly failureContract?: FailureContract;
  readonly failureContractView?: import('../domain/planner-context').FailureContractContext;
  readonly repairCandidateFiles?: ReadonlyArray<string>;
  readonly limits?: Partial<ContextGatheringLimits>;
  readonly refresh?: boolean;
}

/**
 * Deterministic targeted context gatherer.
 * Must not call an LLM. Must not walk the entire repository.
 * Gathers only sources permitted by ContextStrategy.
 */
export interface ContextGatherer {
  gather(input: ContextGatheringInput): Promise<GatheredContext>;
}
