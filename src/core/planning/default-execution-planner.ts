import { ExecutionPlanner } from '../../contracts/execution-planner';
import { ExecutionPlan, PlanStep, PlanStepType } from '../../domain/execution-plan';
import { PlanningContext } from '../../domain/planning-context';
import { bindAcceptanceContract } from '../vv/acceptance-contract';

/**
 * DefaultExecutionPlanner is a deterministic, rule-based planner.
 *
 * It decomposes an objective into small, ordered steps by splitting
 * on sentence boundaries. Step types are inferred from keywords.
 * Dependencies are sequential (step N depends on step N-1).
 *
 * No LLM. No heuristics. No randomness.
 */
export class DefaultExecutionPlanner implements ExecutionPlanner {
  createPlan(context: PlanningContext): ExecutionPlan | null {
    if (!context.objective || context.objective.trim().length === 0) {
      return null;
    }

    const steps = this.decomposeObjective(context);
    const complexity = steps.length <= 2 ? 'simple' : steps.length <= 5 ? 'medium' : 'complex';

    const plan = Object.freeze({
      id: `plan-${Date.now()}`,
      objective: context.objective,
      complexity,
      reasoning: `Decomposed objective into ${steps.length} deterministic step(s)`,
      steps: Object.freeze(steps),
      affectedDomains: Object.freeze([]),
      validationStrategy: Object.freeze({
        requiredTests: Object.freeze([]),
        successCriteria: Object.freeze(
          context.acceptanceContract?.criteria?.length
            ? context.acceptanceContract.criteria
            : ['All steps completed successfully'],
        ),
      }),
      createdAt: new Date().toISOString(),
      status: 'CREATED' as const,
      acceptanceContract: context.acceptanceContract,
    });
    if (context.acceptanceContract) {
      return bindAcceptanceContract(plan, context.acceptanceContract);
    }
    return plan;
  }

  private decomposeObjective(context: PlanningContext): ReadonlyArray<PlanStep> {
    // F.6: Protect file extensions before splitting on '.'
    const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss'];
    const PLACEHOLDER_PREFIX = '__EXT_';
    
    let protectedObjective = context.objective;
    const placeholders = new Map<string, string>();
    let placeholderIndex = 0;
    
    for (const ext of FILE_EXTENSIONS) {
      const regex = new RegExp(ext.replace('.', '\\.'), 'gi');
      protectedObjective = protectedObjective.replace(regex, (match) => {
        const placeholder = `${PLACEHOLDER_PREFIX}${placeholderIndex++}`;
        placeholders.set(placeholder, match);
        return placeholder;
      });
    }

    // Split sentences
    const rawFragments = protectedObjective
      .split(/[.;]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        // Restore placeholders
        let restored = s;
        for (const [placeholder, ext] of placeholders.entries()) {
          restored = restored.replace(placeholder, ext);
        }
        return restored;
      })
      .slice(0, context.maxSteps);

    // F.1: Merge trivial fragments that are continuations of previous step
    const fragments = this.mergeTrivialFragments(rawFragments);

    if (fragments.length === 0) {
      return Object.freeze([this.createStep(context.objective.trim(), 1, [])]);
    }

    return Object.freeze(
      fragments.map((sentence, index) => {
        const deps: string[] = index > 0 ? [`step-${index}`] : [];
        return this.createStep(sentence, index + 1, deps);
      })
    );
  }

  /**
   * F.1: Merge consecutive trivial fragments that are actually parts of the same step.
   *
   * Handles two cases:
   *   1. Fragment starts with a file extension (e.g., "tsx that displays...")
   *      → merge with previous fragment using "." separator
   *      → "Create component components/Foo" + "tsx that..."
   *        = "Create component components/Foo.tsx that..."
   *
   *   2. Short fragment (< 40 chars) starting with lowercase
   *      → continuation of previous sentence
   *      → merge with space separator
   */
  private mergeTrivialFragments(fragments: string[]): string[] {
    const EXTENSION_REGEX = /^(ts|tsx|js|jsx|json|md|css|scss)/i;
    const merged: string[] = [];

    for (const frag of fragments) {
      if (merged.length === 0) {
        merged.push(frag);
        continue;
      }

      const prev = merged[merged.length - 1];
      const extensionMatch = EXTENSION_REGEX.exec(frag);

      // Case 1: Fragment starts with an extension → merge with "." separator
      if (extensionMatch && extensionMatch.index === 0) {
        const ext = extensionMatch[1];
        const rest = frag.substring(ext.length).trim();
        // Only merge if previous fragment ends with a word char (likely file name)
        if (/\w$/.test(prev.trim())) {
          merged[merged.length - 1] = prev + "." + ext + (rest ? " " + rest : "");
          continue;
        }
      }

      // Case 2: Short fragment starting lowercase → continuation (merge with space)
      if (frag.length < 40 && /^[a-z]/.test(frag)) {
        merged[merged.length - 1] = prev + " " + frag;
        continue;
      }

      // Otherwise: new step
      merged.push(frag);
    }

    return merged;
  }

  private createStep(description: string, index: number, dependencies: string[]): PlanStep {
    return Object.freeze({
      id: `step-${index}`,
      description,
      type: this.inferStepType(description),
      requiredTools: Object.freeze([]),
      expectedOutcome: `Completed: ${description}`,
      objective: description,
      dependencies: Object.freeze(dependencies),
      expectedFiles: Object.freeze(this.extractFilePathsFromDescription(description)),
    });
  }

  /**
   * F.1: Extract file paths from step description.
   * Matches: relative paths with extensions like .ts, .tsx, .js, .jsx, .json, .md, .css, .scss
   * Examples: "app/quiz/page.tsx", "src/lib/utils.ts", "components/Modal.tsx"
   *
   * Copied from StepExecutionEngine to keep fallback planner self-contained.
   */
  private extractFilePathsFromDescription(description: string): string[] {
    if (!description) return [];

    const paths: string[] = [];
    const seen = new Set<string>();

    const filePathRegex = /\b(?:\.{0,2}\/[\w\-./]+|[\w\-./]+)\.(ts|tsx|js|jsx|json|md|css|scss)\b/gi;
    let match;
    while ((match = filePathRegex.exec(description)) !== null) {
      let path = match[0];
      if (path.startsWith('./')) path = path.substring(2);
      if (path.length < 3) continue;
      if (path.includes('://')) continue;
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }

    return paths;
  }

  private inferStepType(description: string): PlanStepType {
    const lower = description.toLowerCase();
    if (/\b(analyze|review|inspect|check)\b/.test(lower)) return 'analysis';
    if (/\b(find|search|locate|discover)\b/.test(lower)) return 'search';
    if (/\b(test|verify|assert)\b/.test(lower)) return 'test';
    if (/\b(validate|confirm)\b/.test(lower)) return 'validation';
    return 'modify';
  }
}
