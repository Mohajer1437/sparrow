import {
  PlannerContextPreparationInput,
  PlannerContextPreparationService,
} from '../../contracts/planner-context';
import { ContextGatherer } from '../../contracts/context-gatherer';
import { ProjectContextService } from '../../contracts/context-cache';
import { SkillResolver } from '../../contracts/skill-resolver';
import { FailureContract } from '../../domain/failure-contract';
import {
  FailureContractContext,
  PlannerContext,
  ProductQaContext,
} from '../../domain/planner-context';
import { ProductAnalysis } from '../../domain/product-analysis';
import { STRUCTURAL_GRAPH_RELATIVE_PATH } from '../../domain/structural-knowledge';
import { DefaultPlannerContextAssembler } from './planner-context-assembler';
import { PlannerContextStrategyBuilder } from './planner-context-strategy-builder';
import * as fs from 'fs';
import * as path from 'path';

export class DefaultPlannerContextPreparationService implements PlannerContextPreparationService {
  private readonly builder = new PlannerContextStrategyBuilder();
  private readonly assembler = new DefaultPlannerContextAssembler();

  constructor(
    private readonly projectContext: ProjectContextService,
    private readonly skillResolver: SkillResolver,
    private readonly gatherer: ContextGatherer,
  ) {}

  async prepare(input: PlannerContextPreparationInput): Promise<PlannerContext> {
    const cached = await this.projectContext.load(input.workspaceRoot, {
      refresh: input.refresh,
    });
    const directive = input.executionDirective ?? {};
    const resolvedSkills = this.skillResolver.resolve({
      directive,
      projectProfile: cached.projectProfile,
    });
    const productQa = toProductQa(input.productQa);
    const failureContractView = toFailureContext(input.failureContract);
    const codebaseMapAvailable = structuralGraphPresent(input.workspaceRoot);
    const strategy = this.builder.build({
      userTask: input.userTask,
      executionDirective: directive,
      projectProfile: cached.projectProfile,
      resolvedSkills,
      productQa,
      failureContract: failureContractView,
      aiContext: cached.aiContext,
      codebaseMapAvailable,
    });
    const gathered = await this.gatherer.gather({
      workspaceRoot: input.workspaceRoot,
      userTask: input.userTask,
      executionDirective: directive,
      projectProfile: cached.projectProfile,
      resolvedSkills,
      strategy,
      aiContext: cached.aiContext,
      productQa,
      failureContract: input.failureContract,
      failureContractView,
      repairCandidateFiles: input.repairCandidateFiles,
      refresh: input.refresh,
    });
    return this.assembler.assemble({
      userTask: input.userTask,
      executionDirective: directive,
      projectProfile: cached.projectProfile,
      resolvedSkills,
      aiContext: cached.aiContext,
      versionIntelligence: cached.versionIntelligence,
      strategy,
      gathered,
      productQa,
      failureContract: failureContractView,
    });
  }
}

function structuralGraphPresent(workspaceRoot: string): boolean {
  try {
    const p = path.join(workspaceRoot, '.ai', STRUCTURAL_GRAPH_RELATIVE_PATH);
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function toProductQa(
  value: ProductAnalysis | ProductQaContext | undefined,
): ProductQaContext | undefined {
  if (!value) return undefined;
  if ('intent' in value) {
    const analysis = value as ProductAnalysis;
    return {
      objective: analysis.objective,
      acceptanceCriteria: analysis.acceptanceCriteria,
      verificationRequirements: analysis.verificationRequirements,
    };
  }
  return value;
}

function toFailureContext(value: FailureContract | undefined): FailureContractContext | undefined {
  if (!value || !value.id || value.id.trim().length === 0) return undefined;
  return {
    id: value.id,
    summary: value.summary,
    primaryFailureId: value.primaryFailure?.check.id,
    incidentalCount: value.incidentalFailures?.length ?? 0,
    failedTodoId: value.failedTodoId,
    attemptId: value.attemptId,
    classification: value.classification,
  };
}
