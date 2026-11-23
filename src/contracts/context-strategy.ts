import { AiContextDiscovery } from '../domain/ai-context';
import { ContextStrategy } from '../domain/context-strategy';
import { FailureContractContext, ProductQaContext } from '../domain/planner-context';
import { ProjectProfile } from '../domain/project-profile';
import { ExecutionDirective, SkillResolution } from './skill-resolver';

export interface ContextStrategyInput {
  readonly userTask: string;
  readonly executionDirective: ExecutionDirective;
  readonly projectProfile: ProjectProfile;
  readonly resolvedSkills: SkillResolution;
  readonly productQa?: ProductQaContext;
  readonly failureContract?: FailureContractContext;
  readonly aiContext: AiContextDiscovery;
  readonly codebaseMapAvailable?: boolean;
}

/**
 * Deterministic context strategy builder. Must not call an LLM.
 * Must not inspect arbitrary repository files.
 */
export interface ContextStrategyBuilder {
  build(input: ContextStrategyInput): ContextStrategy;
}
