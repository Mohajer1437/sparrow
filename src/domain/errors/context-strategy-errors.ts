/**
 * Context strategy / source contract errors.
 * These describe facts about invalid descriptors, not planner policy.
 */

export class ContextSourceValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'ContextSourceValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContextStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextStrategyError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
