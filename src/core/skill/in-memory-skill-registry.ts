import { SkillRegistry } from '../../contracts/skill-registry';
import { SkillRegistryError } from '../../domain/errors/skill-errors';
import { Skill, validateSkill } from '../../domain/skill';

export class InMemorySkillRegistry implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    const validated = validateSkill(skill);
    if (this.skills.has(validated.id)) {
      throw new SkillRegistryError(`Skill already registered: ${validated.id}`);
    }
    this.skills.set(validated.id, validated);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): ReadonlyArray<Skill> {
    return Object.freeze(Array.from(this.skills.values()));
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }
}
