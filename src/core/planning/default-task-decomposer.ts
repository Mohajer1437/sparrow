import { TaskDecomposer } from '../../contracts/task-decomposer';
import { ExecutionPlan, PlanStep } from '../../domain/execution-plan';
import {
  MicroTask, MicroTaskGraph, MicroTaskComplexity, MicroTaskRisk,
  ReasoningLevel, DecompositionContext, GraphValidationResult,
} from '../../domain/micro-task';
import { ExecutionLogger } from '../observability/execution-logger';

/**
 * High-risk keyword patterns for risk detection.
 */
const HIGH_RISK_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(migrat|schema|database|db)\b/i,
  /\b(auth\w*|login|password|token|session|jwt|oauth)\b/i,
  /\b(security|encrypt|hash|secret|credential)\b/i,
  /\b(delete|remove|drop|destroy|purge)\b/i,
  /\b(public api|breaking change|deprecat)\b/i,
  /\b(architect|refactor|restructur)\b/i,
];

const MEDIUM_RISK_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(modify|update|change|edit)\b/i,
  /\b(api|endpoint|route|controller)\b/i,
  /\b(config|setting|environment)\b/i,
];

/**
 * DefaultTaskDecomposer — deterministic, rule-based decomposition.
 *
 * No LLM calls. Splits plan steps into micro tasks based on:
 *   - File boundaries
 *   - Responsibility boundaries
 *   - Test boundaries
 *   - Architecture boundaries
 */
export class DefaultTaskDecomposer implements TaskDecomposer {

  decompose(plan: ExecutionPlan, context?: DecompositionContext): MicroTaskGraph {
    const tasks: MicroTask[] = [];
    let taskIndex = 0;

    for (const step of plan.steps) {
      const microTasks = this.decomposeStep(step, taskIndex, context);
      tasks.push(...microTasks);
      taskIndex += microTasks.length;
    }

    // Fix dependency references (step-level → task-level)
    const resolvedTasks = this.resolveDependencies(tasks, plan.steps);

    const highRiskTasks = resolvedTasks.filter(t => t.riskLevel === 'high').length;
    const avgDifficulty = resolvedTasks.length > 0
      ? resolvedTasks.reduce((sum, t) => sum + t.difficultyScore, 0) / resolvedTasks.length
      : 0;

    const graph: MicroTaskGraph = Object.freeze({
      planId: plan.id,
      tasks: Object.freeze(resolvedTasks),
      totalTasks: resolvedTasks.length,
      highRiskTasks,
      averageDifficulty: Math.round(avgDifficulty * 10) / 10,
      createdAt: new Date().toISOString(),
    });

    ExecutionLogger.log('DECOMPOSE', '-', '-',
      `Created ${graph.totalTasks} micro tasks | High risk: ${graph.highRiskTasks} | Avg difficulty: ${graph.averageDifficulty}`);

    return graph;
  }

