import {
  PlannerContextAssembler,
  PlannerContextAssemblerInput,
} from '../../contracts/planner-context';
import { freezePlannerContext, PlannerContext } from '../../domain/planner-context';

export class DefaultPlannerContextAssembler implements PlannerContextAssembler {
  assemble(input: PlannerContextAssemblerInput): PlannerContext {
    return freezePlannerContext({
      userTask: input.userTask,
      productQa: input.productQa,
      failureContract: input.failureContract,
      executionDirective: input.executionDirective,
      projectProfile: input.projectProfile,
      resolvedSkills: input.resolvedSkills,
      aiContext: input.aiContext,
      versionIntelligence: input.versionIntelligence,
      sources: input.strategy.sources,
      strategy: input.strategy,
      repairMode: input.strategy.repairMode,
      gathered: input.gathered,
    });
  }
}
