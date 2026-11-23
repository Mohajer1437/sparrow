/**
 * TodoPlan contract errors.
 * These describe invalid planner output, not execution policy.
 */

export class TodoPlanValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'TodoPlanValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when the LLM planner produces output that cannot become a TodoPlan.
 * Workflow must abort planning and must not fall back to an arbitrary plan.
 */
export class PlannerOutputRejectedError extends Error {
  public readonly rejectedTargets: ReadonlyArray<string>;
  public readonly reasonCode: string;

  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string> = [],
    rejectedTargets: ReadonlyArray<string> = [],
    reasonCode: string = 'PLANNER_OUTPUT_REJECTED',
  ) {
    super(message);
    this.name = 'PlannerOutputRejectedError';
    this.rejectedTargets = Object.freeze([...rejectedTargets]);
    this.reasonCode = reasonCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
