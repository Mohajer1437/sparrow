import { ImpactAnalysis, ImpactLimits, ImpactReport } from '../domain/impact-analysis';
import { TodoPlan } from '../domain/todo-plan';
import { ProjectProfile } from '../domain/project-profile';
import { Skill } from '../domain/skill';

export interface ImpactAnalyzerOptions {
  readonly todoPlan?: TodoPlan;
  readonly projectProfile?: ProjectProfile;
  readonly skills?: ReadonlyArray<Skill>;
  readonly workspaceRoot?: string;
  readonly limits?: Partial<ImpactLimits>;
}

export interface ImpactAnalyzer {
  analyze(
    targetFiles: ReadonlyArray<string>,
    options?: ImpactAnalyzerOptions,
  ): Promise<ImpactReport>;
}
