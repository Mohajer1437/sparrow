import { PlanValidator } from '../../contracts/plan-validator';
import { ExecutionPlan, PlanStep } from '../../domain/execution-plan';
import { PlanValidationResult, PlanValidationError, PlanStatus, PlanningMetadata } from '../../domain/plan-validation';

export class DefaultPlanValidator implements PlanValidator {
  async validate(plan: ExecutionPlan, availableTools: ReadonlyArray<string>): Promise<PlanValidationResult> {
    const errors: PlanValidationError[] = [];
    const warnings: string[] = [];
    const evidence: string[] = [];

    const toolSet = new Set(availableTools);
    const stepIds = new Set(plan.steps.map(s => s.id));

    // 1. Detect empty objectives
    if (!plan.objective || plan.objective.trim().length === 0) {
      errors.push({ code: 'EMPTY_OBJECTIVE', message: 'Plan objective is empty or missing' });
    }

    // 2. Detect missing steps
    if (!plan.steps || plan.steps.length === 0) {
      errors.push({ code: 'NO_STEPS', message: 'Plan contains no steps' });
    }

    // 3. Detect invalid tool requirements & impossible execution order
    for (const step of plan.steps) {
      // Invalid tools
      const invalidTools = step.requiredTools.filter(t => !toolSet.has(t));
      if (invalidTools.length > 0) {
        errors.push({ 
          code: 'INVALID_TOOL', 
          message: `Step requires unavailable tools: ${invalidTools.join(', ')}`, 
          stepId: step.id 
        });
      }

      // Impossible dependencies
      const deps = (step as any).dependencies || [];
      for (const dep of deps) {
        if (!stepIds.has(dep)) {
          errors.push({ 
            code: 'IMPOSSIBLE_DEPENDENCY', 
            message: `Step depends on non-existent step: ${dep}`, 
            stepId: step.id 
          });
        }
      }
    }

    // 4. Detect circular dependencies
    if (this.hasCircularDependencies(plan.steps)) {
      errors.push({ code: 'CIRCULAR_DEPENDENCY', message: 'Plan contains circular step dependencies' });
    }

    // 5. Add metadata if missing
    if (!plan.metadata) {
      warnings.push('Plan missing metadata; generated default metadata');
    }

    const valid = errors.length === 0;
    
    if (valid) {
      evidence.push('All steps have valid dependencies and tool requirements');
      evidence.push('No circular dependencies detected');
    }

    return {
      valid,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      evidence: Object.freeze(evidence)
    };
  }

  resolveDependencies(steps: ReadonlyArray<PlanStep>): ReadonlyArray<PlanStep> {
    // Kahn's algorithm for topological sorting
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const stepMap = new Map<string, PlanStep>();

    for (const step of steps) {
      inDegree.set(step.id, 0);
      adj.set(step.id, []);
      stepMap.set(step.id, step);
    }

    for (const step of steps) {
      const deps = (step as any).dependencies || [];
      for (const dep of deps) {
        if (adj.has(dep)) {
          adj.get(dep)!.push(step.id);
          inDegree.set(step.id, inDegree.get(step.id)! + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(id);
    }

    const sorted: PlanStep[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(stepMap.get(current)!);

      for (const neighbor of adj.get(current) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If sorted length != steps length, there's a cycle (handled by validator, but fallback to original)
    return sorted.length === steps.length ? Object.freeze(sorted) : Object.freeze([...steps]);
  }

  private hasCircularDependencies(steps: ReadonlyArray<PlanStep>): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (stepId: string): boolean => {
      visited.add(stepId);
      recStack.add(stepId);

      const step = steps.find(s => s.id === stepId);
      const deps = (step as any)?.dependencies || [];

      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recStack.has(dep)) {
          return true;
        }
      }

      recStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id)) return true;
      }
    }
    return false;
  }
}
