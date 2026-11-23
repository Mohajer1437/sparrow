/**
 * Skill & Context foundation errors.
 * These describe contract/registry/resolution facts only.
 * They do not encode planner or executor policy.
 */

export class SkillValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string> = [],
  ) {
    super(message);
    this.name = 'SkillValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SkillRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillRegistryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SkillResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillResolutionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
