import { Skill } from '../domain/skill';

/**
 * Central registry of available skills.
 * Registration is explicit — there is no AI-based skill discovery.
 */
export interface SkillRegistry {
  /**
   * Register a skill. Validates the definition.
   * Throws on duplicate id or invalid contract.
   */
  register(skill: Skill): void;

  /**
   * Get a skill by id. Returns undefined if not registered.
   */
  get(id: string): Skill | undefined;

  /**
   * List all registered skills. Returns an immutable array.
   */
  list(): ReadonlyArray<Skill>;

  /**
   * True when a skill with this id is registered.
   */
  has(id: string): boolean;
}