  validateGraph(graph: MicroTaskGraph): GraphValidationResult {
    const errors: string[] = [];

    // 1. Check for duplicate IDs
    const ids = new Set<string>();
    for (const task of graph.tasks) {
      if (ids.has(task.id)) {
        errors.push(`Duplicate task ID: ${task.id}`);
      }
      ids.add(task.id);
    }

    // 2. Check dependencies reference valid tasks
    for (const task of graph.tasks) {
      for (const dep of task.dependencies) {
        if (!ids.has(dep)) {
          errors.push(`Task ${task.id} depends on unknown task: ${dep}`);
        }
      }
    }

    // 3. Check for circular dependencies (DFS)
    const cycle = this.detectCycle(graph.tasks);
    if (cycle) {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
    }

    // 4. Check difficulty score range
    for (const task of graph.tasks) {
      if (task.difficultyScore < 1 || task.difficultyScore > 10) {
        errors.push(`Task ${task.id} has invalid difficulty score: ${task.difficultyScore}`);
      }
    }

    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
    });
  }

  // ============================================================
  // Private: Step decomposition
  // ============================================================

  private decomposeStep(step: PlanStep, startIndex: number, context?: DecompositionContext): MicroTask[] {
    const description = step.description || step.objective || '';
    const targetFiles = step.expectedFiles ? [...step.expectedFiles] : [];

    // Simple task detection: single action, single file → don't split
    if (this.isSimpleTask(description, targetFiles)) {
      return [this.createMicroTask(startIndex, step, description, targetFiles, [])];
    }

    // Try to split by file boundaries
    if (targetFiles.length > 1) {
      return this.splitByFiles(step, targetFiles, startIndex);
    }

    // Try to split by action keywords
    const actions = this.extractActions(description);
    if (actions.length > 1) {
      return this.splitByActions(step, actions, targetFiles, startIndex);
    }

    // Cannot split further — single micro task
    return [this.createMicroTask(startIndex, step, description, targetFiles, [])];
  }

  private isSimpleTask(description: string, targetFiles: ReadonlyArray<string>): boolean {
    const lower = description.toLowerCase();
    const simplePatterns = [
      /^create\s+(a\s+)?(file|folder|directory)\b/i,
      /^add\s+(a\s+)?(field|property|column)\b/i,
      /^read\b/i,
      /^verify\b/i,
      /^check\b/i,
      /^list\b/i,
    ];
    const isSimple = simplePatterns.some(p => p.test(lower));
    return isSimple && targetFiles.length <= 1;
  }

  private splitByFiles(step: PlanStep, files: ReadonlyArray<string>, startIndex: number): MicroTask[] {
    const tasks: MicroTask[] = [];
    const prevIds: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const deps = i > 0 ? [`mt-${startIndex + i - 1}`] : [];
      const desc = `${step.description} — file: ${file}`;
      const task = this.createMicroTask(startIndex + i, step, desc, [file], deps);
      tasks.push(task);
      prevIds.push(task.id);
    }

    return tasks;
  }

  private splitByActions(step: PlanStep, actions: string[], targetFiles: ReadonlyArray<string>, startIndex: number): MicroTask[] {
    const tasks: MicroTask[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const deps = i > 0 ? [`mt-${startIndex + i - 1}`] : [];
      const task = this.createMicroTask(startIndex + i, step, action, targetFiles, deps);
      tasks.push(task);
    }

    return tasks;
  }

  private extractActions(description: string): string[] {
    // F.8: Protect file extensions before splitting on '.' and ','
    const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss'];
    const PLACEHOLDER_PREFIX = '__EXT_';
    
    let protectedDescription = description;
    const placeholders = new Map<string, string>();
    let placeholderIndex = 0;
    
    for (const ext of FILE_EXTENSIONS) {
      const regex = new RegExp(ext.replace('.', '\\.'), 'gi');
      protectedDescription = protectedDescription.replace(regex, (match) => {
        const placeholder = `${PLACEHOLDER_PREFIX}${placeholderIndex++}`;
        placeholders.set(placeholder, match);
        return placeholder;
      });
    }

    // Split on sentence boundaries and action verbs
    const sentences = protectedDescription
      .split(/[.;,]+/)
      .map(s => s.trim())
      .map(s => {
        // Restore placeholders
        let restored = s;
        for (const [placeholder, ext] of placeholders.entries()) {
          restored = restored.replace(placeholder, ext);
        }
        return restored;
      })
      .filter(s => s.length > 5);

    if (sentences.length <= 1) return [description];

    // Only split if sentences look like distinct actions
    const actionVerbs = /\b(create|add|modify|update|delete|implement|write|build|setup|configure|test|verify|validate|refactor|move|rename)\b/i;
    const actionSentences = sentences.filter(s => actionVerbs.test(s));

    return actionSentences.length > 1 ? actionSentences : [description];
  }

  // ============================================================
  // Private: MicroTask creation
  // ============================================================

  private createMicroTask(
    index: number,
    step: PlanStep,
    description: string,
    targetFiles: ReadonlyArray<string>,
    dependencies: string[],
  ): MicroTask {
    const riskLevel = this.detectRisk(description);
    const difficultyScore = this.calculateDifficulty(description, riskLevel);
    const reasoningRequired = this.determineReasoning(description, difficultyScore);
    const complexity = this.determineComplexity(difficultyScore);

    return Object.freeze({
      id: `mt-${index}`,
      title: description.substring(0, 80),
      description,
      targetFiles: Object.freeze([...targetFiles]),
      dependencies: Object.freeze([...dependencies]),
      expectedOutput: step.expectedOutcome || `Completed: ${description}`,
      verificationSteps: Object.freeze(step.validationCriteria ? [...step.validationCriteria] : [`Verify: ${description}`]),
      rollbackStrategy: riskLevel === 'high' ? 'Restore from backup before applying' : 'Undo file changes',
      complexity,
      riskLevel,
      reasoningRequired,
      difficultyScore,
      // F.5: Propagate expectedFiles to micro-task so E.3 scope restriction activates
      expectedFiles: Object.freeze([...targetFiles]),
      requiredContext: Object.freeze({
        files: Object.freeze([...targetFiles]),
        symbols: Object.freeze([]),
        previousTaskOutputs: Object.freeze(dependencies.map(d => `Output of ${d}`)),
      }),
    });
  }

  // ============================================================
  // Private: Risk detection
  // ============================================================

  private detectRisk(description: string): MicroTaskRisk {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(description)) return 'high';
    }
    for (const pattern of MEDIUM_RISK_PATTERNS) {
      if (pattern.test(description)) return 'medium';
    }
    return 'low';
  }

  // ============================================================
  // Private: Difficulty scoring
  // ============================================================

  private calculateDifficulty(description: string, risk: MicroTaskRisk): number {
    let score = 2; // base

    const lower = description.toLowerCase();

    // Complexity indicators
    if (/\b(implement|build|create.*system|create.*module)\b/i.test(lower)) score += 3;
    if (/\b(integrate|connect|wire)\b/i.test(lower)) score += 2;
    if (/^(test|verify|validate)\b/i.test(lower)) score += 1;
    if (/\b(create|add|write)\b/i.test(lower)) score += 1;
    if (/\b(modify|update|change|refactor)\b/i.test(lower)) score += 2;

    // Risk boost
    if (risk === 'high') score += 3;
    if (risk === 'medium') score += 1;

    // Multi-file boost
    const fileCount = (description.match(/\bfile\b/gi) || []).length;
    if (fileCount > 1) score += 1;

    return Math.min(10, Math.max(1, score));
  }

  private determineReasoning(description: string, difficulty: number): ReasoningLevel {
    if (difficulty >= 7) return 'architecture';
    if (difficulty >= 4) return 'basic';
    return 'none';
  }

  private determineComplexity(difficulty: number): MicroTaskComplexity {
    if (difficulty <= 3) return 'trivial';
    if (difficulty <= 6) return 'simple';
    return 'moderate';
  }

  // ============================================================
  // Private: Dependency resolution
  // ============================================================

  private resolveDependencies(tasks: MicroTask[], steps: ReadonlyArray<PlanStep>): MicroTask[] {
    // Build step-id → task-ids mapping
    const stepToTasks = new Map<string, string[]>();
    let idx = 0;
    for (const step of steps) {
      const stepTasks = tasks.filter((_, i) => {
        // Simple heuristic: tasks are grouped by step order
        return true;
      });
      // For now, sequential dependency is already set in decomposeStep
      idx++;
    }
    return tasks;
  }

  // ============================================================
  // Private: Cycle detection (DFS)
  // ============================================================

  private detectCycle(tasks: ReadonlyArray<MicroTask>): string[] | null {
    const adj = new Map<string, string[]>();
    for (const task of tasks) {
      adj.set(task.id, [...task.dependencies]);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): string[] | null => {
      visited.add(node);
      inStack.add(node);
      path.push(node);

      for (const dep of adj.get(node) || []) {
        if (!visited.has(dep)) {
          const cycle = dfs(dep);
          if (cycle) return cycle;
        } else if (inStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          return [...path.slice(cycleStart), dep];
        }
      }

      path.pop();
      inStack.delete(node);
      return null;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        const cycle = dfs(task.id);
        if (cycle) return cycle;
      }
    }

    return null;
  }
}
