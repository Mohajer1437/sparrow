/**
 * Gathered context contract errors.
 * These describe invalid records, not planner policy.
 */

export class GatheredContextValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'GatheredContextValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
